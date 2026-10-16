# Reference images and editing in chat

Thiswaylabs fork, 2026-10-15. Implemented on `feature/chat-image-editing`, based on live/stable `919e9866`. This increment is **development only** until coordinated GPU smoke tests and rollout. Live Images editing stays available on the stable version. GitHub publication is pending authentication.

## Use it

Enable **Create images in chat**, then open **Generate · 0 refs** to choose Generate or Edit. Attaching a photo alone remains analysis input. Click an attachment's **Use as reference** to select its bytes explicitly. Up to three ordered references have source, identity, style or composition roles. Move earlier changes order without changing roles. Edit requires image 1 as the only source. A missing source reports an error without sending or clearing the written draft.

Completed chat cards offer **Edit this image**. With no other references selected, this reads the saved output from IndexedDB, selects it as the source and changes the mode to Edit. Write the changes and Send. Selection alone never generates. The original output remains available beside the new result. Remove existing selections before choosing a different generated source.

Image settings open in a bounded panel above the composer, with Escape to close. The Send/Stop row remains reachable at keyboard heights. Settings close on Send; operation and references stay selected for deliberate follow-ups. During the request their controls are disabled. Turning image tools off returns attachments to ordinary vision behavior. New chat clears selected inputs, with the existing Undo restoring them.

Inputs are temporary and not persisted in localStorage or IndexedDB. After refresh the panel shows zero references and explains reattachment; selected output PNGs can be selected again from saved cards. Completed outputs retain the existing IndexedDB storage, PNG recipes, downloads, cancellation and visible storage/recovery failures. Recipes retain ordered normalized hashes and roles, not input pixels. A recipe cannot reconstruct source images. This is browser/origin-local storage.

**Chat edits are whole-image model edits.** They do not include the Images brush, selection masks, focused crop or local pixel compositing. Use Images for those controls. No exact identity, unchanged-background or camera-compliance guarantee follows from transport tests; camera changes remain experimental. Applying a card's template still opens Images and preserves that workspace's current operation/references; it also leaves chat selection untouched.

## API

`POST /v1/chat/completions` retains `strata_images: true`. Add the client-owned extension below for reference generation or editing:

```json
{
  "messages": [{"role": "user", "content": "Edit the source: make the toy robot blue."}],
  "stream": true,
  "strata_images": true,
  "strata_image_request": {
    "operation": "edit",
    "references": [{"id": "source-1", "role": "source", "data": "data:image/png;base64,<uploaded bytes>"}]
  }
}
```

Use `operation: "generate"` for a new referenced scene. Omitting the extension preserves the existing text-to-image contract. IDs are unique request-local identifiers matching `[A-Za-z0-9_-]{1,64}`. Each input accepts only `id`, `role`, `data`. No input names, filesystem paths, lookup IDs from another request or remote URLs are accepted. IDs do not authorize access to older assets: the client must supply the bytes on every request. The shared reference parser normalizes PNG/JPEG/WebP and applies the existing three-image, 8 MB per input, 20 MB aggregate and 16-megapixel limits, capability checks and edit-source ordering. Invalid inputs fail before chat model loading. HTTP body limits still apply.

The request exposes one server image tool matching its selected operation: `edit_image` for Edit, `generate_image` for Generate. Referenced tools require `prompt`, `reference_ids` and optionally existing `size`/`seed`. The model must provide exactly all selected IDs in their supplied order. Missing, reordered or foreign IDs fail before image GPU work and consume the shared one-attempt budget. No edit-to-generation fallback occurs. A client-owned tool of the same name retains ownership; mixed client/server calls preserve the existing routing rules. `tool_choice: "none"` continues disabling server tools.

The server supplies numbered role instructions to the image runner ahead of the model's requested prompt; the final effective prompt is in the recipe. Tool descriptions receive only bounded IDs and roles. Input bytes are not injected into chat messages by this extension. The UI also omits explicitly selected attachments from its vision history; unselected analysis attachments remain vision inputs. The existing API Monitor, when enabled, retains bounded request bodies in RAM as it does for vision requests, including uploaded bytes; do not treat monitoring as a pixel-free text summary.

Typed `strata_image` events retain the previous shapes, with `name` identifying the selected tool. Completed recipes add `operation` and ordered `references` (`name`, `role`, `sha256`); names are generic `reference-1` etc., never client paths. Events and output pixels continue through the authenticated response. Existing one-attempt, deduplication, Stop/disconnect and recovery guarantees remain. There is no HTTP reconnect/replay/resume implementation.

## Ownership and release

Verification on Windows with Chromium 154: 101 Python mock tests (including inherited chat-image lifecycle coverage), 28 Node recipe/control tests and 547 browser fixture assertions passed. Browser counts comprise 96 checks at each of 320x568, 390x844, 844x390, 1280x844 and 390x300, 56 mobile/edit checks at 320x256, and 11 real-refresh/storage/Undo/deletion checks. No browser errors were reported in the final runs. The mobile reference panel was visually inspected. Actual phone keyboards, other browsers/backends and native chat-edit output quality are still unverified.

This extends `serve/chat_images.py` and the existing shared `ImageGen` runner; no second service or dependency is introduced. Chat inference still finishes and releases its FIFO turn before the image worker calls `images.gpu_turn`. The configured policy and safe model restoration remain shared with Images. Engine source, machine configs, installed assets, keys, packages, controls and scheduled tasks are unchanged.

Run mock checks with:

```powershell
python -m unittest serve.test_chat_image_editing serve.test_chat_images serve.test_images serve.test_image_references serve.test_mcp serve.test_monitor
node tools/test_image_metadata.js
node tools/test_image_edit_controls.js
```

Browser fixtures: `tools/mobile_chat_fixture.py` on isolated port 8091, with `tools/chat_image_editing_ui_checks.js` for selection/edit/reuse/roles/Stop, and `tools/chat_image_editing_reload_checks.js` after a real refresh. Existing chat-image, Images-reference and mobile suites also apply. Never run destructive fixture checks against live.

Hardware release gate: finish active user jobs, stop live through the existing controls, verify 8080 is stopped, and run one development server at a time on 8081. Test Original and SC117 chat → referenced Generate/Edit → chat, distinguishable input images, actual output inspection, seed/policy, cancellation and restoration. Stop development and restore live through existing controls. Do not change configs or load a second GPU server to avoid coordinating this gate. Only then use the documented local bundle/fast-forward rollout with rollback at `919e9866`; publication remains pending authentication.
