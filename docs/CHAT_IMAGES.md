# Image generation in chat

Thiswaylabs fork, 2026-10-15. This document describes the original text-to-image increment and shared orchestration/storage contract. The locally deployed [reference editing extension](CHAT_IMAGE_EDITING.md) adds explicit reference Generate/Edit. Ordinary attachments remain vision input unless explicitly selected as references.

Current release: reference implementation `fcb7c79c`, based on `919e9866`, passed coordinated Original/SC117 validation and was deployed with release `a5d0c6ae`. Text-only requests without the new extension retain this document's API semantics. See the handoff for deployment evidence and limitations.

Deployment: application commit `996c3cbf503817d9943614555cff61e1def7fb79` is live locally. The user confirmed generation with the checkbox enabled and accepted moving on while continuing testing. See [implementation decisions and follow-ups](THISWAYLABS_DECISIONS.md).

## Use it

When the configured image runner and its model files exist, the composer offers **Create images in chat**. It is off by default and remembered in this browser. Enable it and explicitly ask for an image, for example: “Create a 512x512 studio photograph of a small red toy robot. No lettering.” Ordinary questions still produce text; the model decides whether the explicit image tool is appropriate. Requests to write a prompt or analyze an image should not invoke it.

The assistant shows queued, GPU preparation, generation, restoration and completion states. Sampling counts are shown only when the runner reports the configured sampling-step total; tensor-loading bars are excluded. No estimated percentage is invented. Stop cancels queue waits or the owned image subprocess. There is one attempt per chat request, including failures; a new request is an explicit new attempt. Generation is not retried when a preview fails, the stream disconnects or the page reloads.

Completed cards show the image, actual prompt/seed/settings in a recipe, PNG download and Use as template. The PNG copy includes the existing Strata recipe without re-encoding pixels. If annotation fails, the original bytes remain downloadable with a warning. Use as template preserves the current Images operation and references.

## Browser storage and deletion

Before relying on server output retention, the browser stores the PNG Blob and recipe in IndexedDB (`strata.chatImages`, `images` store). The ordinary localStorage transcript retains message/call/job IDs and recipe metadata, not base64 pixels or temporary object URLs. Refresh reads blobs from IndexedDB and creates new object URLs. This does not depend on the server's last 64 files and does not trigger another generation. It is local to this browser/origin, not cross-device sync or server chat history. Changing localhost/port/Tailscale origin uses separate storage.

Storage denial/quota/blocked writes show a warning. The current result remains downloadable in memory; download before leaving. Missing stored images show an unavailable state and are not regenerated. Failed previews keep download available. A refresh during an unfinished job marks it interrupted and does not reconnect or retry automatically.

New chat removes the old transcript immediately and deletes its image blobs/object URLs after the existing Undo window (6.5 seconds). Undo preserves them. Browser deletion errors are reported. Chat export includes recipes and relative image filenames; download the matching PNGs separately using each card. Export does not embed browser-only object URLs.

## API opt-in

Only `POST /v1/chat/completions` supports this extension in this increment. Authentication, JSON/origin checks and existing host restrictions apply. Requests without the boolean `strata_images: true` keep ordinary tool behavior; no built-in is offered or executed. The health response advertises `chat_image_generation` only when configured runner/model files exist. Missing image configuration is a clear error for an opted-in request.

```json
{
  "model": "your-listed-chat-model",
  "messages": [{"role": "user", "content": "Create a 512x512 image of a red robot."}],
  "stream": true,
  "strata_images": true
}
```

The built-in tool is `generate_image`, with `prompt` (1–16000 characters), optional supported `size` and optional safe nonnegative integer `seed` (0–9007199254740991). It always generates one PNG, uses the configured image steps/model, and accepts no model-supplied executables, filesystem paths, URLs or references. Sizes are 512x512, 768x768, 1024x1024, 1536x1024 or 1024x1536, subject to the configured backend's maximum. `tool_choice: "auto"` or omission allows selection; `"none"` disables server tools for this opt-in request. Forcing the server-managed tool/required choice is not supported, consistent with the existing MCP loop.

Streaming chunks retain normal OpenAI deltas and optionally carry `strata_image`:

```json
{
  "id": "the-tool-call-id",
  "job_id": "32-lowercase-hex-digits",
  "name": "generate_image",
  "sequence": 5,
  "state": "completed",
  "recipe": {"schema": "strata.image.v1", "prompt": "...", "seed": 606, "size": "512x512", "model": "...", "settings": {"steps": 8}},
  "b64_json": "PNG-bytes-as-base64"
}
```

Queued/preparing/generating/restoring events share the call/job IDs and increasing sequence. Generating can include `step` and `steps`. Failed/cancelled events include `error`; a successful image followed by chat reload failure emits `recovery_failed`, keeping the completed result intact. Non-stream responses include the same event list under `choices[0].message.strata_images`. Image payloads are delivered through the authenticated chat response, not newly published server-file URLs. The model receives a short textual result with job ID, seed, size and model, never the base64 image.

Built-in calls and existing MCP calls run through one bounded tool loop. Client-provided tools win a name collision; a client-owned `generate_image` is not intercepted. A round containing client-managed calls does not execute server-managed calls. Repeated delivery of an event is ignored by job/call ID and sequence, and a repeated call ID inside a request reuses its result. There is no HTTP reconnect/resume/idempotency store: API clients must not automatically replay opted-in HTTP requests after a disconnect. A fresh HTTP request is a new attempt.

## GPU ownership and recovery

`Service.run` is fully exhausted, including its FIFO release, before the image tool worker starts. The worker calls the shared `ImageGen.run` inside `images.gpu_turn`; it never recursively invokes the HTTP image route. The configured keep/shrink/unload policy and batch-engine coordination remain shared with Images and API jobs. The ordinary model turn is reacquired for the tool-result continuation. Session snapshots are a cache optimization; the full message history remains the source of truth. Successful image delivery is retained even if preparation or generation of the textual continuation fails.

The optional `gpu_turn` phase callback is used only by the new chat path. Existing image request parsing, runner arguments and raw image API output bytes remain unchanged. No engine, weight, package or machine-config update is required.

## Verification

The 82 Python image/chat/reference/monitor/MCP tests and 16 Node recipe/template tests passed. Python checks cover default/opt-in behavior, malformed input, client tool ownership, mixed calls, job budgets, duplicate call IDs, valid sampling progress, phase ordering, auth, failures, cancellation, subprocess cleanup, FIFO release, unload/save/reload/restore and recovery failures. Browser fixture checks cover inline cards, metadata, pixel-free model context, duplicate/late events, previews, quota failure, missing storage, refresh, export, deletion/Undo and mobile layout: 19 image checks, 6 reload/deletion checks and 33 mobile regressions per viewport. See the handoff for final viewports and deployment state.

Run the backend suite with `python -m unittest serve.test_chat_images serve.test_images serve.test_image_references serve.test_mcp serve.test_monitor`. Use `tools/mobile_chat_fixture.py` on isolated port 8091 for browser checks; run `tools/chat_image_ui_checks.js`, reload, then `tools/chat_image_reload_checks.js`. These replace fixture history and must not run against live. A native SC117 browser run at 390x844 generated seed 609 and restored its 454205-byte PNG from IndexedDB after refresh. Browser automation checked PNG contents; actual device download dialogs remain manual verification.

On the local RTX 3090 (24 GiB), CUDA image runner, Qwen-Image-2.1-Turbo Q8_0, 8 steps, both Original IQ2_XS and SC117 IQ2_XS called the image tool for a 512x512 robot with seed 606. Both used unload policy, saved their own conversation, generated the PNG, restored the session and continued with a confirmation. End-to-end chat/image/chat took 32.25 s for Original and 31.75 s for SC117 in these short runs. Both subsequently answered 17×23 = 391 and recovered to READY after cancellation of a separate image request. These are smoke tests, not throughput, reasoning or broad image-quality benchmarks. Other GPUs/backends and actual iOS/Android remain untested.

After restart, live Original Qwen passed capability/asset/auth checks, ordinary chat without opt-in, and a 512x512 chat image with seed 610. It continued with a completion message and answered 17×23 = 391 on the next request. The image used the configured unload policy and 8 CUDA steps; no job remained in flight. The web MCP server still reported three tools. The user subsequently confirmed the enabled chat flow worked; further exploratory testing continues.
