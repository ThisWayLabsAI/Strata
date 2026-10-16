"""Read-only rollout checks plus one ordinary text request; no image generation or config changes."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

from chat_image_editing_smoke import Client, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    cfg = json.loads(Path(r"C:\AI\Strata\strata-iq2_xs.json").read_text(encoding="utf-8"))
    client = Client(cfg, port=8080)
    report = {"health": client.request("/health"), "assets": {}}
    assert report["health"]["chat_image_editing"] and report["health"]["model"] == cfg["model_name"]
    for asset in ("index.html", "app.js", "app.css", "chat-images.js", "image-tools.js", "image-edit-controls.js", "image-references.js"):
        with client.open("/" if asset == "index.html" else "/web/" + asset) as response:
            actual = response.read()
        expected = (ROOT / "serve/web" / asset).read_bytes()
        assert actual == expected, f"Served asset does not match tested source: {asset}"
        report["assets"][asset] = hashlib.sha256(actual).hexdigest()
    request = urllib.request.Request("http://127.0.0.1:8080/v1/chat/completions",
        data=b'{"messages":[{"role":"user","content":"hello"}]}', headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(request, timeout=5).close()
    except urllib.error.HTTPError as error:
        assert error.code == 401
        report["unauthenticated_chat"] = error.code
    else:
        raise AssertionError("Unauthenticated chat was accepted")
    for _ in range(20):
        mcp = client.request("/mcp")
        if mcp.get("tools"):
            break
        time.sleep(.5)
    report["mcp_tools"] = mcp["tools"]
    assert mcp["tools"] == 3
    result = client.request("/v1/chat/completions", client.chat("What is 17 multiplied by 23? Give the number only."))
    message = result["choices"][0]["message"]
    assert "391" in message.get("content", "") and not message.get("strata_images")
    report["ordinary_chat"] = message["content"]
    report["in_flight"] = client.wait_idle()["activity"]["in_flight"]
    report["passed"] = True
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"passed": True, "matching_assets": len(report["assets"]), "unauthenticated_chat": 401,
                      "mcp_tools": mcp["tools"], "ordinary_chat": message["content"], "in_flight": report["in_flight"]}))


if __name__ == "__main__":
    main()
