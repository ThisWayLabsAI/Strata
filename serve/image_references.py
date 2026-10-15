"""Bounded, local-only reference inputs shared by generation and editing endpoints."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import warnings
from pathlib import Path

MAX_REFERENCES = 3
MAX_BYTES = 8_000_000
MAX_TOTAL = 20_000_000
MAX_PIXELS = 16_000_000
ROLES = ("source", "identity", "style", "composition")


def capabilities(cfg: dict) -> dict:
    ready = isinstance(cfg.get("llm_vision"), str) and bool(cfg["llm_vision"]) and Path(cfg["llm_vision"]).is_file()
    try:
        from PIL import Image
    except ImportError:
        ready = False
    return {"reference_images": ready, "editing": ready, "max_references": MAX_REFERENCES,
            "max_reference_bytes": MAX_BYTES, "max_total_bytes": MAX_TOTAL,
            "formats": ["image/png", "image/jpeg", "image/webp"]}


def parse(req: dict, cfg: dict, *, edit: bool = False) -> list[dict]:
    """Never accept filesystem paths or fetch URLs on the server. Strip embedded metadata."""
    from serve.images import ImageRequestError
    values = req.get("references", [])
    if not isinstance(values, list) or len(values) > MAX_REFERENCES:
        raise ImageRequestError(f"references: an array of at most {MAX_REFERENCES} images")
    if edit and not values:
        raise ImageRequestError("editing requires a source reference image")
    if not values:
        return []
    if not capabilities(cfg)["reference_images"]:
        raise ImageRequestError("reference images need images.llm_vision and Pillow configured on this server")
    from PIL import Image, ImageOps
    result, total, normalized_total = [], 0, 0
    for index, value in enumerate(values):
        if not isinstance(value, dict) or set(value) - {"data", "name", "role"}:
            raise ImageRequestError("reference: only data, name and role are accepted; upload image bytes, not paths or URLs")
        data, role, name = value.get("data"), value.get("role", "source" if index == 0 else "identity"), value.get("name", f"reference-{index + 1}")
        if role not in ROLES or not isinstance(name, str) or len(name) > 160 or any(ord(c) < 32 for c in name):
            raise ImageRequestError("reference: invalid role or name (maximum 160 characters)")
        if not isinstance(data, str) or len(data) > 4 * ((MAX_BYTES + 2) // 3) + 64:
            raise ImageRequestError("reference: at most 8 MB per image")
        if data.startswith("data:"):
            prefix, separator, data = data.partition(",")
            if not separator or prefix not in ("data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"):
                raise ImageRequestError("reference: expected a PNG, JPEG or WebP base64 data URL")
        try:
            raw = base64.b64decode(data, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ImageRequestError("reference: invalid base64 image") from exc
        total += len(raw)
        if not raw or len(raw) > MAX_BYTES or total > MAX_TOTAL:
            raise ImageRequestError("references: 8 MB each and 20 MB total maximum")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw), formats=("PNG", "JPEG", "WEBP")) as image:
                    if image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                        raise ValueError("use a still image of at most 16 megapixels")
                    image.load()
                    normalized = ImageOps.exif_transpose(image).convert("RGB")
                    # A fresh image avoids carrying EXIF, prompts, or other uploaded metadata into the runner.
                    clean = Image.new("RGB", normalized.size)
                    clean.paste(normalized)
                    output = io.BytesIO()
                    clean.save(output, format="PNG")
        except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ImageRequestError(f"reference {index + 1}: invalid or oversized PNG/JPEG/WebP image") from exc
        png = output.getvalue()
        normalized_total += len(png)
        if normalized_total > MAX_TOTAL:
            raise ImageRequestError("references: normalized images exceed 20 MB; resize them before uploading")
        result.append({"png": png, "name": name, "role": role, "sha256": hashlib.sha256(png).hexdigest()})
    if edit and (result[0]["role"] != "source" or any(r["role"] == "source" for r in result[1:])):
        raise ImageRequestError("editing: the first image must be the only source; other images provide identity, style or composition")
    return result


def provenance(references: list[dict]) -> list[dict]:
    return [{key: ref[key] for key in ("name", "role", "sha256")} for ref in references]
