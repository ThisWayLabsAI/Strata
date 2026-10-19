"""Paired, fresh-process text comparison; requires live to be stopped first.

Reads one existing dev config, never changes it. Temporary private configs are
removed on exit. Does not deploy or restart live. Results are functional samples,
not broad quality measurements. Both binaries use the same candidate server.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time

from chat_image_editing_smoke import Client, DATA, ROOT, listening


def confirm_no_workers():
    if os.name != "nt":
        raise RuntimeError("This local comparison requires the Windows worker check")
    for _ in range(30):
        check = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { "
            "$_.Name -in @('strata.exe','strata-vision.exe','sd-cli.exe') }) | ForEach-Object { $_.Name }"],
            capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        if not check.stdout.strip():
            return
        time.sleep(1)
    raise RuntimeError("Native workers still exist; refusing another GPU owner")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--pairs", type=int, default=3, choices=range(2, 9))
    args = parser.parse_args()
    if listening(8080) or listening(8081):
        raise RuntimeError("Stop live/dev servers before comparing engines")
    original = args.config.read_bytes()
    config_hash = hashlib.sha256(original).hexdigest()
    config = json.loads(original)
    folder = DATA / "logs" / ("upstream-engine-compare-" + time.strftime("%Y%m%d-%H%M%S"))
    folder.mkdir(parents=True, exist_ok=False)
    report = {"config_sha256": config_hash, "pairs": args.pairs, "samples": [],
              "same_candidate_server": True, "model": config["model_name"],
              "engines": {name: {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                          for name, path in (("baseline", args.baseline), ("candidate", args.candidate))}}
    env = dict(os.environ)
    env["CUDA_CACHE_PATH"] = str(DATA / "cache/cuda")
    env["TEMP"] = env["TMP"] = str(DATA / "tmp")
    prompts = [
        "Explain how to implement a bounded LRU cache in Python. Include lookup, eviction, and a small example.",
        "Write a short Python function that merges two sorted lists without changing the inputs. Explain its complexity.",
        "Describe a safe plan for retrying an HTTP request after a timeout. Explain idempotency with a concrete example.",
    ]

    def checkpoint():
        (folder / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    for pair in range(args.pairs):
        order = (("baseline", args.baseline), ("candidate", args.candidate))
        if pair % 2:
            order = tuple(reversed(order))
        for name, engine in order:
            if listening(8080) or listening(8081):
                raise RuntimeError("A server is still listening before the next sample")
            confirm_no_workers()
            cfg = dict(config)
            cfg["exe"] = str(engine.resolve())
            for key in ("mcp", "model_registry", "images"):
                cfg.pop(key, None)
            # Explicit sampling and the existing model/context/pack configuration
            # are identical. Vision stays lazy and is not invoked by text samples.
            private = folder / "private-config.json"
            private.write_text(json.dumps(cfg), encoding="utf-8")
            client = Client(cfg)
            proc = None
            try:
                with (folder / f"pair-{pair}-{name}.log").open("w", encoding="utf-8") as log:
                    proc = subprocess.Popen([sys.executable, "-u", str(ROOT/"serve/server.py"), "--engine", "strata",
                                             "--config", str(private), "--port", "8081"], cwd=ROOT, env=env,
                                            stdout=log, stderr=subprocess.STDOUT,
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                    for _ in range(60):
                        if proc.poll() is not None:
                            raise RuntimeError("Comparison server exited; inspect sample log")
                        try:
                            client.request("/health", timeout=2)
                            break
                        except OSError:
                            time.sleep(.5)
                    else:
                        raise RuntimeError("Comparison server startup timed out")
                    # Load/warm outside the measured request, then take one sample.
                    client.request("/v1/chat/completions", {"model": cfg["model_name"], "messages": [
                        {"role":"user", "content":"Reply READY."}], "max_tokens":16,
                        "temperature":0, "seed":4242, "reasoning_effort":"none"})
                    body = {"model": cfg["model_name"], "messages": [{"role":"user", "content":prompts[pair % len(prompts)]}],
                            "max_tokens":192, "temperature":0, "seed":4242, "reasoning_effort":"none"}
                    started = time.monotonic()
                    result = client.request("/v1/chat/completions", body)
                    elapsed = time.monotonic()-started
                    message = result["choices"][0]["message"]
                    content = message.get("content", "")
                    assert content and result["model"] == cfg["model_name"], "Missing answer or wrong model"
                    sample = {"pair":pair,"engine":name,"wall_s":round(elapsed,3),"usage":result.get("usage"),
                              "timings":result.get("timings"),"text":content,
                              "reasoning":message.get("reasoning_content", "")}
                    report["samples"].append(sample)
                    print(f"pair {pair+1} {name}: {sample['timings']}", flush=True)
                    checkpoint()
            finally:
                if proc and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=45)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=10)
                private.unlink(missing_ok=True)
                confirm_no_workers()
                assert args.config.read_bytes() == original, "Source config changed"
    report["text_equal_by_pair"] = [
        len({(row["text"], row["reasoning"]) for row in report["samples"] if row["pair"] == pair}) == 1
        for pair in range(args.pairs)]
    for name in ("baseline", "candidate"):
        rates = [row["timings"]["predicted_per_second"] for row in report["samples"]
                 if row["engine"] == name and row.get("timings") and row["timings"].get("predicted_per_second")]
        report[name + "_median_decode_tok_s"] = statistics.median(rates) if rates else None
    report["passed"] = True
    report["private_config_removed"] = not (folder/"private-config.json").exists()
    checkpoint()
    print(str(folder/"report.json"), flush=True)


if __name__ == "__main__":
    main()
