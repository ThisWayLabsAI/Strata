"""Opt-in native smoke test, one dev GPU server at a time. Stop live with its controls first.

Run with the installed Strata Python. No config, model, package or key changes.
Fixtures/results/reports stay under Strata-data, outside Git. Never replays a failed job.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DATA = Path(r"C:\AI\Strata-data")


def listening(port):
    # Windows drops closed-port connections, and TIME_WAIT can prevent an exclusive
    # bind after shutdown. Query listeners explicitly; query failures fail closed.
    if os.name == "nt":
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "$ErrorActionPreference='Stop'; $tcp=@(Get-NetTCPConnection -State Listen); "
            f"if ($tcp | Where-Object LocalPort -eq {int(port)}) {{ 'true' }} else {{ 'false' }}"],
            capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        value = result.stdout.strip()
        if value not in ("true", "false"):
            raise RuntimeError("Could not verify Windows TCP listeners")
        return value == "true"
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
            return False
    except OSError as error:
        if error.errno == 98 or getattr(error, "winerror", None) == 10048:
            return True
        raise


def fixtures(folder):
    from PIL import Image, ImageDraw
    source = Image.new("RGB", (512, 512), "#eeeeee")
    draw = ImageDraw.Draw(source)
    draw.rectangle((160, 210, 352, 385), fill="#d92525", outline="black", width=6)
    draw.rectangle((180, 100, 332, 220), fill="#d92525", outline="black", width=6)
    draw.ellipse((205, 135, 230, 160), fill="white")
    draw.ellipse((282, 135, 307, 160), fill="white")
    draw.rectangle((222, 183, 290, 193), fill="black")
    draw.line((256, 100, 256, 70), fill="black", width=7)
    draw.ellipse((244, 50, 268, 74), fill="#ffda00", outline="black", width=3)
    draw.rectangle((184, 385, 224, 445), fill="#183ac4")
    draw.rectangle((288, 385, 328, 445), fill="#183ac4")
    draw.rectangle((105, 235, 159, 300), fill="#d92525", outline="black", width=5)
    draw.rectangle((353, 235, 407, 300), fill="#d92525", outline="black", width=5)
    draw.polygon([(256, 250), (270, 280), (304, 284), (280, 307), (286, 341),
                  (256, 325), (226, 341), (232, 307), (208, 284), (242, 280)], fill="#ffda00")
    style = Image.new("RGB", (512, 512), "#f4d4b4")
    d = ImageDraw.Draw(style)
    for x in range(0, 512, 64):
        d.rectangle((x, 0, x + 31, 511), fill="#f47738")
    values = []
    for name, image in (("red-robot-source", source), ("orange-stripe-style", style)):
        output = io.BytesIO(); image.save(output, "PNG")
        raw = output.getvalue(); (folder / f"{name}.png").write_bytes(raw)
        values.append(base64.b64encode(raw).decode("ascii"))
    return values


class Client:
    def __init__(self, cfg, port=8081):
        self.cfg, self.port = cfg, port

    def open(self, route, body=None, timeout=600):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{route}",
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.cfg["api_key"], "Content-Type": "application/json"})
        return urllib.request.urlopen(req, timeout=timeout)

    def request(self, route, body=None, timeout=600):
        with self.open(route, body, timeout) as response:
            return json.load(response)

    def chat(self, prompt, **extra):
        return {"model": self.cfg["model_name"], "messages": [{"role": "user", "content": prompt}],
                "temperature": 0, "reasoning_effort": "low", "max_tokens": 1536, **extra}

    def arithmetic(self):
        result = self.request("/v1/chat/completions", self.chat("What is 17 multiplied by 23? Give the number only."))
        answer = result["choices"][0]["message"].get("content", "")
        assert "391" in answer, f"Arithmetic recovery failed: {answer}"
        return answer

    def wait_idle(self):
        for _ in range(120):
            status = self.request("/v1/status", timeout=5)
            if not status["activity"]["in_flight"]:
                return status
            time.sleep(.5)
        raise RuntimeError("Service still has an in-flight request after cancellation")


def run_model(model, folder, refs):
    if listening(8080) or listening(8081):
        raise RuntimeError("Stop live and other development servers first; ports 8080/8081 must be closed")
    path = ROOT / f"strata-dev-{model}.json"
    original_config = path.read_bytes()
    cfg = json.loads(original_config)
    client = Client(cfg)
    env = dict(os.environ)
    for key, relative in {"TEMP": "tmp", "TMP": "tmp", "UV_CACHE_DIR": "cache/uv", "UV_TOOL_DIR": "cache/uv-tools",
                          "UV_TOOL_BIN_DIR": "cache/uv-bin", "CUDA_CACHE_PATH": "cache/cuda"}.items():
        location = DATA / relative; location.mkdir(parents=True, exist_ok=True); env[key] = str(location)
    env["UV_PYTHON"] = sys.executable
    report = {"model": cfg["model_name"], "config_sha256": hashlib.sha256(original_config).hexdigest(),
              "configured_policy": cfg["images"].get("gpu_policy", "auto"), "tests": {}}
    log_path = folder / f"{model}-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen([sys.executable, "-u", str(ROOT / "serve/server.py"), "--engine", "strata",
            "--config", str(path), "--port", "8081"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            for _ in range(60):
                if proc.poll() is not None:
                    raise RuntimeError(f"Owned {model} test server exited; inspect {log_path}")
                try:
                    health = client.request("/health", timeout=2)
                    break
                except OSError:
                    time.sleep(1)
            else:
                raise RuntimeError("Test server startup timed out")
            assert health["model"] == cfg["model_name"] and health["chat_image_editing"]
            assert health["max_context"] == 131072 and not health["loaded"]
            report["tests"]["lazy_start"] = health
            print(f"{model}: lazy startup verified; loading chat", flush=True)
            report["tests"]["chat_before"] = client.arithmetic()
            source = {"id": "source-1", "role": "source", "data": refs[0]}
            style = {"id": "style-2", "role": "style", "data": refs[1]}
            from serve.image_references import parse, provenance
            for operation, seed, chosen, prompt in [
                ("generate", 901, [source, style], "Create a NEW 512x512 image using the selected robot identity and orange-striped visual style. "
                 "Place the robot on a small platform. Use generate_image once, seed 901, reference_ids source-1 then style-2. This is an image creation request, not prompt writing."),
                ("edit", 902, [source], "EDIT the selected robot source image: change its red head, body and arms to bright green. "
                 "Preserve the yellow chest star, blue legs, frontal pose and light grey background. Use edit_image once, size 512x512, seed 902, "
                 "reference_ids source-1. Show the edited image, not instructions.")]:
                print(f"{model}: {operation} through chat", flush=True)
                started = time.monotonic()
                result = client.request("/v1/chat/completions", client.chat(prompt, strata_images=True,
                    strata_image_request={"operation": operation, "references": chosen}))
                message = result["choices"][0]["message"]
                events = message.get("strata_images", [])
                completed = [event for event in events if event["state"] == "completed"]
                if len(completed) != 1:
                    raise RuntimeError(f"{model} {operation} did not complete one image: " + json.dumps({
                        "content": message.get("content"), "events": events}))
                event = completed[0]
                assert not any(e["state"] in ("failed", "recovery_failed", "cancelled") for e in events)
                recipe = event["recipe"]
                assert recipe["operation"] == operation and recipe["seed"] == seed and recipe["size"] == "512x512"
                expected = provenance(parse({"references": [{"data": r["data"], "role": r["role"], "name": f"reference-{i+1}"}
                    for i, r in enumerate(chosen)]}, cfg["images"], edit=operation == "edit"))
                assert recipe["references"] == expected
                raw = base64.b64decode(event["b64_json"], validate=True)
                assert raw.startswith(b"\x89PNG\r\n\x1a\n")
                output = folder / f"{model}-{operation}-seed-{seed}.png"; output.write_bytes(raw)
                report["tests"][operation] = {"seconds_chat_image_chat": round(time.monotonic() - started, 2),
                    "recipe": recipe, "output": str(output), "bytes": len(raw), "continuation": message.get("content"),
                    "states": [e["state"] for e in events]}
                report["tests"][operation + "_chat_after"] = client.arithmetic()
                assert client.wait_idle()["activity"]["in_flight"] == 0
                print(f"{model}: {operation} completed and chat recovered", flush=True)
            print(f"{model}: testing edit disconnect cancellation", flush=True)
            body = client.chat("Edit this source image to make the robot purple. Use edit_image with reference_ids source-1, seed 903, size 512x512.",
                stream=True, strata_images=True, strata_image_request={"operation": "edit", "references": [source]})
            cancelled_at = None
            with client.open("/v1/chat/completions", body) as response:
                for line in response:
                    if not line.startswith(b"data:") or line[5:].strip() == b"[DONE]":
                        continue
                    chunk = json.loads(line[5:]); event = chunk.get("strata_image", {})
                    if event.get("state") == "generating" and event.get("step", 0) >= 1:
                        cancelled_at = {k: event[k] for k in ("state", "step", "steps")}
                        # Close the socket rather than draining the response; never retry this HTTP request.
                        response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
                        break
                    if event.get("state") in ("failed", "completed"):
                        raise RuntimeError("Cancellation test did not reach a running sampling step")
            assert cancelled_at, "Image tool was not called for cancellation test"
            report["tests"]["cancelled_at"] = cancelled_at
            report["tests"]["idle_after_cancel"] = client.wait_idle()["activity"]["in_flight"] == 0
            report["tests"]["chat_after_cancel"] = client.arithmetic()
            report["passed_transport_and_recovery"] = True
            print(f"{model}: cancellation and text recovery passed", flush=True)
        finally:
            if proc.poll() is None:
                try:
                    client.request("/v1/unload", {}, timeout=60)
                except OSError:
                    pass
                proc.terminate()
                try:
                    proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait(timeout=10)
            report["server_stopped"] = not listening(8081)
            report["config_unchanged"] = path.read_bytes() == original_config
            (folder / f"{model}-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"{model}: owned test server stopped; report saved", flush=True)
    assert report["server_stopped"] and report["config_unchanged"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("original", "sc117", "both"), default="both")
    args = parser.parse_args()
    folder = DATA / "logs" / ("chat-image-editing-" + time.strftime("%Y%m%d-%H%M%S"))
    folder.mkdir(parents=True, exist_ok=False)
    print(f"Evidence: {folder}", flush=True)
    refs = fixtures(folder)
    for model in ("original", "sc117") if args.model == "both" else (args.model,):
        run_model(model, folder, refs)


if __name__ == "__main__":
    main()
