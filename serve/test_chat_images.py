"""Opt-in chat image orchestration, without a GPU or external tools."""
import base64
import http.client
import json
import os
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace
from unittest import mock

from serve import images, test_images as baseline, test_mcp as mcp_tests
from serve.chat_images import ImageToolHub, NAME
from serve.frontend import ChatTemplate
from serve.server import ByteTokenizer, Service, serve


def image_call(**arguments):
    return mcp_tests.call_script(NAME, **({"prompt":"a small red robot", "size":"512x512", "seed":0} | arguments))


class LifecycleEngine(mcp_tests.ScriptedEngine, baseline.FakeEngine):
    def __init__(self, tok, scripts):
        mcp_tests.ScriptedEngine.__init__(self,tok,scripts)
        baseline.FakeEngine.__init__(self)
        self.generating = False

    def generate(self,*args,**kwargs):
        self.generating = True
        try: yield from super().generate(*args,**kwargs)
        finally: self.generating = False

    def unload(self):
        assert not self.generating, "unload during text inference"
        baseline.FakeEngine.unload(self)


@mock.patch.object(images, "sd_cli_args", baseline.fake_args)
class ChatImages(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.httpd = None

    def tearDown(self):
        if self.httpd:
            self.httpd.shutdown(); self.httpd.server_close()
        self.tmp.cleanup()

    def start(self, *scripts, engine_class=mcp_tests.ScriptedEngine):
        tok = ByteTokenizer()
        self.engine = engine_class(tok, list(scripts))
        self.svc = Service(self.engine, tok, ChatTemplate(baseline.ROOT / "serve/chat_template.jinja"))
        self.svc.images = images.ImageGen(baseline.image_cfg(self.tmp.name))
        self.httpd = serve(self.svc, port=0)
        self.port = self.httpd.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"

    def post(self, **options):
        request = {"messages":[{"role":"user","content":"Create a red robot image"}],"max_tokens":1200, **options}
        req = urllib.request.Request(self.base + "/v1/chat/completions", json.dumps(request).encode(), {"Content-Type":"application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read().decode()
                return response.status, ([json.loads(line[5:]) for line in raw.splitlines() if line.startswith("data:") and line[5:].strip() != "[DONE]"] if options.get("stream") else json.loads(raw))
        except urllib.error.HTTPError as error:
            with error: return error.code, json.load(error)

    def test_default_and_client_owned_tools_do_not_execute(self):
        self.start(image_call())
        self.assertEqual(self.post()[0], 200)
        self.assertEqual(self.svc.images.totals["jobs"], 0)
        self.assertNotIn("Generate one NEW image", self.engine.prompt_text(0))
        own = [{"type":"function","function":{"name":NAME,"parameters":{"type":"object"}}}]
        code, body = self.post(strata_images=True, tools=own)
        self.assertEqual(code, 200, body)
        self.assertNotIn("strata_images", body["choices"][0]["message"])
        self.assertEqual(self.svc.images.totals["jobs"], 0)

    def test_text_only_opt_in_does_not_generate(self):
        self.start("</think>\n\nHello")
        code, body = self.post(strata_images=True)
        self.assertEqual(code, 200)
        self.assertEqual(body["choices"][0]["message"]["content"], "Hello")
        self.assertEqual(self.svc.images.totals["jobs"], 0)
        self.assertIn("Generate one NEW image", self.engine.prompt_text(0))

    def test_generate_then_continue_with_text_only_result(self):
        self.start(image_call(), "</think>\n\nYour robot is ready.")
        code, body = self.post(strata_images=True)
        self.assertEqual(code, 200, body)
        message = body["choices"][0]["message"]
        complete = next(event for event in message["strata_images"] if event["state"] == "completed")
        self.assertEqual(complete["recipe"]["seed"], 0)
        self.assertEqual(complete["recipe"]["size"], "512x512")
        self.assertTrue(base64.b64decode(complete["b64_json"]).startswith(b"\x89PNG"))
        self.assertIn("Your robot is ready", message["content"])
        self.assertIn('"status": "completed"', self.engine.prompt_text(1))
        self.assertNotIn(complete["b64_json"], self.engine.prompt_text(1))
        self.assertFalse(self.svc.fifo.locked())
        self.assertEqual(list(self.svc.images.dir.iterdir()), [])

    def test_stream_has_stable_sequenced_job_and_phases(self):
        self.start(image_call(), "</think>\n\nDone")
        code, chunks = self.post(strata_images=True, stream=True)
        self.assertEqual(code, 200)
        events = [chunk["strata_image"] for chunk in chunks if "strata_image" in chunk]
        self.assertEqual([event["state"] for event in events], ["queued","preparing","generating","restoring","completed"])
        self.assertEqual(len({event["job_id"] for event in events}), 1)
        self.assertEqual([event["sequence"] for event in events], list(range(1,len(events)+1)))

    def test_malformed_arguments_and_budget_do_not_start_extra_jobs(self):
        for arguments in [{"prompt":""}, {"size":"9000x9000"}, {"seed":-1}, {"seed":9007199254740992}, {"references":[]}, {"exe":"bad"}]:
            with self.subTest(arguments=arguments):
                tok = ByteTokenizer()
                svc = Service(mcp_tests.ScriptedEngine(tok,["</think>\n\nok"]),tok,ChatTemplate(baseline.ROOT / "serve/chat_template.jinja"))
                svc.images = images.ImageGen(baseline.image_cfg(self.tmp.name))
                hub = ImageToolHub(svc)
                result = hub.call(NAME, {"prompt":"robot",**arguments}, threading.Event(), call_id="bad")
                self.assertFalse(result["ok"])
                self.assertEqual(svc.images.totals["jobs"], 0)
        self.start(image_call(), image_call(seed=1), "</think>\n\nDone")
        self.assertEqual(self.post(strata_images=True)[0], 200)
        self.assertEqual(self.svc.images.totals["jobs"], 1)

    def test_duplicate_call_reuses_result_without_execution(self):
        self.start("</think>\n\nUnused")
        hub = ImageToolHub(self.svc); cancel = threading.Event()
        first = hub.call(NAME, {"prompt":"robot","size":"512x512"}, cancel, call_id="same")
        second = hub.call(NAME, {"prompt":"robot","size":"512x512"}, cancel, call_id="same")
        self.assertEqual(first, second)
        self.assertEqual(self.svc.images.totals["jobs"], 1)
        self.assertEqual(sum(event["state"]=="completed" for event in hub.drain()), 1)

    def test_tensor_loading_bars_are_not_sampling_steps(self):
        self.start("</think>\n\nUnused")
        hub=ImageToolHub(self.svc)
        hub.active={"call_id":"call","job_id":"a"*32,"sequence":0,"state":"generating","steps":8}
        self.svc.images.progress=(98,98)
        self.assertEqual(list(hub.drain()),[])
        self.svc.images.progress=(3,8)
        event=list(hub.drain())[0]
        self.assertEqual((event["step"],event["steps"]),(3,8))
        self.assertEqual(list(hub.drain()),[])

    def test_tool_none_and_mixed_client_calls(self):
        mixed = image_call() + "\n<tool_call>\n<function=client_action>\n<parameter=value>x</parameter>\n</function>\n</tool_call>"
        self.start(mixed)
        self.post(strata_images=True,tool_choice="none")
        self.assertNotIn("Generate one NEW image",self.engine.prompt_text(0))
        self.post(strata_images=True,tools=[{"type":"function","function":{"name":"client_action","parameters":{"type":"object"}}}])
        self.assertEqual(self.svc.images.totals["jobs"],0)

    def test_auth_and_unconfigured(self):
        self.start(image_call())
        self.assertEqual(self.post(strata_images="true")[0],400)
        self.svc.images = None
        self.assertEqual(self.post(strata_images=True)[0],400)
        self.svc.api_key = "private-test-key"
        self.assertEqual(self.post(strata_images=True)[0],401)

    def test_failure_and_cancellation_release_gpu(self):
        self.start(image_call(), "</think>\n\nIt failed")
        with mock.patch.dict(os.environ,{"FAKE_SD_FAIL":"1"}):
            code, body = self.post(strata_images=True)
        self.assertEqual(code,200)
        self.assertTrue(any(event["state"]=="failed" for event in body["choices"][0]["message"]["strata_images"]))
        self.assertFalse(self.svc.status["busy"])
        self.assertFalse(self.svc.fifo.locked())

    def test_recovery_failure_keeps_image_in_nonstream_result(self):
        self.start(image_call(), "</think>\n\nUnused")
        original = self.svc.prepare
        calls = 0
        def prepare(*args,**kw):
            nonlocal calls
            calls += 1
            if calls > 1: raise RuntimeError("reload failed")
            return original(*args,**kw)
        with mock.patch.object(self.svc,"prepare",side_effect=prepare):
            code, body = self.post(strata_images=True)
        self.assertEqual(code,200,body)
        events = body["choices"][0]["message"]["strata_images"]
        self.assertTrue(any(event["state"]=="completed" for event in events))
        self.assertTrue(any(event["state"]=="recovery_failed" for event in events))

    def test_disconnect_reaps_image_process_and_next_chat_runs(self):
        self.start(image_call(), "</think>\n\nRecovered")
        conn = http.client.HTTPConnection("127.0.0.1",self.port,timeout=10)
        with mock.patch.dict(os.environ,{"FAKE_SD_SLEEP":"10"}):
            conn.request("POST","/v1/chat/completions",json.dumps({"messages":[{"role":"user","content":"create image"}],"strata_images":True,"stream":True,"max_tokens":1200}),{"Content-Type":"application/json"})
            transport = conn.sock
            response = conn.getresponse()
            while True:
                line = response.readline()
                if b'"state": "generating"' in line: break
                self.assertTrue(line,"stream ended before image generation")
            transport.shutdown(socket.SHUT_RDWR); response.close(); conn.close()
            for _ in range(100):
                if not self.svc.fifo.locked() and not self.svc.status["busy"]: break
                time.sleep(.05)
            else: self.fail("Cancelled image retained GPU ownership")
        self.assertEqual(self.post()[0],200)
        self.assertEqual(list(self.svc.images.dir.iterdir()),[])

    def test_text_image_text_unload_restore_has_no_fifo_reentry(self):
        self.start(image_call(), "</think>\n\nRestored",engine_class=LifecycleEngine)
        self.svc.images.policy = "unload"
        original = self.svc.images.run
        def run(*args,**kw):
            self.assertFalse(self.engine.generating)
            self.assertTrue(self.svc.fifo.locked())
            return original(*args,**kw)
        with mock.patch.object(self.svc.images,"run",side_effect=run):
            code,body=self.post(strata_images=True)
        self.assertEqual(code,200,body)
        self.assertIn("unload",self.engine.calls)
        self.assertIn("restart",self.engine.calls)
        self.assertEqual([call[0] for call in self.engine.calls if isinstance(call,tuple)],["save","restore"])
        self.assertEqual(list(self.svc.images.dir.iterdir()),[])

    def test_existing_mcp_and_image_tool_run_together(self):
        class Hub:
            settings={"max_rounds":4}
            calls=0
            def wait(self,*_): pass
            def template_tools(self,exclude): return [{"name":"fake__echo","description":"Echo","parameters":{"type":"object"}}]
            def routes(self): return {"fake__echo":(SimpleNamespace(name="fake"),"echo")}
            def call(self,*_):
                self.calls+=1
                return {"ok":True,"text":"hello","chars":5,"truncated":False,"ms":1}
        self.start(mcp_tests.call_script("fake__echo",text="hello"),image_call(),"</think>\n\nDone")
        self.svc.mcp=Hub()
        code,body=self.post(strata_mcp=True,strata_images=True)
        self.assertEqual(code,200,body)
        self.assertEqual(self.svc.mcp.calls,1)
        self.assertEqual(self.svc.images.totals["jobs"],1)

    def test_image_only_budget_finishes_without_another_image(self):
        self.start(image_call(), image_call(), "</think>\n\nThe image is ready.")
        code, body = self.post(strata_images=True)
        self.assertEqual(code, 200, body)
        self.assertEqual(self.svc.images.totals["jobs"], 1)  # existing one-image-per-answer guard
        self.assertEqual(len(self.engine.prompts), 3)
        self.assertNotIn("# Tools", self.engine.prompt_text(2))
        self.assertIn("The image is ready.", body["choices"][0]["message"]["content"])


if __name__ == "__main__":
    unittest.main()
