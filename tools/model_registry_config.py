"""Validate installed profiles on CPU; optionally create a separate, private run config.

Never edits source configs. Output contains the startup config's credentials and
must remain local. This tool does not start, stop, or load any server or engine.
"""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from serve.model_registry import from_config

PROFILE_KEYS = {"exe", "args", "cwd", "tokenizer", "vision", "sampling", "log", "env", "gpu", "backend",
                "engine_silence_s", "effort_position", "vram_elastic", "vram_segment_mib"}


def build(paths):
    configs = [json.loads(Path(path).read_text(encoding="utf-8-sig")) for path in paths]
    result = copy.deepcopy(configs[0])
    entries = {}
    for cfg in configs:
        model = cfg["model_name"]
        if model in entries:
            raise ValueError("duplicate model_name")
        if cfg.get("replicas") or cfg.get("parallel", 1) != 1:
            raise ValueError("only single-engine configs are supported")
        profile = {key: copy.deepcopy(value) for key, value in cfg.items() if key in PROFILE_KEYS}
        digest = hashlib.sha256()
        tokenizer = Path(profile["tokenizer"])
        if not tokenizer.is_absolute():
            tokenizer = Path(profile.get("cwd") or ".") / tokenizer
        for filename in ("vocab.json", "merges.txt", "token_type.json", "chat_template.jinja"):
            digest.update((tokenizer / filename).read_bytes())
        profile["tokenizer_sha256"] = digest.hexdigest()
        entries[model] = profile
    result["model_registry"] = entries
    aliases = result.get("aliases", [])
    if isinstance(aliases, str):
        aliases = [name.strip() for name in aliases.split(",") if name.strip()]
    from_config(SimpleNamespace(model=result["model_name"], aliases=aliases), result, None)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("configs", nargs="+", help="startup config first, then installed alternatives")
    parser.add_argument("--output", type=Path, help="new private config; refuses overwrite (omit for validation only)")
    parser.add_argument("--prepare", action="store_true", help="also construct CPU-only native replacements without starting processes")
    args = parser.parse_args()
    cfg = build(args.configs)
    if args.prepare:
        from serve.server import installed_model_service
        for key, profile in cfg["model_registry"].items():
            candidate = installed_model_service(key, profile)
            try:
                assert candidate.engine.proc is None and not candidate.loaded()
                assert candidate.vision is None or candidate.vision.proc is None
            finally:
                if candidate.vision:
                    candidate.vision.shutdown()
        print("Prepared native tokenizer/template/engine objects on CPU; no child processes started.")
    if args.output:
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(cfg, output, indent=2)
        print("Created separate private run config. Keep it out of Git; it contains the existing API key.")
    print(json.dumps({"validation": "CPU asset checks only; no engine started", "models": [
        {"id": key, "context": profile["max_context"], "vision": bool(profile.get("vision"))}
        for key, profile in cfg["model_registry"].items()]}, indent=2))
