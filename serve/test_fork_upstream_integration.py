"""CPU regressions for registry integration with upstream 0.2.0 lifecycle and budgets."""
from pathlib import Path
import json
import os
import tempfile
import unittest
from unittest import mock

from serve import server
from serve.model_registry import Registry
from serve.test_model_registry import service


class ForkUpstreamIntegration(unittest.TestCase):
    def test_registry_budget_default_and_explicit_overrides(self):
        registry = {"model_registry": {"original": {}}}
        self.assertFalse(server.fit_max_tokens_of(registry))
        self.assertTrue(server.fit_max_tokens_of({}))
        for config in ({}, registry):
            self.assertTrue(server.fit_max_tokens_of({**config, "fit_max_tokens": True}))
            self.assertFalse(server.fit_max_tokens_of({**config, "fit_max_tokens": False}))
            self.assertTrue(server.fit_max_tokens_of(config, enabled=True))
            self.assertFalse(server.fit_max_tokens_of(config, disabled=True))

    def test_output_budget_fits_only_when_enabled_and_history_is_unchanged(self):
        svc = service(context=4096)
        messages = [{"role": "user", "content": "hello"}]
        svc.fit_max_tokens = server.fit_max_tokens_of({"model_registry": {}})
        with mock.patch.object(svc, "encode_prompt", return_value=[65] * 1024):
            with self.assertRaisesRegex(ValueError, "exceeds the context"):
                svc.prepare(messages, None, {}, max_new=4096)
            svc.fit_max_tokens = True
            self.assertEqual(svc.prepare(messages, None, {}, max_new=4096)[2], 3064)
        self.assertEqual(messages, [{"role": "user", "content": "hello"}])

    def test_main_keeps_auth_and_closes_selected_engine_with_lifecycle_cleanup(self):
        events, seen = [], {}
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            config = folder / "mock.json"
            config.write_text(json.dumps({"model_name": "original", "api_key": "fixture-key",
                                          "model_registry": {"fixture": {}}}), encoding="utf-8")
            ready_path = folder / "ready.json"

            def registry(svc, cfg, factory):
                seen["svc"] = svc
                self.assertFalse(svc.fit_max_tokens)
                return Registry(svc, {"original": {"max_context": 8192}, "sc117": {"max_context": 4096}},
                                lambda name, entry: service(name, entry["max_context"]))

            def fake_serve(svc, **kwargs):
                self.assertEqual(svc.api_key, "fixture-key")
                svc.engine = service().engine
                svc.model_registry.switch("sc117")
                seen["selected"] = svc.engine
                seen["close"] = mock.Mock(wraps=svc.engine.unload)
                svc.engine.unload = seen["close"]
                httpd = mock.Mock()
                httpd.server_address = ("127.0.0.1", 19873)
                return httpd

            with mock.patch("serve.model_registry.from_config", side_effect=registry), \
                 mock.patch.object(server, "serve", side_effect=fake_serve), \
                 mock.patch.object(server.time, "sleep", side_effect=KeyboardInterrupt), \
                 mock.patch.object(server.lifeline, "install_stop_handlers"), \
                 mock.patch("strata_control.private_files.adopt_user_defaults"), \
                 mock.patch.dict(os.environ, {"STRATA_API_KEY": "fixture-key"}):
                code = server.main(["--engine", "mock", "--config", str(config), "--port", "0",
                                    "--ready-file", str(ready_path), "--shutdown-timeout", "0"],
                                   lifecycle_event=lambda kind, payload: events.append((kind, payload)))
            self.assertEqual(code, 0)
            self.assertEqual(seen["svc"].model, "sc117")
            seen["close"].assert_called_once()
            self.assertFalse(seen["selected"].alive())
            self.assertTrue(seen["svc"].model_registry.stopping)
            self.assertFalse(ready_path.exists())
            self.assertEqual([kind for kind, _ in events], ["ready", "stopping", "draining", "stopped"])
            self.assertTrue(events[-1][1]["drained"])


if __name__ == "__main__":
    unittest.main()
