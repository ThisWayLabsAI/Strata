"""Request-scoped, opt-in image tool. Called only after a complete text inference turn."""
from __future__ import annotations

import base64
import json
import queue
import threading
import time
import uuid
from types import SimpleNamespace

from serve import images
from serve.mcp import McpCancelled

NAME = "generate_image"
TOOL = {"name": NAME, "description": (
    "Generate one NEW image from a detailed text prompt, only when the user explicitly asks you to create an image. "
    "Do not call for ordinary questions, image analysis or prompt-writing requests. This is text-to-image only: "
    "it cannot edit or directly use attached pictures as references. Use the Images workspace for reference editing. "
    "One attempt per chat request. The result is displayed inline; do not repeat the call or embed a made-up image URL."),
    "parameters": {"type": "object", "additionalProperties": False, "required": ["prompt"], "properties": {
        "prompt": {"type": "string", "minLength": 1, "maxLength": 16000},
        "size": {"type": "string", "enum": ["512x512", "768x768", "1024x1024", "1536x1024", "1024x1536"]},
        "seed": {"type": "integer", "minimum": 0, "maximum": 9007199254740991}}}}


class ImageToolHub:
    """Combine the built-in with existing MCP routing without an MCP subprocess or HTTP reentry."""

    def __init__(self, svc, hub=None):
        self.svc, self.hub = svc, hub
        self.settings = dict(hub.settings) if hub else {"max_rounds": 2}
        self.events = queue.Queue()
        self.lock = threading.Lock()
        self.active = None
        self.attempted = False
        self.results = {}
        self.completed_job = None

    def routes(self):
        return {**(self.hub.routes() if self.hub else {}), NAME: (SimpleNamespace(name="Strata"), NAME)}

    def emit(self, state, **fields):
        with self.lock:
            self._emit(state, **fields)

    def _emit(self, state, **fields):
        job = self.active
        job["sequence"] += 1
        job["state"] = state
        self.events.put({"id": job["call_id"], "job_id": job["job_id"], "name": NAME,
                         "sequence": job["sequence"], "state": state, **fields})

    def drain(self):
        # ImageGen reports actual sampling steps, not an estimated percentage.
        with self.lock:
            active = self.active and self.active["state"] == "generating"
            progress = self.svc.images.progress if active else None
            if progress and progress[1] != self.active.get("steps"):
                progress = None  # sd-cli also prints tensor-loading bars; those are not sampling steps.
            changed = active and progress and progress != self.active.get("progress")
            if changed:
                self.active["progress"] = progress
                self._emit("generating", step=progress[0], steps=progress[1])
        while True:
            try:
                yield self.events.get_nowait()
            except queue.Empty:
                return

    def call(self, name, arguments, cancel, *, call_id):
        if name != NAME:
            return self.hub.call(name, arguments, cancel)
        signature = json.dumps(arguments, sort_keys=True, ensure_ascii=False)
        if call_id in self.results:
            previous, result = self.results[call_id]
            if previous == signature:
                return result
            return self.result(False, "error: duplicate tool call ID with different arguments", 0)
        start = time.monotonic()
        self.active = {"call_id": call_id, "job_id": uuid.uuid4().hex, "sequence": 0, "state": "queued"}
        self.emit("queued")
        try:
            if self.attempted:
                raise images.ImageRequestError("only one image attempt per chat request; ask the user before a new attempt")
            self.attempted = True
            if not isinstance(arguments, dict) or set(arguments) - {"prompt", "size", "seed"}:
                raise images.ImageRequestError("generate_image accepts only prompt, size and optional seed; no references, URLs or paths")
            if "size" in arguments and arguments["size"] not in TOOL["parameters"]["properties"]["size"]["enum"]:
                raise images.ImageRequestError("unsupported image size")
            seed = arguments.get("seed")
            if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 9007199254740991):
                raise images.ImageRequestError("seed must be a safe nonnegative integer")
            job = images.parse_request({**arguments, "n": 1, "response_format": "b64_json"}, self.svc.images.cfg)
            self.active["steps"] = job["steps"]
            if cancel.is_set():
                raise McpCancelled()
            with images.gpu_turn(self.svc, self.svc.images, job, cancel, on_phase=self.emit) as policy:
                if cancel.is_set():
                    raise McpCancelled()
                self.emit("generating")
                pngs, figures = self.svc.images.run(job, cancel)
            figures["gpu_policy"] = policy
            created = int(time.time())
            recipe = {"schema": "strata.image.v1", "prompt": job["prompt"], "seed": job["seed"],
                      "size": f"{job['width']}x{job['height']}", "model": self.svc.images.model,
                      "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created)),
                      "settings": {k: figures[k] for k in ("steps", "backend", "quant")}}
            self.emit("completed", recipe=recipe, b64_json=base64.b64encode(pngs[0]).decode("ascii"))
            self.completed_job = self.active
            text = json.dumps({"status": "completed", "job_id": self.active["job_id"], "seed": job["seed"],
                               "size": recipe["size"], "model": recipe["model"],
                               "message": "The generated image is displayed inline. Do not regenerate or invent an image URL."})
            result = self.result(True, text, start)
        except McpCancelled:
            self.emit("cancelled", error="Image generation cancelled.")
            raise
        except (images.ImageRequestError, images.ImageJobFailed, OSError, RuntimeError) as exc:
            state = "cancelled" if cancel.is_set() else "failed"
            text = "Image generation cancelled." if state == "cancelled" else f"Image generation failed: {exc}"
            self.emit(state, error=text)
            result = self.result(False, text, start)
        self.results[call_id] = signature, result
        return result

    def recovery_error(self, error):
        self.active = self.completed_job
        self.emit("recovery_failed", error=f"Image created, but chat could not resume: {error}. The image is still available; the next chat request can retry loading.")

    def guard_run(self, iterator, cancel):
        try:
            yield from iterator
        except Exception as error:
            if self.completed_job is None:
                raise
            if not cancel.is_set():
                self.recovery_error(error)
                for event in self.drain():
                    yield "image", event
            yield "done", {"finish": "cancel" if cancel.is_set() else "stop", "completion_tokens": 0,
                           "reused": 0, "timings": None}
        finally:
            iterator.close()

    @staticmethod
    def result(ok, text, start):
        return {"ok": ok, "text": text, "chars": len(text), "truncated": False,
                "ms": int((time.monotonic() - start) * 1000) if start else 0}
