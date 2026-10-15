"""Reference validation, shared HTTP contract, process cleanup and GPU recovery."""
import base64
import io
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, PngImagePlugin
from serve import image_references as refs, images
from serve import test_images as baseline

fake_args, image_cfg = baseline.fake_args, baseline.image_cfg


def reference(role="source", name="source.png"):
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("private", "not for runner")
    Image.new("RGB", (32, 24), "red").save(output, "PNG", pnginfo=metadata)
    return {"data": base64.b64encode(output.getvalue()).decode(), "role": role, "name": name}


class Validation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = image_cfg(self.tmp.name)
        self.cfg["llm_vision"] = self.cfg["llm"]

    def parse(self, values, edit=True):
        return refs.parse({"references": values}, self.cfg, edit=edit)

    def test_normalization_order_metadata_hash(self):
        values = self.parse([reference(), reference("style", "style.png")])
        self.assertEqual([v["role"] for v in values], ["source", "style"])
        self.assertEqual(values[0]["sha256"], values[1]["sha256"])
        with Image.open(io.BytesIO(values[0]["png"])) as image:
            self.assertEqual(image.size, (32, 24))
            self.assertNotIn("private", image.info)
        self.assertNotIn("png", refs.provenance(values)[0])

    def test_data_url(self):
        value = reference(); value["data"] = "data:image/png;base64," + value["data"]
        self.assertEqual(len(self.parse([value])), 1)

    def test_empty_default_and_unconfigured(self):
        self.assertEqual(refs.parse({}, {}), [])
        self.assertFalse(refs.capabilities({})["editing"])
        with self.assertRaises(images.ImageRequestError):
            refs.parse({"references": [reference()]}, {})

    def test_bad_inputs(self):
        for values in [[], None, {}, [reference()] * 4, [{"data": "https://example.com/image.png"}],
                       [{"data": "C:/private.png"}], [{"url": "https://example.com"}],
                       [dict(reference(), data="!!!!")], [dict(reference(), data=base64.b64encode(b"not png").decode())],
                       [dict(reference(), role="unknown")], [reference("style")], [reference(), reference()],
                       [dict(reference(), name="\0bad")], [dict(reference(), data="A" * 10_666_740)]]:
            with self.subTest(shape=str(type(values))), self.assertRaises(images.ImageRequestError):
                self.parse(values)

    def test_pixel_and_byte_limits(self):
        with mock.patch.object(refs, "MAX_PIXELS", 100), self.assertRaises(images.ImageRequestError):
            self.parse([reference()])
        with mock.patch.object(refs, "MAX_TOTAL", 10), self.assertRaises(images.ImageRequestError):
            self.parse([reference()])

    def test_animated_rejected(self):
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(output, "PNG", save_all=True, append_images=[Image.new("RGB", (8, 8), "blue")])
        with self.assertRaises(images.ImageRequestError):
            self.parse([dict(reference(), data=base64.b64encode(output.getvalue()).decode())])

    def test_process_reference_order_and_cleanup(self):
        job = images.parse_request({"prompt": "change the sky", "seed": 0}, self.cfg)
        job["references"] = self.parse([reference(), reference("style")])
        captured = []
        def args(cfg, prepared, out):
            captured.extend(Path(path).read_bytes() for path in prepared["reference_paths"])
            command = fake_args(cfg, prepared, out)
            self.assertEqual(command.count("-r"), 2)
            self.assertIn("--llm_vision", command)
            return command
        gen = images.ImageGen(self.cfg)
        with mock.patch.object(images, "sd_cli_args", args):
            outputs, _ = gen.run(job)
        self.assertEqual(captured, [r["png"] for r in job["references"]])
        self.assertTrue(outputs[0].startswith(b"\x89PNG"))
        self.assertEqual(list(gen.dir.iterdir()), [])

    def test_cleanup_on_start_failure_and_cancel(self):
        job = images.parse_request({"prompt": "x"}, self.cfg)
        job["references"] = self.parse([reference()])
        gen = images.ImageGen(self.cfg)
        with mock.patch.object(images.subprocess, "Popen", side_effect=OSError("cannot start")), self.assertRaises(images.ImageJobFailed):
            gen.run(job)
        self.assertIsNone(gen.progress)
        self.assertEqual(list(gen.dir.iterdir()), [])
        cancel = threading.Event(); cancel.set()
        with mock.patch.object(images, "sd_cli_args", fake_args), mock.patch.dict(os.environ, {"FAKE_SD_SLEEP": "10"}), self.assertRaises(images.ImageJobFailed):
            gen.run(job, cancel)
        self.assertEqual(list(gen.dir.iterdir()), [])


@mock.patch.object(images, "sd_cli_args", fake_args)
class ReferenceHttp(unittest.TestCase):
    setUp = baseline.OverHttp.setUp
    tearDown = baseline.OverHttp.tearDown
    post = baseline.OverHttp.post
    get = baseline.OverHttp.get

    def enable(self):
        self.svc.images.cfg["llm_vision"] = self.svc.images.cfg["llm"]

    def test_capabilities_and_authorization(self):
        self.assertFalse(json.loads(self.get("/v1/images/capabilities")[1])["editing"])
        self.enable()
        self.assertTrue(json.loads(self.get("/v1/images/capabilities")[1])["editing"])
        self.svc.api_key = "test-key"
        self.assertEqual(self.get("/v1/images/capabilities")[0], 401)
        self.assertEqual(self.post({"prompt": "x", "references": [reference()]}, "/v1/images/edits")[0], 401)

    def test_shared_routes_and_provenance(self):
        self.enable()
        self.svc.api_monitor = True
        for route, operation in [("edits", "edit"), ("generations", "generate")]:
            code, body = self.post({"prompt": "change color", "seed": 0, "references": [reference(), reference("style")]}, "/v1/images/" + route)
            self.assertEqual(code, 200, body)
            self.assertEqual(body["operation"], operation)
            self.assertEqual(body["data"][0]["seed"], 0)
            self.assertEqual([r["role"] for r in body["references"]], ["source", "style"])
            self.assertNotIn("data", body["references"][0])
        self.assertEqual(list(self.svc.images.dir.iterdir()), [])
        self.assertEqual(self.svc.request_records(), [])  # Image requests are not retained by the chat monitor.

    def test_invalid_edit_does_not_take_gpu(self):
        self.enable()
        for values in [[], [{"data": "bad"}]]:
            self.assertEqual(self.post({"prompt": "x", "references": values}, "/v1/images/edits")[0], 400)
        self.assertFalse(self.svc.fifo.locked())
        self.assertEqual(self.svc.images.totals["jobs"], 0)

    def test_failed_edit_releases_gpu(self):
        self.enable()
        with mock.patch.dict(os.environ, {"FAKE_SD_FAIL": "1"}):
            self.assertEqual(self.post({"prompt": "x", "references": [reference()]}, "/v1/images/edits")[0], 500)
        self.assertFalse(self.svc.status["busy"])
        self.assertFalse(self.svc.fifo.locked())
        self.assertEqual(list(self.svc.images.dir.iterdir()), [])


class ReferenceGpu(unittest.TestCase):
    def test_projector_and_encoding_reserve(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = image_cfg(directory, need_mib=1)
            cfg["llm_vision"] = cfg["llm"]
            gen = images.ImageGen(cfg)
            engine = baseline.FakeEngine(elastic=True)
            svc = baseline.Policy().svc(engine)
            svc.vram_reserve = 512
            with mock.patch.object(svc, "free_vram_mib", return_value=2000):
                with images.gpu_turn(svc, gen, {"width":512, "height":512, "references":[{}, {}]}) as policy:
                    self.assertEqual(policy, "shrink")
                    self.assertEqual(engine.calls[0], ("vram", 2049))
            self.assertEqual(engine.calls[-1], ("vram", 512))

    def test_handoff_failure_clears_busy_and_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            gen = images.ImageGen(image_cfg(directory, gpu_policy="unload"))
            engine = baseline.FakeEngine()
            svc = baseline.Policy().svc(engine)
            with mock.patch.object(images, "_make_room", side_effect=RuntimeError("unload failed")), self.assertRaises(RuntimeError):
                with images.gpu_turn(svc, gen, {"width":512, "height":512}):
                    self.fail("must not run image job")
            self.assertFalse(svc.status["busy"])
            self.assertFalse(svc.fifo.locked())


if __name__ == "__main__":
    unittest.main()
