"""Native registry gate. Stop live through its controls first; never runs beside 8080.

Uses one owned development server and a temporary private registry config. Keeps
reports/outputs outside Git and deletes that credential-bearing config on exit.
Does not deploy source, change existing configs, or restart live automatically.
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
from pathlib import Path

from chat_image_editing_smoke import Client, DATA, ROOT, fixtures, listening
from model_registry_config import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, help="test this separately built engine; source configs remain unchanged")
    parser.add_argument("--configs", type=Path, nargs=2,
                        default=[ROOT / "strata-dev-original.json", ROOT / "strata-dev-sc117.json"],
                        metavar=("ORIGINAL", "SC117"),
                        help="existing dev configs to read when testing from an isolated worktree")
    args = parser.parse_args()
    if listening(8080) or listening(8081):
        raise RuntimeError("Stop live and other GPU servers before running this gate")
    folder = DATA / "logs" / ("model-switch-native-" + time.strftime("%Y%m%d-%H%M%S"))
    folder.mkdir(parents=True, exist_ok=False)
    paths = [*args.configs,
             Path(r"C:\AI\Strata\strata-iq2_xs.json"), Path(r"C:\AI\Strata\strata-sc117-iq2_xs.json")]
    before = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    cfg = build(paths[:2])
    if args.engine:
        engine = args.engine.resolve(strict=True)
        cfg["exe"] = str(engine)
        for profile in cfg["model_registry"].values():
            profile["exe"] = str(engine)
    ids = list(cfg["model_registry"])
    private = folder / "private-registry.json"
    private.write_text(json.dumps(cfg), encoding="utf-8")
    env = dict(os.environ)
    for key, name in {"TEMP":"tmp", "TMP":"tmp", "UV_CACHE_DIR":"cache/uv",
                      "UV_TOOL_DIR":"cache/uv-tools", "UV_TOOL_BIN_DIR":"cache/uv-bin", "CUDA_CACHE_PATH":"cache/cuda"}.items():
        target = DATA / name
        target.mkdir(parents=True, exist_ok=True)
        env[key] = str(target)
    env["UV_PYTHON"] = sys.executable
    report = {"implementation": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "engine_exe": cfg["exe"], "engine_sha256": hashlib.sha256(Path(cfg["exe"]).read_bytes()).hexdigest(),
              "configured_image_policy": cfg["images"].get("gpu_policy", "auto"), "models": {}, "transitions": [],
              "original_config_hashes": before}
    client = Client(cfg)
    source, _ = fixtures(folder)
    proc = None

    def checkpoint():
        (folder / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    def chat(model, prompt, **extra):
        result = client.request("/v1/chat/completions", {**client.chat(prompt), "model":model, **extra})
        assert result["model"] == model, "wrong serving model"
        return result["choices"][0]["message"]

    def arithmetic(model):
        message = chat(model, "What is 17 multiplied by 23? Give the number only.")
        assert "391" in message.get("content", ""), message
        return message.get("content")

    def busy(other):
        try:
            client.request("/v1/model-selection", {"model":other}, timeout=10)
        except urllib.error.HTTPError as error:
            with error:
                body = json.load(error)
                assert error.code == 409 and body["error"]["code"] == "model_busy", body
                return body["error"]["code"]
        raise AssertionError("switch was admitted during an active request")

    def switch(model):
        started = time.monotonic()
        state = client.request("/v1/model-selection", {"model":model})
        assert state["active_model"] == model and state["loaded"] and state["load_error"] is None, state
        report["transitions"].append({"target":model, "seconds":round(time.monotonic()-started, 2), "state":state})
        checkpoint()

    def chunks(response):
        for line in response:
            if line.startswith(b"data:") and line[5:].strip() != b"[DONE]":
                yield json.loads(line[5:])

    try:
        print(f"Evidence: {folder}", flush=True)
        with (folder / "server.log").open("w", encoding="utf-8") as log:
            proc = subprocess.Popen([sys.executable, "-u", str(ROOT / "serve/server.py"), "--engine", "strata",
                    "--config", str(private), "--port", "8081"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            for _ in range(90):
                if proc.poll() is not None:
                    raise RuntimeError("owned server exited; inspect server.log")
                try:
                    report["startup"] = client.request("/v1/model-selection", timeout=2)
                    break
                except OSError:
                    time.sleep(1)
            else:
                raise RuntimeError("lazy startup timed out")
            assert not report["startup"]["loaded"]
            for index, model in enumerate(ids):
                other = ids[1-index]
                tests = report["models"][model] = {}
                print(f"Selecting {model}", flush=True)
                switch(model)
                tests["arithmetic"] = arithmetic(model)
                history = [{"role":"user", "content":"Remember the project code is AZURE-728. Reply OK."}]
                first = chat(model, "", messages=history)
                history.append({"role":"assistant", "content":first.get("content", "OK")})
                switch(other)
                switch(model)
                rebuilt = chat(model, "", messages=history + [{"role":"user", "content":"What project code did I give you? Reply with the code."}])
                assert "AZURE-728" in rebuilt.get("content", ""), rebuilt
                tests["history_after_round_trip"] = rebuilt.get("content")
                tool = chat(model, "Look up the project layer-forge using the provided tool.", max_tokens=512,
                    tools=[{"type":"function", "function":{"name":"lookup_project", "description":"Find a project by name.",
                    "parameters":{"type":"object", "properties":{"name":{"type":"string"}}, "required":["name"]}}}],
                    tool_choice={"type":"function", "function":{"name":"lookup_project"}})
                calls = tool.get("tool_calls", [])
                assert calls and calls[0]["function"]["name"] == "lookup_project", tool
                assert json.loads(calls[0]["function"]["arguments"])["name"] == "layer-forge", tool
                tests["client_tool"] = calls
                vision = chat(model, "", messages=[{"role":"user", "content":[
                    {"type":"text", "text":"Describe the robot's main body color, chest symbol and legs."},
                    {"type":"image_url", "image_url":{"url":"data:image/png;base64,"+source}}]}])
                assert "red" in vision.get("content", "").lower(), vision
                tests["vision"] = vision.get("content")
                mcp = client.request("/mcp")
                tests["mcp_status"] = mcp
                assert mcp.get("tools", 0) >= 3, "expected existing web MCP tools"
                searched = chat(model, "Use the web search tool to search for 'Strata Niko1221 GitHub inference'. Give one short result.", strata_mcp=True)
                events = searched.get("strata_mcp", [])
                assert any(event.get("event") == "result" and event.get("ok") for event in events), searched
                tests["mcp_result"] = [{k:v for k,v in event.items() if k in ("event","name","ok","chars","ms")} for event in events]
                stream_body = {**client.chat("Write a long numbered list of 200 different workshop tools."), "model":model, "stream":True, "max_tokens":2048}
                with client.open("/v1/chat/completions", stream_body) as response:
                    for chunk in chunks(response):
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        if delta.get("content") or delta.get("reasoning_content"):
                            tests["busy_during_stream"] = busy(other)
                            response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
                            break
                client.wait_idle()
                time.sleep(.3)
                tests["chat_after_stream_cancel"] = arithmetic(model)
                for operation, seed in (("generate",1101+index*10), ("edit",1102+index*10)):
                    prompt = (f"Create a NEW image of a small red robot on a grey background. Use generate_image once, size 512x512, seed {seed}." if operation == "generate" else
                              f"EDIT the selected source: make the red robot green, keeping the yellow star and blue legs. Use edit_image once, reference_ids source-1, size 512x512, seed {seed}.")
                    extra = {"strata_images":True}
                    if operation == "edit":
                        extra["strata_image_request"] = {"operation":"edit", "references":[{"id":"source-1","role":"source","data":source}]}
                    started = time.monotonic()
                    message = chat(model, prompt, **extra)
                    events = message.get("strata_images", [])
                    completed = [event for event in events if event["state"] == "completed"]
                    assert len(completed) == 1 and not any(event["state"] in ("failed","cancelled","recovery_failed") for event in events), "image tool failed or absent"
                    output = completed[0]
                    assert output["recipe"]["seed"] == seed
                    raw = base64.b64decode(output["b64_json"], validate=True)
                    name = f"model-{index}-{operation}-seed-{seed}.png"
                    (folder/name).write_bytes(raw)
                    tests[operation] = {"output":name, "bytes":len(raw), "recipe":output["recipe"],
                        "seconds_chat_image_chat":round(time.monotonic()-started,2), "states":[event["state"] for event in events]}
                    tests[operation+"_chat_after"] = arithmetic(model)
                    checkpoint()
                body = {**client.chat("EDIT the selected robot purple. Use edit_image once, reference_ids source-1, size 512x512, seed 1199."),
                        "model":model, "stream":True, "strata_images":True,
                        "strata_image_request":{"operation":"edit","references":[{"id":"source-1","role":"source","data":source}]}}
                with client.open("/v1/chat/completions", body) as response:
                    for chunk in chunks(response):
                        event = chunk.get("strata_image", {})
                        if event.get("state") == "generating" and event.get("step",0) >= 1:
                            tests["busy_during_image"] = busy(other)
                            tests["cancelled_image_step"] = event["step"]
                            response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
                            break
                assert "cancelled_image_step" in tests, "did not reach running image cancellation"
                client.wait_idle()
                time.sleep(.3)
                tests["chat_after_image_cancel"] = arithmetic(model)
                checkpoint()
                print(f"{model}: native checks passed", flush=True)
            switch(ids[0])
            report["final_arithmetic"] = arithmetic(ids[0])
            report["passed"] = True
    except Exception as error:
        report["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        if proc is not None and proc.poll() is None:
            try:
                client.request("/v1/unload", {}, timeout=90)
            except OSError:
                pass
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
        private.unlink(missing_ok=True)
        report["private_config_removed"] = not private.exists()
        report["server_stopped"] = not listening(8081)
        report["original_configs_unchanged"] = all(hashlib.sha256(path.read_bytes()).hexdigest() == before[str(path)] for path in paths)
        checkpoint()
        print("Owned development server stopped; private config removed. Restore live through its controls.", flush=True)


if __name__ == "__main__":
    main()
