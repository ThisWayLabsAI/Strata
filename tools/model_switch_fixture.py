"""Real HTTP model routing and web UI, using CPU-only reloadable mock engines."""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from serve.model_registry import Registry
from serve.server import serve
from serve.test_model_registry import service


if __name__ == "__main__":
    svc = service()
    svc.engine.delay_s = .015
    def factory(name, entry):
        result = service(name, entry["max_context"])
        result.engine.delay_s = .015
        return result
    svc.model_registry = Registry(svc, {"original": {"max_context": 8192},
                                        "sc117": {"max_context": 4096}}, factory)
    httpd = serve(svc, port=8092)
    print("Model-switch fixture: http://127.0.0.1:8092 (CPU mocks only)", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        httpd.server_close()
