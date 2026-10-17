"""Opt-in installed-model registry. No discovery, downloads, or config writes."""
import contextlib
import hashlib
import json
import re
import threading
from pathlib import Path


class RegistryError(Exception):
    def __init__(self, message, code="model_invalid", status=400):
        super().__init__(message)
        self.code, self.status = code, status


class Registry:
    def __init__(self, svc, entries, factory):
        self.svc, self.entries, self.factory = svc, entries, factory
        self.default = svc.model
        self.aliases = {alias: self.default for alias in svc.aliases}
        if self.default not in entries or set(entries) & set(self.aliases):
            raise ValueError("registry must contain the startup model and must not shadow its aliases")
        self.gate = threading.Lock()
        self.stopping = False
        self.requested = self.default
        self.failure = None

    def resolve(self, name):
        name = self.default if name is None else name
        if not isinstance(name, str):
            raise RegistryError("model must be a registered ID", "model_not_found", 404)
        name = self.aliases.get(name, name)
        if name not in self.entries:
            raise RegistryError("unknown model; choose an ID from /v1/models", "model_not_found", 404)
        return name

    def state(self):
        return {"default_model": self.default, "active_model": self.svc.model,
                "requested_model": self.requested, "loaded": self.svc.loaded(), "load_error": self.failure}

    def listing(self):
        return [{"id": key, "object": "model", "switchable": True,
                 "active": key == self.svc.model,
                 "meta": {"n_ctx": entry["max_context"]},
                 "architecture": {"input_modalities": ["text", "image"] if entry.get("vision") else ["text"],
                                  "output_modalities": ["text"]}}
                for key, entry in self.entries.items()]

    @contextlib.contextmanager
    def admission(self):
        # Hold across preparation, streaming, MCP, and chat-image-chat, including
        # the intervals in which the FIFO is deliberately released for images.
        if not self.gate.acquire(blocking=False):
            raise RegistryError("another request or model transition is active; retry manually when it finishes",
                                "model_busy", 409)
        try:
            if self.stopping:
                raise RegistryError("the server is stopping", "model_busy", 409)
            yield
        finally:
            self.gate.release()

    def close(self):
        self.stopping = True
        # A transition may still be replacing svc.engine when HTTP stops
        # accepting connections. Wait for that request before closing it.
        with self.gate:
            getattr(self.svc.engine, "close", self.svc.engine.unload)()
            if self.svc.vision:
                self.svc.vision.shutdown()

    def switch(self, name):
        target = self.resolve(name)
        self.requested = target
        if target == self.svc.model:
            if self.svc.loaded():
                self.failure = None
            return
        svc = self.svc
        # Factory performs all filesystem/tokenizer/template checks without
        # starting any process. Recheck on every switch, not just at startup.
        try:
            candidate = self.factory(target, self.entries[target])
        except Exception:
            raise RegistryError("installed model validation failed; check its registry assets") from None
        if not svc.fifo.acquire(blocking=False):
            if candidate.vision:
                candidate.vision.shutdown()
            raise RegistryError("GPU ownership is busy; retry after the current job", "model_busy", 409)
        fields = ("engine", "tok", "template", "model", "vision", "literals", "stop_ids",
                  "sampling_defaults", "effort_end", "prompts", "model_arch")
        previous = {field: getattr(svc, field) for field in fields}
        try:
            with svc.status_lock:
                if svc.status.get("busy") or svc.status.get("queued"):
                    raise RegistryError("inference is running or queued", "model_busy", 409)
            # An uncertain unload is fatal to the transition: never start a
            # second engine when the old process cannot be confirmed stopped.
            stop(svc)
            discard_restore(svc)
            svc.vision_held = False
            svc.vram_reserve = None
            svc.vram_reserve_asked = False
            for field in fields:
                setattr(svc, field, getattr(candidate, field))
            if getattr(svc, "telemetry", None) is not None and hasattr(svc.engine, "gpu_busy"):
                svc.engine.gpu_busy = lambda: (svc.telemetry.snapshot()["now"].get("gpu_util") or 0) >= 10
            svc.conv_log = type(svc.conv_log)()
            svc.last_timings = None
            with svc.status_lock:
                svc.status.update(prompt_tokens=0, generated=0, tail="")
            try:
                svc.ensure_loaded()
                self.failure = None
                if previous["vision"]:
                    previous["vision"].shutdown()
            except Exception:
                # unload must succeed before the previous engine can return.
                stop(svc)
                if svc.vision:
                    svc.vision.shutdown()
                for field, value in previous.items():
                    setattr(svc, field, value)
                try:
                    svc.ensure_loaded()
                    self.failure = "load_failed_previous_restored"
                except Exception:
                    stop(svc)
                    self.failure = "load_failed_rollback_failed"
                raise RegistryError("model load failed; inspect active_model, loaded and load_error in /v1/model-selection",
                                    self.failure, 503) from None
        finally:
            svc.fifo.release()
            if svc.engine is not candidate.engine and candidate.vision:
                candidate.vision.shutdown()


def stop(svc):
    svc.engine.unload()
    if svc.loaded():
        raise RegistryError("chat process did not stop; no replacement was started", "model_stop_failed", 503)
    if svc.vision:
        # Vision.close tolerates process failures. Keep the old handle so that
        # a failure to reap cannot allow a second GPU encoder to start.
        proc = getattr(svc.vision, "proc", None)
        svc.vision.unload()
        if proc is not None and proc.poll() is None:
            raise RegistryError("vision process did not stop; no replacement was started",
                                "model_stop_failed", 503)


def discard_restore(svc):
    pending, svc.restore_after_load = svc.restore_after_load, None
    if pending and svc.images is not None:
        path = Path(pending)
        if path.parent.resolve() == svc.images.dir.resolve() and re.fullmatch(r"llm-session-[0-9a-f]{12}\.bin", path.name):
            with contextlib.suppress(OSError):
                path.unlink(missing_ok=True)


def installed_profile(cfg):
    """Validate the native pack's recorded shard provenance and tokenizer binding.

    Size/name provenance catches accidental cross-model packs, not malicious
    weights. The registry is administrator-owned, just like the startup config.
    """
    if not isinstance(cfg, dict):
        raise ValueError("model profile must be an object")
    allowed = {"exe", "args", "cwd", "tokenizer", "tokenizer_sha256", "vision", "sampling", "log",
               "env", "gpu", "backend", "engine_silence_s", "effort_position", "vram_elastic",
               "vram_segment_mib", "max_context"}
    if set(cfg) - allowed:
        raise ValueError("unsupported model profile option")
    args = cfg.get("args", [])
    if not isinstance(args, list) or not all(isinstance(x, str) for x in args):
        raise ValueError("profile args must be strings")
    if cfg.get("replicas") or cfg.get("parallel", 1) != 1 or any(x in args for x in ("--batch", "--slots")):
        raise ValueError("registry currently supports a single engine and slot")
    def asset(value, directory=False):
        path = Path(value)
        if not path.is_absolute():
            path = Path(cfg.get("cwd") or ".") / path
        if not (path.is_dir() if directory else path.is_file()):
            raise ValueError("required model asset is missing")
        return path.resolve()
    def flag(name):
        if args.count(name) != 1:
            raise ValueError("profile needs exactly one " + name)
        return args[args.index(name) + 1]
    asset(cfg["exe"])
    pack, native = asset(flag("--pack"), True), asset(flag("--native"))
    tokenizer = asset(cfg["tokenizer"], True)
    if tokenizer != (pack / "tokenizer").resolve():
        raise ValueError("tokenizer must belong to the selected pack")
    for filename in ("dense.bin", "index.txt", "native_experts.txt", "conversions.json"):
        asset(str(pack / filename))
    provenance = json.loads((pack / "conversions.json").read_text(encoding="utf-8"))["source_shards"]
    if not provenance or native.name != provenance[0]["name"]:
        raise ValueError("native shard does not match pack provenance")
    for shard in provenance:
        path = asset(str(native.parent / shard["name"]))
        if path.parent != native.parent or path.stat().st_size != shard["size"]:
            raise ValueError("shard size does not match pack provenance")
    if native.name not in (pack / "native_experts.txt").read_text(encoding="utf-8").splitlines()[0]:
        raise ValueError("native expert index belongs to another model")
    for name in ("--ple-gguf", "--expert-profile"):
        if name in args:
            asset(flag(name))
    if "--mtp" in args:
        asset(flag("--mtp"), True)
    if "--ple-gguf" in args and asset(flag("--ple-gguf")) not in {
            (native.parent / shard["name"]).resolve() for shard in provenance}:
        raise ValueError("PLE shard must belong to the selected model")
    for filename in ("vocab.json", "merges.txt", "token_type.json", "chat_template.jinja"):
        asset(str(tokenizer / filename))
    # An explicit administrator fingerprint protects against an accidentally
    # copied tokenizer/template directory within an otherwise correct pack.
    digest = hashlib.sha256()
    for filename in ("vocab.json", "merges.txt", "token_type.json", "chat_template.jinja"):
        digest.update((tokenizer / filename).read_bytes())
    if digest.hexdigest() != cfg.get("tokenizer_sha256"):
        raise ValueError("tokenizer/template fingerprint mismatch")
    vision = cfg.get("vision")
    if vision:
        for key in ("exe", "model", "mmproj"):
            asset(vision[key])
        if asset(vision["model"]) != native:
            raise ValueError("vision model must match the native chat shard")
    ctx = int(flag("--max-context"))
    if ctx <= 0:
        raise ValueError("max context must be positive")
    return ctx


def from_config(svc, cfg, factory):
    entries = cfg.get("model_registry")
    if entries is None:
        return None
    if cfg.get("replicas") or cfg.get("parallel", 1) != 1 or any(
            flag in cfg.get("args", []) for flag in ("--batch", "--slots")):
        raise ValueError("model switching requires a single engine and slot at startup")
    if not isinstance(entries, dict) or not entries or len(entries) > 16:
        raise ValueError("model_registry must contain 1..16 installed profiles")
    for key, profile in entries.items():
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", key):
            raise ValueError("invalid registry public ID")
        profile["max_context"] = installed_profile(profile)
    startup = entries.get(svc.model, {})
    for key in ("exe", "args", "cwd", "tokenizer", "vision", "gpu", "env", "sampling", "effort_position", "vram_elastic"):
        if startup.get(key) != cfg.get(key):
            raise ValueError("startup registry profile must match the running configuration: " + key)
    return Registry(svc, entries, factory)
