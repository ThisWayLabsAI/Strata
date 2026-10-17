"""Model identity and HTTP admission regressions, with CPU-only engines."""
import json
import hashlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock
from types import SimpleNamespace

from serve.frontend import ChatTemplate
from serve.model_registry import Registry, RegistryError, installed_profile, from_config
from serve.server import ByteTokenizer, Service, serve
from serve.test_monitor import ReloadableEngine


def service(name="original", context=8192):
    tok = ByteTokenizer()
    return Service(ReloadableEngine(tok, "</think>\n" + name, max_context=context), tok,
                   ChatTemplate(Path(__file__).parent / "chat_template.jinja"), model_name=name)


class Switching(unittest.TestCase):
    def setUp(self):
        self.svc = service()
        self.svc.set_aliases(["legacy"])
        self.factory = mock.Mock(side_effect=lambda name, entry: service(name, entry["max_context"]))
        self.registry = Registry(self.svc, {"original": {"max_context": 8192},
                                           "sc117": {"max_context": 4096}}, self.factory)
        self.svc.model_registry = self.registry
        self.httpd = serve(self.svc, port=0)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def request(self, path, body=None, headers=None):
        request = urllib.request.Request(self.base + path,
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def chat(self, model="sc117", **kwargs):
        return self.request("/v1/chat/completions", {"model": model,
            "messages": [{"role": "user", "content": "hello"}], "max_tokens": 32, **kwargs})

    def test_both_directions_and_actual_response_identity(self):
        old = self.svc.engine
        code, body = self.chat()
        self.assertEqual(code, 200, body)
        self.assertEqual(body["model"], "sc117")
        self.assertIn("sc117", body["choices"][0]["message"]["content"])
        self.assertFalse(old.alive())
        second = self.svc.engine
        self.assertEqual(self.chat("original")[1]["model"], "original")
        self.assertFalse(second.alive())

    def test_switch_replaces_tokenizer_bound_prompt_cache_and_family(self):
        class ShiftedTokenizer(ByteTokenizer):
            def encode_marked(self, *args, **kwargs):
                ids, marks = super().encode_marked(*args, **kwargs)
                return [token + 4096 for token in ids], marks

        candidate = service("sc117")
        candidate.tok = ShiftedTokenizer()
        candidate.prompts = type(candidate.prompts)(candidate.tok)
        candidate.model_arch = "replacement-family"
        self.factory.side_effect = None
        self.factory.return_value = candidate
        messages = [{"role": "user", "content": "distinct tokenizer"}]
        before = self.svc.encode_prompt(messages, None, {})
        expected = candidate.encode_prompt(messages, None, {})
        self.assertNotEqual(before, expected)
        self.assertEqual(self.request("/v1/model-selection", {"model": "sc117"})[0], 200)
        self.assertIs(self.svc.prompts, candidate.prompts)
        self.assertIs(self.svc.prompts.tok, self.svc.tok)
        self.assertEqual(self.svc.encode_prompt(messages, None, {}), expected)
        self.assertEqual(self.svc.model_arch, "replacement-family")

    def test_alias_stays_bound_to_startup_model(self):
        self.chat()
        code, body = self.chat("legacy")
        self.assertEqual(code, 200, body)
        self.assertEqual(body["model"], "original")
        self.assertEqual(self.registry.default, "original")

    def test_unknown_id_and_invalid_type_do_not_unload(self):
        old = self.svc.engine
        for name in ("missing", "../../model", ["sc117"]):
            code, body = self.chat(name)
            self.assertEqual(code, 404, body)
            self.assertEqual(body["error"]["code"], "model_not_found")
        self.assertTrue(old.alive())
        self.factory.assert_not_called()

    def test_validation_failure_preserves_working_engine(self):
        self.factory.side_effect = ValueError("private/path/with/asset")
        code, body = self.chat()
        self.assertEqual(code, 400)
        self.assertNotIn("private/path", json.dumps(body))
        self.assertTrue(self.svc.loaded())
        self.assertEqual(self.svc.model, "original")

    def test_gate_covers_preparation_and_release(self):
        entered, release = threading.Event(), threading.Event()
        original = self.svc.prepare
        def prepare(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(5))
            return original(*args, **kwargs)
        result = []
        with mock.patch.object(self.svc, "prepare", side_effect=prepare):
            worker = threading.Thread(target=lambda: result.append(self.chat("original")))
            worker.start()
            self.assertTrue(entered.wait(5))
            try:
                code, body = self.chat()
                self.assertEqual(code, 409, body)
                self.assertEqual(body["error"]["code"], "model_busy")
                self.assertEqual(self.request("/v1/unload", {})[0], 409)
            finally:
                release.set()
                worker.join(5)
        self.assertEqual(result[0][0], 200)
        self.assertEqual(self.chat()[0], 200)

    def test_fifo_and_queued_work_refuse_transition(self):
        with self.svc.fifo:
            self.assertEqual(self.chat()[0], 409)
        self.svc.status["queued"] = 1
        self.assertEqual(self.chat()[0], 409)
        self.svc.status["queued"] = 0
        self.assertEqual(self.chat()[0], 200)

    def test_load_failure_rolls_back_without_snapshot_reuse(self):
        candidate = service("sc117")
        candidate.engine.unload()
        candidate.engine.restart = mock.Mock(side_effect=RuntimeError("load failure"))
        self.factory.side_effect = None
        self.factory.return_value = candidate
        self.svc.restore_after_load = "not-a-real-snapshot"
        old = self.svc.engine
        old_prompts = self.svc.prompts
        self.svc.model_arch = "original-family"
        code, body = self.chat()
        self.assertEqual(code, 503, body)
        self.assertEqual(body["error"]["code"], "load_failed_previous_restored")
        self.assertIs(self.svc.engine, old)
        self.assertIs(self.svc.prompts, old_prompts)
        self.assertIs(self.svc.prompts.tok, self.svc.tok)
        self.assertEqual(self.svc.model_arch, "original-family")
        self.assertTrue(self.svc.loaded())
        self.assertIsNone(self.svc.restore_after_load)
        self.assertEqual(self.chat("original")[0], 200)

    def test_failed_rollback_is_unloaded_and_recoverable(self):
        candidate = service("sc117")
        candidate.engine.unload()
        candidate.engine.restart = mock.Mock(side_effect=RuntimeError("load failure"))
        self.factory.side_effect = None
        self.factory.return_value = candidate
        with mock.patch.object(self.svc.engine, "restart", side_effect=RuntimeError("rollback failure")):
            code, body = self.chat()
        self.assertEqual(code, 503, body)
        self.assertEqual(body["error"]["code"], "load_failed_rollback_failed")
        self.assertFalse(self.svc.loaded())
        self.assertEqual(self.request("/health")[0], 200)
        self.assertEqual(self.chat("original")[0], 200)

    def test_context_overflow_preserves_transcript(self):
        history = [{"role": "user", "content": "hello" * 1500}]
        code, body = self.chat(messages=history)
        self.assertEqual(code, 400, body)
        self.assertIn("context", body["error"]["message"])
        self.assertEqual(history[0]["content"], "hello" * 1500)
        self.assertEqual(self.chat()[0], 200)

    def test_selection_metadata_and_manual_snapshot_refusal(self):
        code, body = self.request("/v1/model-selection", {"model": "sc117"})
        self.assertEqual(code, 200, body)
        self.assertEqual(body["active_model"], "sc117")
        self.assertEqual(body["default_model"], "original")
        self.assertEqual(self.request("/slots/0?action=restore", {"filename": "old"})[0], 400)
        code, body = self.request("/v1/models")
        self.assertEqual(code, 200)
        self.assertEqual({item["id"] for item in body["data"]}, {"original", "sc117", "legacy"})
        self.assertNotIn("tokenizer", json.dumps(body))

    def test_selecting_current_unloaded_model_loads_it(self):
        self.svc.engine.unload()
        code, body = self.request("/v1/model-selection", {"model":"original"})
        self.assertEqual(code, 200, body)
        self.assertEqual(body["active_model"], "original")
        self.assertTrue(body["loaded"])

    def test_authentication_and_cross_origin_selection(self):
        self.svc.api_key = "fixture-secret"
        self.assertEqual(self.chat()[0], 401)
        self.assertEqual(self.request("/v1/model-selection")[0], 401)
        self.assertEqual(self.request("/v1/model-selection", {"model": "sc117"},
                         {"Authorization": "Bearer fixture-secret", "Origin": "https://foreign.example"})[0], 403)
        self.assertEqual(self.svc.model, "original")

    def test_adapter_parity(self):
        for path, request in (("/v1/messages", {"messages": [{"role": "user", "content": "hello"}], "max_tokens": 32}),
                              ("/v1/responses", {"input": "hello", "max_output_tokens": 32})):
            self.request("/v1/model-selection", {"model": "original"})
            code, body = self.request(path, {"model": "sc117", **request})
            self.assertEqual(code, 200, body)
            self.assertEqual(body["model"], "sc117")

    def test_cancelled_stream_releases_admission(self):
        import http.client
        import socket
        import time
        self.svc.engine.delay_s = .02
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
        conn.request("POST", "/v1/chat/completions", json.dumps({"model": "original", "stream": True,
                     "messages": [{"role": "user", "content": "hello"}], "max_tokens": 32}),
                     {"Content-Type": "application/json"})
        transport = conn.sock
        response = conn.getresponse()
        response.readline()
        transport.shutdown(socket.SHUT_RDWR)
        response.close()
        conn.close()
        for _ in range(100):
            if not self.registry.gate.locked():
                break
            time.sleep(.02)
        self.assertFalse(self.registry.gate.locked())
        self.assertEqual(self.chat()[0], 200)

    def test_registry_disabled_retains_legacy_unknown_name_behavior(self):
        self.svc.model_registry = None
        self.assertEqual(self.chat("arbitrary-name")[0], 200)
        self.assertEqual(self.request("/v1/model-selection")[0], 404)

    def test_image_handoff_and_restoration_keep_model_bound(self):
        from serve import images, test_images
        from serve.test_chat_images import LifecycleEngine, image_call
        self.svc.engine = LifecycleEngine(self.svc.tok, [image_call(), "</think>\n\nrestored"])
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(images, "sd_cli_args", test_images.fake_args):
            self.svc.images = images.ImageGen(test_images.image_cfg(folder))
            self.svc.images.policy = "unload"
            run = self.svc.images.run
            rejections = []
            def guarded_run(*args, **kwargs):
                rejections.append(self.chat("sc117")[0])
                self.assertEqual(self.svc.model, "original")
                return run(*args, **kwargs)
            with mock.patch.object(self.svc.images, "run", side_effect=guarded_run):
                code, body = self.chat("original", strata_images=True, max_tokens=1200)
            self.assertEqual(code, 200, body)
            self.assertEqual(rejections, [409])
            self.assertEqual([item[0] for item in self.svc.engine.calls if isinstance(item, tuple)], ["save", "restore"])
            self.assertIsNone(self.svc.restore_after_load)
            self.assertEqual(self.chat()[0], 200)

    def test_unconfirmed_vision_stop_prevents_second_engine(self):
        self.svc.vision = mock.Mock()
        self.svc.vision.proc.poll.return_value = None
        old = self.svc.engine
        code, body = self.chat()
        self.assertEqual(code, 503, body)
        self.assertEqual(body["error"]["code"], "model_stop_failed")
        self.assertIs(self.svc.engine, old)
        self.assertEqual(self.svc.model, "original")

    def test_shutdown_closes_selected_engine_and_refuses_admission(self):
        self.chat()
        selected = self.svc.engine
        self.registry.close()
        self.assertFalse(selected.alive())
        self.assertEqual(self.chat("original")[0], 409)

    def test_load_alias_and_active_unload_control(self):
        self.chat()
        self.assertEqual(self.request("/v1/unload", {"model": "original"})[0], 404)
        code, body = self.request("/v1/load", {"model": "legacy"})
        self.assertEqual(code, 200, body)
        self.assertEqual(self.svc.model, "original")
        self.assertEqual(self.request("/v1/unload", {"model": "legacy"})[0], 200)

    def test_props_does_not_publish_registry_paths(self):
        self.svc.engine.model_path = "private/native/model.gguf"
        self.assertNotIn("model_path", self.request("/props")[1])

    def test_switch_discards_only_owned_pending_image_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            owned = Path(folder) / "llm-session-012345abcdef.bin"
            owned.write_bytes(b"old-model-cache")
            other = Path(folder) / "unrelated.bin"
            other.write_bytes(b"user-data")
            self.svc.images = SimpleNamespace(dir=Path(folder))
            self.svc.restore_after_load = str(owned)
            with self.registry.admission():
                self.registry.switch("sc117")
            self.assertFalse(owned.exists())
            self.assertTrue(other.exists())
            self.assertIsNone(self.svc.restore_after_load)


class Assets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        pack = root / "pack"
        tokenizer = pack / "tokenizer"
        tokenizer.mkdir(parents=True)
        for name in ("engine.exe", "vision.exe", "projector.gguf", "model.gguf", "other.gguf"):
            (root / name).write_bytes(b"fixture")
        for name in ("dense.bin", "index.txt"):
            (pack / name).write_bytes(b"fixture")
        (pack / "native_experts.txt").write_text("absolute offsets in model.gguf\n")
        (pack / "conversions.json").write_text(json.dumps({"source_shards": [{"name": "model.gguf", "size": 7}]}))
        for name in ("vocab.json", "merges.txt", "token_type.json", "chat_template.jinja"):
            (tokenizer / name).write_bytes(b"fixture")
        self.cfg = {"exe": str(root / "engine.exe"), "cwd": str(root), "tokenizer": str(tokenizer),
                    "tokenizer_sha256": hashlib.sha256(b"fixture" * 4).hexdigest(),
                    "args": ["--pack", str(pack), "--native", str(root / "model.gguf"), "--max-context", "8192"],
                    "vision": {"exe": str(root / "vision.exe"), "mmproj": str(root / "projector.gguf"),
                               "model": str(root / "model.gguf")}}
        self.root, self.pack, self.tokenizer = root, pack, tokenizer

    def test_valid_assets(self):
        self.assertEqual(installed_profile(self.cfg), 8192)

    def test_missing_asset(self):
        (self.pack / "dense.bin").unlink()
        with self.assertRaises(ValueError):
            installed_profile(self.cfg)

    def test_pack_from_different_model(self):
        self.cfg["args"][3] = str(self.root / "other.gguf")
        with self.assertRaises(ValueError):
            installed_profile(self.cfg)

    def test_modified_shard(self):
        (self.root / "model.gguf").write_bytes(b"truncated")
        with self.assertRaises(ValueError):
            installed_profile(self.cfg)

    def test_vision_model_mismatch(self):
        self.cfg["vision"]["model"] = str(self.root / "other.gguf")
        with self.assertRaises(ValueError):
            installed_profile(self.cfg)

    def test_tokenizer_mismatch(self):
        (self.tokenizer / "vocab.json").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            installed_profile(self.cfg)

    def test_foreign_tokenizer_directory(self):
        self.cfg["tokenizer"] = str(self.root)
        with self.assertRaises(ValueError):
            installed_profile(self.cfg)

    def test_incompatible_parallel_or_unknown_profile_option(self):
        for options in ({"parallel": 2}, {"replicas": 2}, {"api_key": "secret"}, {"slot_save_path": "sessions"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                installed_profile({**self.cfg, **options})

    def test_registry_startup_binding_alias_collision_and_restart(self):
        svc = service()
        config = {**self.cfg, "model_registry": {"original": self.cfg.copy()}}
        registry = from_config(svc, config, mock.Mock())
        self.assertEqual(registry.default, "original")
        self.assertEqual(from_config(service(), config, mock.Mock()).state()["active_model"], "original")
        with self.assertRaises(ValueError):
            from_config(svc, {**config, "tokenizer": "foreign"}, mock.Mock())
        svc.set_aliases(["sc117"])
        with self.assertRaises(ValueError):
            Registry(svc, {"original": {}, "sc117": {}}, mock.Mock())

    def test_missing_registry_is_opt_out(self):
        self.assertIsNone(from_config(service(), {}, mock.Mock()))


if __name__ == "__main__":
    unittest.main()
