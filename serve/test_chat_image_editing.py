"""Request authorization and shared runner checks for explicit chat reference editing."""
import threading
import json
from pathlib import Path
from unittest import mock

from serve import images, test_images as baseline, test_mcp
from serve.chat_images import EDIT_NAME, NAME, ImageToolHub, request_inputs
from serve import test_chat_images as chat_baseline
from serve.test_image_references import reference


def selected(identity="source-1", role="source"):
    value = reference(role)
    return {"id": identity, "data": value["data"], "role": role}


@mock.patch.object(images, "sd_cli_args", baseline.fake_args)
class ChatEditing(chat_baseline.ChatImages):
    # Inherit the existing lifecycle regressions with the same mock-only runner.
    def configure(self):
        self.svc.images.cfg["llm_vision"] = self.svc.images.cfg["llm"]

    def request(self, operation="edit", references=None):
        return {"operation": operation, "references": [selected()] if references is None else references}

    def test_edit_uses_selected_bytes_and_recovers_without_fifo_reentry(self):
        self.start(test_mcp.call_script(EDIT_NAME, prompt="make the robot blue", size="512x512", seed=42,
                                       reference_ids=json.dumps(["source-1", "style-2"])), "</think>\n\nEdited", engine_class=chat_baseline.LifecycleEngine)
        self.configure()
        self.svc.images.policy = "unload"
        inputs = self.request(references=[selected(), selected("style-2", "style")])
        captured = []
        def args(cfg, job, out):
            self.assertFalse(self.engine.generating)
            self.assertTrue(self.svc.fifo.locked())
            self.assertIn("Image 1: source", job["prompt"])
            self.assertIn("Image 2: style", job["prompt"])
            captured.extend(Path(path).read_bytes() for path in job["reference_paths"])
            return baseline.fake_args(cfg, job, out)
        with mock.patch.object(images, "sd_cli_args", args):
            code, body = self.post(strata_images=True, strata_image_request=inputs)
        self.assertEqual(code, 200, body)
        result = next(event for event in body["choices"][0]["message"]["strata_images"] if event["state"] == "completed")
        self.assertEqual(result["name"], EDIT_NAME)
        self.assertEqual(result["recipe"]["operation"], "edit")
        self.assertEqual(result["recipe"]["seed"], 42)
        self.assertEqual([r["role"] for r in result["recipe"]["references"]], ["source", "style"])
        _, normalized = request_inputs({"strata_images": True, "strata_image_request": inputs}, self.svc.images.cfg)
        self.assertEqual(captured, [ref["png"] for ref in normalized])
        self.assertNotIn(inputs["references"][0]["data"], self.engine.prompt_text(1))
        self.assertIn("restore", str(self.engine.calls))
        self.assertFalse(self.svc.fifo.locked())
        self.assertEqual(list(self.svc.images.dir.iterdir()), [])

    def test_referenced_generation_and_exact_ids(self):
        self.start("</think>\n\nUnused")
        self.configure()
        inputs = self.request("generate", [selected(), selected("style-2", "style")])
        operation, refs = request_inputs({"strata_images": True, "strata_image_request": inputs}, self.svc.images.cfg)
        for ids in [None, [], ["foreign"], ["source-1", "source-1"], ["style-2", "source-1"]]:
            hub = ImageToolHub(self.svc, operation=operation, references=refs)
            args = {"prompt": "a new scene", "reference_ids": ids}
            self.assertFalse(hub.call(NAME, args, threading.Event(), call_id="bad")["ok"])
        self.assertEqual(self.svc.images.totals["jobs"], 0)
        hub = ImageToolHub(self.svc, operation=operation, references=refs)
        args = {"prompt": "a new scene", "reference_ids": ["source-1", "style-2"]}
        first = hub.call(NAME, args, threading.Event(), call_id="good")
        self.assertTrue(first["ok"])
        self.assertEqual(hub.call(NAME, args, threading.Event(), call_id="good"), first)
        self.assertFalse(hub.call(EDIT_NAME, args, threading.Event(), call_id="other")["ok"])
        self.assertEqual(self.svc.images.totals["jobs"], 1)
        self.assertEqual(next(e for e in hub.drain() if e["state"] == "completed")["recipe"]["operation"], "generate")

    def test_invalid_client_inputs_rejected_before_load(self):
        self.start("</think>\n\nUnused")
        self.configure()
        bad = [None, [], {}, {"operation": "other"}, self.request(references=[]),
               self.request(references=[selected("a", "style")]), self.request(references=[selected(), selected()]),
               self.request(references=[selected(str(i)) for i in range(4)]),
               self.request(references=[dict(selected(), data="https://example.com/source.png")]),
               self.request(references=[dict(selected(), name="C:/private.png")]),
               self.request(references=[selected("../private")])]
        # An explicitly null extension is malformed, not an implicit generate fallback.
        for value in bad:
            with self.subTest(value=type(value).__name__), mock.patch.object(self.svc, "load") as load:
                code, body = self.post(strata_images=True, strata_image_request=value)
                self.assertEqual(code, 400, body)
                load.assert_not_called()
        self.assertEqual(self.svc.images.totals["jobs"], 0)

    def test_disabled_unavailable_and_client_owned_edit(self):
        self.start(test_mcp.call_script(EDIT_NAME, prompt="edit", reference_ids=["source-1"]))
        self.configure()
        self.assertEqual(self.post(strata_image_request=self.request())[0], 400)
        owned = [{"type": "function", "function": {"name": EDIT_NAME, "parameters": {"type": "object"}}}]
        code, body = self.post(strata_images=True, strata_image_request=self.request(), tools=owned)
        self.assertEqual(code, 200, body)
        self.assertNotIn("strata_images", body["choices"][0]["message"])
        self.assertEqual(self.svc.images.totals["jobs"], 0)
        self.svc.images.cfg.pop("llm_vision")
        self.assertEqual(self.post(strata_images=True, strata_image_request=self.request())[0], 400)

    def test_analysis_and_cancellation_do_not_edit(self):
        self.start("</think>\n\nThis is a red square.")
        self.configure()
        code, body = self.post(strata_images=True, strata_image_request=self.request())
        self.assertEqual(code, 200, body)
        self.assertEqual(self.svc.images.totals["jobs"], 0)
        _, refs = request_inputs({"strata_images": True, "strata_image_request": self.request()}, self.svc.images.cfg)
        hub = ImageToolHub(self.svc, operation="edit", references=refs)
        cancel = threading.Event(); cancel.set()
        from serve.mcp import McpCancelled
        with self.assertRaises(McpCancelled):
            hub.call(EDIT_NAME, {"prompt": "blue", "reference_ids": ["source-1"]}, cancel, call_id="cancel")
        self.assertEqual(list(hub.drain())[-1]["state"], "cancelled")
        self.assertFalse(self.svc.fifo.locked())


if __name__ == "__main__":
    import unittest
    unittest.main()
