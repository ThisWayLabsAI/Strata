"""Hardened input boundaries: no private file read or network fetch during tests."""
import json
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from serve.frontend import ChatTemplate
from serve.server import ByteTokenizer, MockEngine, Service, serve, vision_input_policy_of


class VisionInputPolicy(unittest.TestCase):
    def setUp(self):
        tok = ByteTokenizer()
        self.svc = Service(MockEngine(tok, "OK", max_context=8192), tok,
                           ChatTemplate(Path(__file__).parent / "chat_template.jinja"))
        self.svc.vision_input_policy = "uploads_only"
        self.httpd = serve(self.svc, port=0)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def post(self, path, body):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            return response.status, json.load(response)

    def test_config_is_opt_in_and_invalid_values_fail(self):
        self.assertEqual(vision_input_policy_of({}), "legacy")
        self.assertEqual(vision_input_policy_of({"vision_input_policy": "uploads_only"}), "uploads_only")
        for value in (None, True, [], "upload_only"):
            with self.assertRaises(ValueError):
                vision_input_policy_of({"vision_input_policy": value})

    def test_uploaded_image_data_is_allowed_but_paths_urls_and_other_data_are_rejected(self):
        self.svc.validate_vision_inputs([{"content": [{"type": "image", "source": "data:image/png;base64,aGVsbG8="}]}])
        for source in ("C:/private.png", "file:///C:/private.png", "\\\\server\\share\\x.png", "http://127.0.0.1/x",
                       "https://example.org/x.png", "data:text/plain;base64,aGVsbG8=", "data:image/png,raw"):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "uploads_only"):
                self.svc.validate_vision_inputs([{"content": [{"type": "image", "source": source}]}])

    def test_all_http_dialects_reject_before_loading_or_fetching(self):
        for source in ("file:///C:/private.png", "http://127.0.0.1/private", "https://example.org/image.png"):
            messages = [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": source}}]}]
            anthropic = [{"role": "user", "content": [{"type": "image", "source": {"type": "url", "url": source}}]}]
            cases = [("/v1/chat/completions", {"messages": messages}),
                     ("/v1/responses", {"input": [{"role": "user", "content": [{"type": "input_image", "image_url": source}]}]}),
                     ("/v1/messages", {"messages": anthropic, "max_tokens": 16}),
                     ("/v1/messages/count_tokens", {"messages": anthropic})]
            for path, body in cases:
                with self.subTest(path=path, source=source), mock.patch.object(self.svc, "load") as load, \
                     mock.patch("serve.server.Vision.download") as download, mock.patch("serve.server.Vision.load") as read:
                    code, reply = self.post(path, body)
                    self.assertEqual(code, 400, reply)
                    self.assertIn("uploads_only", json.dumps(reply))
                    load.assert_not_called()
                    download.assert_not_called()
                    read.assert_not_called()

    def test_tool_image_cannot_bypass_policy_in_prepare(self):
        messages = [{"role": "tool", "content": [{"type": "image", "source": "http://127.0.0.1/private"}]}]
        with mock.patch("serve.server.Vision.download") as download:
            with self.assertRaisesRegex(ValueError, "uploads_only"):
                self.svc.prepare(messages, None, {})
            download.assert_not_called()

    def test_legacy_validation_remains_compatible(self):
        self.svc.vision_input_policy = "legacy"
        self.svc.validate_vision_inputs([{"content": [{"type": "image", "source": "https://example.org/x.png"}]}])
