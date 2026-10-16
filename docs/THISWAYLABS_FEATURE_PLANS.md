# Thiswaylabs feature plans

## Requested follow-up: saved chat library

Implemented in development on `feature/chat-threads`; live remains `7a2137ab`. Acceptance: New preserves old chats; searchable library opens, renames and confirms deletion; messages, generated outputs, requested models and drafts survive reopening/refresh; existing single chat migrates once; opening never runs inference; storage failure and competing tabs cannot silently discard history; uploads/references remain explicitly temporary; controls fit mobile keyboard layouts. CPU/browser checks passed as recorded in [CHAT_THREADS.md](CHAT_THREADS.md). Local deployment is pending; server archives, synchronization and import are outside this increment.

Status: implementation plans and acceptance criteria, 2026-10-15. Mobile chat, PNG recipes/templates, reference editing in Images, opt-in chat image generation/editing and [model switching](MODEL_SWITCHING.md) are deployed locally; see [the current handoff](THISWAYLABS_HANDOFF.md). Model-switching application `54caf337`, based on prior live `0b7f7517`, passed mock/fixture, coordinated Original/SC117 native API/browser checks and live selector verification. The user authorized local deployment and Original's live config now opts into the registry, preserving its startup default and all previous values. Original remains the normal startup model. GitHub publication remains pending authentication.

The user confirmed that enabled chat generation worked and accepted moving on while continuing testing. The text-to-image increment is accepted within its documented limits. [Implementation decisions](THISWAYLABS_DECISIONS.md) record the boundaries and release evidence. Existing acceptance lists below retain the original goals; actual coverage and outstanding device/backend checks are recorded in the handoff, not implied by acceptance of the increment.

Intervening user-requested increment: optional region marking, camera/framing presets and lighting presets in Images. The first version and its verification are documented in [IMAGE_EDIT_CONTROLS.md](IMAGE_EDIT_CONTROLS.md). It reuses the existing reference API and does not imply that chat reference editing is already implemented.

## Scope and order

1. `fix/mobile-chat`: keep the composer usable with a phone keyboard and make streaming and image scrolling predictable. Moved first at the user's request.
2. `feature/chat-images`: implemented text-to-image generation directly from chat, persistent inline results, and GPU handoff. Reference editing in chat follows separately.
3. `feature/model-switcher`: choose an installed chat model per conversation, with matching API behavior and serialized GPU transitions.

At the user's later request, reference editing first moved ahead of chat-tool integration in Images. Ordinary attachments remain vision input; explicitly selecting an attachment or saved result now also supports reference generation/editing in chat. Both use the shared backend. See [Images implementation](IMAGE_RECIPES_AND_REFERENCES.md) and [chat implementation](CHAT_IMAGE_EDITING.md).

The small API Monitor navigation change accompanies these plans on `chore/feature-plans-api-monitor`. It adds a link in the Monitor tab to `/api-monitor`, opening a new tab. The relative origin preserves the development, localhost, and private proxy addresses. The existing Monitor dashboard remains available. The link explains that API monitoring must already be enabled; it does not enable request recording or change configuration.

## Development and release boundaries

Work in `C:\AI\Strata-dev`. Keep `main` as the upstream mirror and target feature PRs at `thiswaylabs`. Keep each feature independently reviewable. This planning branch starts from `thiswaylabs`; integrate its documentation before updating the existing feature branches.

Do not modify the scheduled task, controls, API keys, machine configs, installed models, packs, or shared Python environment. Live source deployment requires user authorization, which was given for the local frontend rollout in this chat. Never commit runtime data or credentials. New features are opt-in except for mobile layout, which the user explicitly requested should be automatic with a saved desktop/mobile override. Preserve existing request behavior and defaults. The navigation link is an explicitly requested UI addition, not a change to monitoring defaults.

Use mock engines and browser fixtures first. Actual GPU tests are a separate coordinated session: finish active work, stop live Strata with the existing controls, then start development on port 8081. Never run two GPU engines concurrently. Development output stays in the configured development output directories. If dependencies change, use a separate development environment. Restore the live service after testing through its existing controls.

Before release, record the exact commit, checks, device/browser versions, hardware, selected model, GPU policy, and observed results. Do not describe planned checks as passed. Deploy only through the documented fast-forward workflow after acceptance; record the previous deployed commit for rollback. Preserve local configs and data during rollback.

## 1. Images directly from chat

### Existing implementation and constraints

`serve/images.py` implements request validation, image subprocess execution, output retention, and `gpu_turn`. `serve/server.py` exposes `POST /v1/images/generations`; `serve/web/app.js` calls it from the Images tab. Reuse this implementation instead of adding another image backend.

`gpu_turn` acquires the service turn and handles `auto`, `keep`, `shrink`, and `unload`, including batch-engine coordination. Unload can save a temporary session and restore it on reload; failed cache restoration falls back to prompt processing. A cache snapshot is an optimization, not the conversation's source of truth. Current browser `saveChat()` strips attached image URLs, and server output retention is bounded, so neither mechanism alone provides persistent generated images.

### Implementation steps

1. Add an opt-in chat image capability, exposed only when the image backend is configured. Offer a built-in `generate_image` tool with a bounded prompt, size, count, and optional seed. Validate through the existing image request parser. Do not accept model-supplied paths, executables, or arbitrary URLs. Preserve client-owned tool calls and existing MCP behavior; do not register the generator as an external MCP process that recursively calls this server.
2. Introduce explicit orchestration at the chat/tool boundary: complete the text inference turn, release its GPU ownership, execute the image tool through `gpu_turn`, append the tool result, then reacquire a normal chat turn if a textual continuation is needed. Audit the outer HTTP handler and `run_with_mcp` lock lifetime before coding. Calling the HTTP image endpoint while the same request holds the FIFO would risk deadlock. Never unload during token generation.
3. Use a bounded tool loop and one job identity per tool call. Stream job states (`queued`, `preparing`, `generating`, `restoring`, `completed`, `cancelled`, `failed`) with stable message/call/job IDs. Deduplicate repeated events and call IDs within a request. The browser does not reconnect or replay interrupted requests; API clients must also avoid automatic replay. A fresh HTTP request is a new attempt; resumable HTTP idempotency is a follow-up. Do not manufacture percentage progress when the backend has none.
4. Render a result card in the assistant message with prompt, dimensions, seed when available, preview, download, and clear error/cancel state. Treat these as typed results, not arbitrary HTML or model-authored remote image links. Fetch protected images with the existing authorization header and create temporary browser object URLs; never put API keys in URLs. Revoke object URLs when no longer used.
5. Persist generated image metadata and image blobs in browser IndexedDB, keyed to the conversation and result ID, before relying on server files that can be evicted. Keep ordinary text history compatible with existing storage. Reload should reconstruct previews/downloads without triggering generation or depending on the server's last 64 files. Handle storage denial/quota failure visibly with a download action and a statement that the result was not saved. Persistence is browser-local, not cross-device sync; define deletion to remove associated blobs. Export must include image metadata and allow downloading the images separately.
6. Propagate Stop/disconnect cancellation through queue waits and subprocess execution. Terminate and reap only the owned image process, release locks in all outcomes, and restore according to the configured GPU policy. A failed preview must not rerun generation. If chat reload fails after a successful image, retain the image and show the recovery failure separately.
7. Keep the Images tab and image API compatible. Add an explicit request opt-in for API users of the chat tool; document result/event shapes and provide the same orchestration as the UI. Requests without opt-in and client-managed tools retain existing semantics. Keep base64 image payloads out of text model context unless vision is explicitly needed.

### Acceptance criteria

- With the feature enabled, a chat request to create an image invokes the tool and produces an inline downloadable image without visiting Images. Ordinary text requests do not generate images. Disabled/unconfigured capability is not advertised.
- Completed images survive page refresh, server restart, and server output eviction in the same browser. Storage failures are visible; no broken preview is silently represented as a saved result. Export/download and deletion work.
- Chat -> image -> chat preserves conversation content with both Original Qwen and SC117. Snapshot save/restore failure still permits a full-history prompt rebuild; model-specific caches are never reused across different models.
- Concurrent chat, Images-tab, API image, and model-control requests do not overlap incompatible GPU work. Queue order and cancellation are deterministic; no FIFO reentry deadlock. Batch-mode active requests finish before handoff.
- Tests cover queued and running cancellation, disconnect, timeout, subprocess failure, insufficient memory, failed unload/reload, and restoration failure. All finish with released ownership, no orphan subprocess, accurate status, and a usable next request or explicit recoverable error.
- `auto` retains existing policy selection. Mock tests cover all policies; hardware evidence records which policies were actually exercised. Do not enable elastic VRAM or persistent session configuration just to satisfy a test.
- Malformed tool arguments, excessive sizes/counts, unauthorized asset access, path traversal, repeated events, and mixed client-owned/MCP calls have explicit tests. No credentials appear in links, saved result metadata, or exported chats.
- Existing image/API and MCP tests pass with the feature disabled. Run `python -m unittest serve.test_images serve.test_mcp serve.test_monitor`, plus focused new orchestration/storage tests. Hardware smoke tests are required before release, not during documentation work.

### Next increment: reference-aware generation and editing in chat

The installed Images backend supports up to three ordered references and editing with its verified projector. These assets and contracts are reused by the locally deployed chat implementation. The criteria below remain the original release goals; the handoff records actual native/fixture coverage and remaining limitations rather than implying broad identity, camera or device validation. See [the implementation contract](CHAT_IMAGE_EDITING.md).

1. Make Generate/Edit and selected references explicit. An attachment for analysis must not silently become an edit source. Allow a current attachment or a chosen generated result to become a reference, with visible source/identity/style/composition roles and order. Resolve references only from the request's authorized inputs; preserve source provenance without accepting model-supplied paths or fetching arbitrary model-supplied URLs.
2. Add a distinct edit tool beside text generation. Validate a bounded selection of reference IDs using the existing reference normalization, count, size, role and capability checks. A missing/stale reference or unavailable edit capability is an actionable error, never a silent text-to-image fallback. Tool descriptions must distinguish new images, referenced generation, edits and analysis.
3. Reuse the existing GPU turn, one-attempt budget, typed states, cancellation, recovery handling, inline cards and IndexedDB output storage. Keep reference pixels out of textual tool summaries. Retain operation, ordered reference hashes/roles and actual seed/settings in result recipes. A recipe alone cannot reconstruct original reference pixels.
4. Preserve the current mode and references when applying templates. Mode/reference guidance must agree with the actual request. Editing a generated chat image requires explicit source selection; do not guess which older image the user means. Make unavailable inputs after refresh visible and require reattachment unless that input is explicitly persisted by the implementation.

Acceptance criteria:

- With chat image tools disabled, ordinary vision/chat and client-owned tools remain unchanged. An analysis request never edits. Enabled Generate with references and Edit use the selected source bytes and roles, rather than merely describing them in a text prompt.
- Edit requires at least one valid selected source; no missing-reference fallback generates an unrelated image. Malformed, foreign, stale or excessive reference IDs are rejected before GPU work. Credentials, local paths and source URLs do not enter recipes or exports.
- Selecting an inline generated image as a source and revising it produces a new result without mutating or losing the original. Recipes/downloads record operation, seed and ordered reference provenance. Applying a template preserves the user's selected mode/references.
- Completed outputs survive refresh; unavailable input references are clearly identified and are never silently replaced. Duplicate events, Stop/disconnect, storage failure and chat recovery errors retain the guarantees of the accepted text-only path.
- Mock/fixture tests cover routing, reference authorization, missing inputs, mode/template preservation, persistence and cancellation. Existing text-only chat, Images reference/API, MCP and mobile regressions pass.
- After stopping live through existing controls, hardware-test chat → referenced generation/edit → chat with Original and SC117, using deliberately distinguishable references. Record output inspection, seed, policy and recovery results; do not promise perfect identity preservation from a smoke test. Restore live afterward without changing configs, models or packages.

Portable reference bundles, cross-device image history and HTTP resume are separate follow-ups. Model switching follows this chat-edit increment.

## 2. Mobile chat

### Implementation steps

1. Reproduce with static and streaming fixtures before loading a model. Focus changes on `serve/web/index.html`, `app.css`, and `app.js`; inspect shared component CSS before changing it.
2. Use dynamic viewport sizing with a fallback; use `visualViewport` only where needed for keyboard resize/offset behavior. Account for safe-area insets. Maintain one scrollable transcript and a visible composer without disabling pinch zoom.
3. Separate following the newest message from reading older messages. Auto-follow only while the user is near the bottom; show a reachable Jump to latest control otherwise. Preserve the reading position as streamed text, code, and delayed images change height. A new user send may deliberately resume following.
4. Keep Send, Stop, attachments, and multiline input reachable with the keyboard open. Make long code/tables scroll within their content rather than widening the page. Ensure inline image cards fit the viewport. Preserve desktop keyboard behavior and accessibility.

### Acceptance criteria

- At 320, 390, and 768 CSS-pixel widths, portrait and landscape, the composer and Send/Stop remain visible with keyboard open/closed. No page-wide horizontal scrolling or obscured last message.
- Test actual iOS Safari and Android Chrome with the on-screen keyboard; desktop viewport emulation alone is insufficient. Record versions and any device coverage still outstanding.
- While reading older text, streaming tokens and late image loads do not pull the user to the bottom. Jump to latest resumes following, and keyboard transitions retain the reading position.
- Long multiline drafts, attachments, tool activity, errors, cancellation, image completion, orientation change, and 200% zoom remain usable. Primary touch controls are at least 44 by 44 CSS pixels with accessible names and visible focus.
- Desktop chat, tabs, exports, and Images remain functional. Validate using deterministic browser fixtures; no GPU is required for layout tests.

## 3. Model switching

### Implementation steps

1. Add an opt-in administrator-defined registry for already installed chat models. Map stable public IDs to validated engine/tokenizer/template/vision/pack settings on the server. Keep filesystem paths private. Reject incompatible or missing assets before unloading a working model. Do not scan arbitrary browser-supplied paths or overwrite existing configs.
2. Offer a conversation-level selector showing requested and active model separately. Persist selection with the conversation. New chats use the existing default; switching never silently rewrites another conversation's selection. Validate context limits when moving history to a smaller model and report an actionable error rather than silently truncating.
3. Route transitions through the same service ownership mechanism as chat and images. Accept selection changes only at a safe boundary; return a structured busy response during active inference, image generation, or another transition. The UI explains why and lets the user retry. Bind admitted requests to the selected registry entry to prevent a queue race from running against the wrong model.
4. Unload chat and associated vision state before loading the next model. Invalidate model-dependent tokenization, KV/session caches, templates, and draft/pack associations. Preserve transcript content and lazily rebuild it. Keep one chat model loaded. An image handoff and a model switch cannot race over a pending session restore.
5. Expose safe registry metadata via the model listing and use the request's `model` field for registered IDs when switching is enabled. Document alias resolution explicitly: an existing alias continues to mean its configured model and is not an implicit switch command. Define matching behavior across supported chat API adapters and existing load/unload controls.
6. On load failure, report the requested and actual state truthfully. Attempt restoration of the previously working model where safe; if that fails, stay unloaded with the HTTP service available and actionable status. Do not rewrite the default startup config.

### Acceptance criteria

- Original Qwen and SC117 can be selected using a validated local registry without changing API keys, startup defaults, installed assets, or production controls. Missing registry leaves single-model behavior unchanged.
- Each conversation retains its chosen model across reload. Responses and status identify the model that actually served the request. Existing aliases remain compatible and unknown IDs fail explicitly.
- API and UI selection use the same validation and transition behavior. Concurrent requests cannot execute under another request's model; busy responses have a documented code and retry behavior.
- Switching during streaming, image generation/restoration, or another switch is refused safely. No model unload occurs mid-job, no two chat models overlap, and no model-specific snapshot crosses identities.
- Tests cover missing assets, incompatible pack/tokenizer/vision settings, context overflow, cancelled requests, load failure, failed rollback, stale selectors, and restart. Service health remains truthful and recovery is possible without editing configs.
- Mock lifecycle and API tests pass first; coordinated GPU smoke tests exercise both switch directions, vision, tools, and chat-image-chat with both models before deployment.

## API Monitor link acceptance

- From the Monitor tab, the clearly named link opens `/api-monitor` in a separate tab and preserves any ongoing chat in the original tab.
- URL resolution stays on the current origin, including development port 8081 and private HTTPS access. No machine hostname, port, API key, or token is hardcoded into the link.
- The existing API Monitor authentication and enablement behavior remains intact. With monitoring disabled the destination retains its existing 404 behavior; the link explains the prerequisite and does not enable monitoring automatically.
- Verify the HTML change and existing `serve.test_monitor` behavior. This link requires no engine build or GPU test; full browser interaction remains a separate check if unavailable in this session.
