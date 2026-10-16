# Per-conversation model switching

Implemented on `feature/model-switcher`, based on stable/live `0b7f7517`. This is an opt-in development feature. Native switching has not been tested or deployed. Live remains on the stable single-model configuration.

## Registry and installation

The run config may contain `model_registry`, an object mapping stable public chat IDs to administrator-owned installed-model profiles. The startup model must be present and match the startup engine configuration. No registry preserves the existing single-model API behavior, including legacy unknown-name handling. No weights are downloaded or discovered and no startup config is rewritten.

Profiles contain `exe`, `args`, `cwd`, `tokenizer`, `tokenizer_sha256`, and optional `vision`, `sampling`, `log`, `env`, `gpu`, `backend`, `engine_silence_s`, `effort_position`, `vram_elastic` and `vram_segment_mib`. Other options are rejected. They cannot set API keys, image output locations, MCP servers or startup controls. Service-wide settings stay with the startup service. Only single-engine, single-slot native packs are supported in this increment; batch/replica configurations are rejected when enabling the registry.

Validation requires existing executable/pack/shard/vision assets, pack `conversions.json` shard names and sizes, matching native expert-index provenance, the pack's own tokenizer directory, and a SHA-256 over concatenated `vocab.json`, `merges.txt`, `token_type.json`, and `chat_template.jinja` bytes, in that order. The vision model must be the selected native shard; a PLE shard must belong to the same recorded model. Draft/profile paths must exist. These checks catch accidental asset mismatches, not malicious or semantically incorrect weights. Native engine validation and load-failure rollback remain necessary. Paths and fingerprints are private configuration, absent from the model listing, selection status and registry errors. Registry-enabled `/props` omits the native model path.

For this installation, validate the two existing development configs without changing files or starting a process:

```powershell
python tools/model_registry_config.py strata-dev-original.json strata-dev-sc117.json
```

Using the installed Strata Python, add `--prepare` to construct each real tokenizer, template and lazy engine/vision object on CPU and assert that no child process started. This also leaves the source configs untouched.

After arranging a separate GPU session, the same helper can create a **new** ignored private config with `--output strata-dev-switching.json`. It refuses overwrite. This new file retains the startup config's API key and must never be published. The source configs, keys, installed assets, images policy, controls and scheduled task are unchanged. Start it with the installed Strata Python, development source and port 8081 only after stopping and verifying live through existing controls. The helper itself never starts/stops a server.

## Conversation and API behavior

The browser shows Conversation model only when the authenticated registry endpoint is available. Selection changes the current conversation's requested model and applies on Send. The requested ID is saved alongside the existing browser-local conversation, including the first request using the default. New chat resets to the startup default; Undo restores both the transcript and its selection. A removed ID remains visibly unavailable and fails explicitly, without substitution. Each assistant response saves its actual serving ID for display/export. This uses the existing one-current-conversation storage; it does not add an archive or cross-device synchronization.

The selector is disabled during a request. Requested and observed active configuration/loading state are separate; the UI refreshes status every three seconds while the Chat tab is visible. The active ID identifies the selected engine configuration; `loaded: false` means it has no resident chat engine. The default always identifies the startup model, even after switching.

- `GET /v1/models`: registered IDs, context limits, text/vision modalities, `switchable: true` and active identity. The separately configured image model remains listed for image requests.
- `GET /v1/model-selection`: `default_model`, `requested_model`, `active_model`, `loaded`, and `load_error`.
- `POST /v1/model-selection` with JSON `{"model":"registered-id"}`: select and load at a safe boundary, returning selection status. Authentication and the existing same-origin/trusted-origin policy apply. No transcript or config is modified.
- `/v1/chat/completions`, `/v1/messages`, `/v1/responses` and Anthropic token counting resolve `model` through the same registry before preparation. Omitted IDs resolve to the startup default. Response model fields identify the actual serving model. Unknown IDs return 404 `model_not_found`.
- Startup aliases always resolve to the startup model, including after selecting an alternative; they never follow whichever engine happens to be loaded. Alias/registry collisions are rejected. Alternative profiles cannot redefine aliases.
- `/v1/load` can select a registry ID or startup alias. `/v1/unload` acts on the active configuration and rejects a named different model. Legacy `/load` and `/unload` act on the current engine. All share the admission guard. Explicit `/slots/...` save/restore is refused in registry mode so manually named caches cannot cross model identities; resend full conversation history.

With a registry, all POST operations use nonblocking service admission. A concurrent request, including one for the same model, receives 409 with `error.code: "model_busy"`. Retry manually after the active work finishes; there is no automatic replay, queue, or HTTP resume. This conservative admission policy covers request-body reading, preparation/tokenization, vision, streaming, client/MCP tools, images, restoration, and controls. Internal GPU work still uses the existing FIFO. It prevents another request from replacing identity between preparation and inference, or during a chat-image-chat gap in FIFO ownership. Idle unload can still reclaim the current model through its existing FIFO checks.

The replacement is validated on CPU before a working engine unloads. The transition holds the FIFO, stops chat and vision, replaces tokenizer/template/stop IDs/sampling/draft-pack associations, clears pending image-session restoration and model-dependent status, then loads the replacement. It preserves transcript content and rebuilds from full history. Existing context validation rejects overflow without truncating history; an overflow may be reported after loading the selected smaller model. Adjust the completion limit, shorten history explicitly, or choose a larger model.

On load failure, the candidate must stop before restoration of the previous engine. Error 503 reports `load_failed_previous_restored` or `load_failed_rollback_failed`. A failed rollback leaves the previous configuration unloaded with HTTP health available; explicitly load it or send a fresh request to retry. An unconfirmed process stop refuses replacement. Shutdown stops admission and waits for an admitted transition before closing the current engine. No two chat engines are intentionally resident.

## Verification and release gate

CPU-only lifecycle/API tests cover both switch directions, canonical response IDs, startup aliases, unknown IDs, incompatible/missing assets, tokenizer/template and vision mismatches, context overflow, preparation races, FIFO/queue refusal, disconnect cancellation, image handoff/restoration, load failure, failed rollback, authentication, foreign-origin selection, manual snapshot refusal, restart/default binding and disabled-registry compatibility. The UI fixture uses the real HTTP routing with reloadable mock engines on 8092. Browser tests cover selection, streaming disablement, New/Undo, actual IDs, stale selection, persistence and bounded phone/keyboard layouts. Exact final counts are in the handoff.

Original and SC117 installed profiles passed CPU asset validation at 131072 context with vision enabled. This did not start native chat or vision processes and establishes no model quality or native switching reliability.

Before deployment, coordinate a GPU session: finish active work, stop live with its existing controls, verify port 8080 has no server, then run one development server on 8081 with the separate registry config. Test Original → SC117 → Original, history rebuild, vision, structured/client and MCP tools, chat-image-chat under the existing image policy for each model, cancellation and busy refusals during streaming/image restoration. Inspect outputs and record actual models, policy, timings and GPU ownership. Stop development, remove the temporary credential-bearing registry config if it is no longer needed, and restore live through existing controls. Native checks and deployment remain pending; no release approval is inferred from mock success.

Release requires the documented local bundle/fast-forward workflow, a rollback branch at the actual prior live commit, a backend restart and opt-in registry configuration review. GitHub publication remains pending authentication. Camera controls remain experimental.
