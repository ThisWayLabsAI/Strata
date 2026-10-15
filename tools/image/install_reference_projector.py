"""Install the official Qwen3-VL projector for reference editing; never modify configs.

python tools/image/install_reference_projector.py --destination <new vision folder>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

REPO = "Qwen/Qwen3-VL-8B-Instruct-GGUF"
REVISION = "f982a07559d4a2f6c8744d840bf6fccab30eea96"
NAME = "mmproj-Qwen3VL-8B-Instruct-F16.gguf"
SIZE = 1_159_029_824
SHA256 = "ca524100ebf825c9a870db1c580d03879e0da0ab2541697e2458e64891cf9d38"
URL = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{NAME}"


def install(destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / NAME

    def valid(path: Path) -> bool:
        with path.open("rb") as stream:
            return path.stat().st_size == SIZE and hashlib.file_digest(stream, "sha256").hexdigest() == SHA256

    if target.exists():
        if not valid(target):
            raise RuntimeError(f"Existing file failed verification; left untouched: {target}")
        print("Existing projector verified.", flush=True)
        return target
    partial = target.with_suffix(target.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > SIZE:
        raise RuntimeError("Partial download is larger than expected; left untouched.")
    if offset < SIZE:
        request = urllib.request.Request(URL, headers={"Range": f"bytes={offset}-"} if offset else {})
        with urllib.request.urlopen(request, timeout=120) as response:
            append = offset > 0 and response.status == 206
            if append and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                raise RuntimeError("Unexpected range response")
            with partial.open("ab" if append else "wb") as stream:
                total = offset if append else 0
                reported = total // (128 << 20)
                while block := response.read(4 << 20):
                    total += len(block)
                    if total > SIZE:
                        raise RuntimeError("Download exceeds expected size")
                    stream.write(block)
                    if total // (128 << 20) > reported:
                        reported = total // (128 << 20)
                        print(f"Projector: {total:,} / {SIZE:,} bytes", flush=True)
    if not valid(partial):
        raise RuntimeError("Projector size/hash verification failed; partial file retained.")
    partial.rename(target)
    (destination / "projector-manifest.json").write_text(json.dumps({"repo": REPO, "revision": REVISION,
        "file": NAME, "bytes": SIZE, "sha256": SHA256}, indent=2) + "\n", encoding="utf-8")
    print(f"Projector verified: {target}", flush=True)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    install(parser.parse_args().destination)
