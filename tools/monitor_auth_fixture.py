"""CPU-only chat/monitor authentication fixture on localhost:8093, with a fake key."""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from serve.server import serve
from serve.test_model_registry import service

if __name__ == "__main__":
    svc = service("monitor-fixture-no-gpu")
    svc.api_key = "monitor-fixture-key"
    svc.api_monitor = True
    httpd = serve(svc, port=8093)
    print("Monitor auth fixture: http://127.0.0.1:8093 (fake key, CPU only)", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        httpd.server_close()
