# Thiswaylabs Strata handoff

Updated 2026-10-15. Continue in `C:\AI\Strata-dev`; do not infer runtime state from these notes without checking Git and `/health`.

## Current increment: images directly from chat

Status: deployed and accepted for continued user testing on 2026-10-15. Application commit is `996c3cbf503817d9943614555cff61e1def7fb79`. The user enabled the checkbox, confirmed generation worked, and agreed to move on while continuing testing. See [the decision record](THISWAYLABS_DECISIONS.md). The following earlier-release sections are historical; this section and the next-increment plan take precedence.

`feature/chat-images`, based on `6d904c34323552f5dfb1ec1caf6e210fd6950bdd`, adds the opt-in **Create images in chat** checkbox and `strata_images: true` OpenAI extension. One text-to-image attempt per request, inline typed states/results, real sampling steps, PNG recipes, IndexedDB persistence, download/template actions and cancellation use the existing image runner. Inference releases its GPU turn before the image worker acquires it; both models resumed text successfully. Reference photos attached to chat remain vision input. Use Images for reference generation/editing. See [CHAT_IMAGES.md](CHAT_IMAGES.md) for the API/storage contract and limitations.

Verification: 82 Python image/chat/reference/MCP/monitor tests and 16 Node recipe/template tests passed. Chromium fixture checks cover 19 image interactions, 6 real reload/deletion checks, and 33 mobile regressions at each of 390x844, 320x256, 844x390 and 1280x800 (232 checks), with no browser errors. A real SC117 mobile browser run generated seed 609, displayed its image, and restored its 454205-byte PNG from IndexedDB after refresh. Original and SC117 hardware API runs generated seed 606, used unload/save/reload/restore, answered 17×23 = 391 afterward, and recovered after cancellation. End-to-end image turns measured 32.25 s and 31.75 s respectively on the RTX 3090, not a benchmark. Actual phone keyboards/downloads and other GPU backends remain untested.

Deployed by local Git-bundle fast-forward because GitHub CLI authentication is unavailable. Publication/PR remains pending; do not mark remote branches synchronized. Preserve `rollback/pre-chat-images-20261015` at `6d904c34323552f5dfb1ec1caf6e210fd6950bdd`. The user stopped and restarted live using the existing controls. Live verification completed at 2:41 p.m. Pacific on 2026-10-15: health advertised the new capability, five served HTML/JS assets matched source, unauthenticated chat returned 401, and web MCP reported three tools. Ordinary chat returned READY without image events; opted-in chat generated seed 610 at 512x512, resumed text, and a subsequent request answered 391 for 17×23. No requests remained in flight. The measured 33.97 s includes the image turn and subsequent arithmetic check, not generation alone. Dev port 8081 and fixture port 8091 were stopped; Original Qwen remained live on 8080. Recheck health before future GPU work. No configs, keys, models, installed packages, controls or scheduled-task settings changed in this increment.

Next: add explicit reference-aware chat editing on the shared backend, then validated model switching. Portable reference bundles and actual phone verification remain useful follow-ups. Completed image storage is local to each browser/origin; HTTP reconnect/resume/idempotency is not implemented and requests must not be automatically replayed.

Continue from stable on a new `feature/chat-image-editing` branch. First define request-owned reference IDs, explicit Generate/Edit selection and reference roles; reuse validation and inline persistence instead of creating a second image service. Start with mocks/fixtures while the user tests live. Do not stop live or load a second GPU server for documentation or fixture work. [Next-increment acceptance criteria](THISWAYLABS_FEATURE_PLANS.md#next-increment-reference-aware-generation-and-editing-in-chat) distinguish proposed behavior from the deployed text-only tool.

Latest template increment: `feature/context-aware-image-templates`, based on `4963f2e9`, preserves the selected operation and all references when applying built-in, saved or result templates. It adds visible mode/reference guidance, requested Edit changes, identity preservation and numbered roles. Mode/reference changes show a Reapply notice without overwriting the draft. Save excludes unchanged generated context while retaining requested changes; PNG recipes optionally retain `templatePrompt` for reuse. Explicit PNG recipe import still restores its recorded operation and clears references. See the recipe document for manual-prompt limitations. Sixteen Node tests and 23 context, 21 reference and 25 recipe browser checks passed across five viewport sizes. No backend/config/model changes or GPU rerun; refresh assets without restarting live. Rollback base: `rollback/pre-context-aware-templates-20261015` -> `4963f2e9eeb1b1b7b78d2b61325474eea68585cd`.

Latest UI polish: `fix/reference-upload-area`, based on `7b7add03`, replaces the native Choose Files control with a styled button/drop zone. Desktop shows drag/drop and click-to-browse instructions; coarse-pointer or narrow screens show a compact photo/file picker without drag instructions. The same validated upload pipeline handles both entry points, with disabled/busy protection and drag highlighting. Twelve focused browser checks passed at 320x568, 390x844 and 1280x800, plus all 20 reference regressions at phone/desktop sizes; screenshots were inspected. This is frontend-only: refresh browser assets, no service restart. Rollback base: `rollback/pre-reference-upload-area-20261015` -> `7b7add0367f719bf39fa0d8bf329feee5fb23d02`.

## User intent and implementation order

Latest increment: `feature/reference-image-editing`, based on `374920cb`, adds reference generation/editing in Images using the existing runner and shared GPU queue. It follows the PNG recipes, Discuss in chat, 24 starter templates and saved-library release. See [IMAGE_RECIPES_AND_REFERENCES.md](IMAGE_RECIPES_AND_REFERENCES.md) for the input/API contract, pinned projector, verification, limitations and next steps.

Reference editing in Images is implemented and hardware-tested. There are up to three ordered uploads, source/identity/style/composition labels, previews, reorder/remove, browser URL import, result-to-source reuse and cancellation. The pinned official projector is an additional file under the image model's new vision directory. Local config backups are under `C:\AI\Strata-data\backups\reference-editing-20261015`; the intended config change is only `images.llm_vision`. No existing weight, API key, engine build or Python package is replaced. Machine configs remain ignored by Git.

Mobile support is first. Automatically choose the layout using viewport size and primary touch capability, with Automatic / Mobile / Desktop under About > Settings. Save the preference per browser. The user explicitly requested this automatic default, overriding the general opt-in rule for this layout feature.

The current text-to-image chat increment is described above. Next: explicit reference editing in chat, then validated per-conversation model switching. Portable reference bundles and actual phone keyboard/download checks remain follow-ups. Detailed acceptance criteria remain in [THISWAYLABS_FEATURE_PLANS.md](THISWAYLABS_FEATURE_PLANS.md).

## Checkouts and branches

- `main` mirrors upstream and must remain clean of customizations.
- `thiswaylabs` is the stable customized branch. Live code is `C:\AI\Strata`; development is `C:\AI\Strata-dev`.
- Mobile work is on `fix/mobile-chat`, based on `8e798771` (the API Monitor link and original plans).
- The next frontend fix is on `fix/images-mobile-seeds`, based on mobile commit `1c77ddf9`. It fixes Images keyboard access and adds Random/Fixed seeds and recent-seed reuse.
- `feature/chat-images` contains the accepted text-to-image implementation. `feature/model-switcher` remains planned; update it from stable before implementation without discarding existing work.
- The API Monitor link is deployed in the Monitor tab, opens `/api-monitor` in another tab, and needs no config change.
- GitHub CLI queries failed with HTTP 401. No PR or GitHub merge was performed. Local development/stable deployment uses committed fast-forward history transferred with a Git bundle. Both local stable checkouts are ahead of `origin/thiswaylabs`; publication remains pending authentication. Never force-push to resolve this.

## Mobile implementation

Files: `serve/web/index.html`, `serve/web/app.css`, `serve/web/app.js`.

- Automatic mobile layout applies at up to 900 CSS pixels or when the primary pointer is coarse. It adapts on resize and orientation changes, without depending on user-agent detection.
- The `strata.chatLayout` localStorage preference is `auto`, `mobile`, or `desktop`. Unknown values fall back to Automatic. No server config or API changes are required.
- Desktop override requests an 1100-pixel layout viewport on mobile, like a desktop-site view. Returning to Automatic/Mobile restores the device-width viewport. Pinch zoom stays enabled. This changes layout only, not the user-agent or backend behavior.
- Mobile uses the visual viewport's height and offset for the keyboard, with innerHeight/dynamic viewport fallbacks. It ignores pinch-zoom resize events, handles safe areas, keeps controls at least 44 pixels, uses 16-pixel input text, and allows the composer bar to wrap on very small screens.
- Streaming follows the latest message until the reader scrolls away. Jump to latest resumes it. Explicit message anchoring preserves position when older images load even without browser-native anchoring. New sends resume following. The compact header keeps the status live region available to assistive technology.
- Long code and tables scroll within the transcript. Tool results wrap. Touch Enter adds a newline; use Send to submit. Desktop Enter and Shift+Enter behavior and IME composition are preserved.

## Verification and remaining acceptance

The user confirmed the mobile layout works, then reported that the Images keyboard covered Generate and part of Seed. The Images fix gives the form/results a scrolling viewport and Generate a separate footer. Visual-viewport resize also scrolls the focused image input into view. Size and Fixed seed sit beside each other with identical label styling and 44-pixel fields. Seed mode and New seed sit in a separate row above them. Random disables the fixed field without changing the layout and omits the API seed field. Seed zero is valid. The frontend accepts whole-number fixed seeds up to 9007199254740991 (the largest exactly representable JavaScript integer).

The alignment/New seed adjustment is on `fix/seed-control-alignment`, based on `0fdf1c80`. New seed uses browser crypto to pick a seed from 0 through 2147483647, matching the backend random range, ensures it differs from the current value, switches to Fixed and saves the preference. It neither sends a generation request nor records an unused seed in history. The expanded image UI suite has 23 checks; all passed at 320x568, 390x844, 844x390, 1280x800 and 390x300, including identical field/label alignment, button behavior and keyboard/footer regression. The 390-pixel fixed-mode layout was also visually reviewed.

`strata.imageSeed` stores the chosen mode and fixed input; `strata.imageSeeds` stores the newest 10 successful returned seeds with size and timestamp. Repeated seeds count as separate uses. Failed requests do not enter the log. Selecting a recent seed switches to Fixed and fills its value without generating or changing size/prompt. Storage is local to the browser; existing image result persistence is unchanged.

Image UI verification: `tools/image_ui_checks.js` runs against the same fixture, which now returns tiny fake images without GPU work. Its 19 checks passed at 320x568, 390x844, 844x390, 1280x800, 390x300 and 390x330. They cover the visible/clickable Generate footer, automatic focused-field scrolling, seed alignment, Random/Fixed request bodies, zero, seed reuse, bounded history, failure handling and duplicate-submit prevention. Random/Fixed settings and all ten recent seeds passed refresh persistence checks. All 19 existing `serve.test_images` tests and the 33 mobile-chat regression checks passed. Actual phone keyboard verification of this Images fix remains pending.

Use the isolated fixture, never a live chat, for the destructive browser checks (they replace fixture history):

```powershell
python tools/mobile_chat_fixture.py
agent-browser --session strata-mobile-check open http://127.0.0.1:8091
agent-browser --session strata-mobile-check set viewport 390 844
Get-Content -Raw tools/mobile_chat_checks.js | agent-browser --session strata-mobile-check eval --stdin
```

The fixture binds only 127.0.0.1:8091 and uses canned SSE replies, no API keys or GPU. Send `error` for an HTTP error response. Stop it after testing. If agent-browser needs a different executable in this sandbox, the installed headless shell is under `C:\Users\steven\AppData\Local\ms-playwright`; use an isolated session and writable temporary directory. Do not alter the production Python environment to run UI checks.

Automated Chromium checks cover default detection, overrides, layout containment, 44-pixel primary controls, streaming growth, reading position, image-load anchoring with native anchoring disabled, tool panels, long drafts, mocked visual viewport resize/offset and pinch zoom, touch Enter policy, IME, cancellation, errors, normal completion, and the Monitor/Images tabs. Additional checks cover preference persistence across reload and resizing between desktop and mobile. Emulated mobile viewport checks verify that Desktop switches the layout width to about 1100 pixels.

Results: 33 browser checks passed at each of 320x568, 390x844, 768x1024, 844x390, 1280x800, 390x330, and 320x256 (231 checks, Chromium 151). Saved desktop/mobile preferences also passed reload checks in an emulated phone viewport. No browser JavaScript errors were reported in the final fixture runs. The existing 10 `serve.test_monitor` tests passed; JavaScript syntax and Git whitespace checks passed. Error notifications were visually checked and moved below the header so they do not cover Send.

This is Chromium coverage, not actual Safari/Android keyboard validation. Real iOS Safari and Android Chrome checks remain open: keyboard open/close, portrait/landscape rotation, browser address bar movement, safe areas, 200% pinch zoom, attachments, tool panels, reading older streaming messages, and both overrides. Record device/browser versions and results. Backend chat/vision/image model smoke tests were deliberately not rerun for a frontend-only change.

## Reference-editing rollout and rollback

Deploy the tested feature by local fast-forward, preserving `374920cb08d1d120f12074346552d342cd6ababc` as `rollback/pre-reference-editing-20261015` in live. This release changes the Python backend: stop live first and restart after source/config deployment. The existing scheduled logon task runs elevated. The ordinary stop launcher can report no server because it cannot read elevated process command lines; run Stop Strata.cmd as administrator, then verify port 8080 health no longer responds. The Codex sandbox cannot access Windows CIM/process ownership, so user assistance may be required for stop/restart. Do not start dev while live remains available.

The additional projector is `C:\AI\Strata-data\models\qwen-image-2.1-turbo\vision\mmproj-Qwen3VL-8B-Instruct-F16.gguf`. Add only `images.llm_vision` to backed-up Original/SC117 live configs and matching ignored dev configs. Preserve all other semantic values and verify this without printing keys. The Original GPU smoke test and cancellation completed; the development server was stopped afterward. SC117 inherits the same image settings but was not hardware-tested for this increment. Development MCP startup hit a sandbox uv-cache access restriction; verify live tools after restart.

Rollback source on the named branch after stopping live, then restart and refresh assets together. Old source ignores the extra projector config key; remove only that key if desired, using local backups as reference. Avoid restoring whole old configs over newer local settings without reviewing differences. Keep the downloaded projector; rollback does not require deleting models. Verify health, chat and existing generation. Check actual live Git/health before assuming rollout has completed; the user-facing handoff snapshot records the final deployment state.

## Earlier frontend rollout and rollback

The user authorized deployment in this chat; the mobile frontend is deployed locally for phone verification after automated checks. Check the actual live commit with `git -C C:\AI\Strata rev-parse HEAD` rather than assuming a remote branch is up to date.

The pre-mobile source is `8e79877102340a8859190351d186c99fd9110273`. The deployment creates `rollback/pre-mobile-chat-20261015` in the live checkout. That commit includes the API Monitor link. The earlier `rollback/pre-api-monitor-link-20261015` points to `296b59d2`.

The pre-Images-controls source is `1c77ddf9aed5740fd2849e68514124253be9667f`, preserved as `rollback/pre-image-controls-20261015` for the Images fix rollout. This keeps the previous mobile implementation and API Monitor link. No engine restart, model/config migration or new dependency is needed.

The alignment/New seed rollout preserves `0fdf1c80808a5d6e188dcab32499dce7a81afde6` as `rollback/pre-seed-alignment-20261015`. This rollback retains the earlier keyboard fix, seed modes and history.

The recipe/template rollout preserves `9172b71ff07084dfcbdc1d87f3c882cda1cddab6` as `rollback/pre-image-recipes-20261015`. It is a frontend-only rollout, including the new `web/image-tools.js` asset; refresh browser assets together after deployment or rollback. PNG recipes are embedded in UI download/preview copies, while raw API/server-file behavior stays unchanged. Saved-template data uses `strata.imageTemplates`; rolling source back does not delete that browser data.

Only source files, fixture/check tools, and docs were part of the mobile commit. Those earlier frontend-only changes needed a browser refresh and no engine restart. The current reference backend needs the stop/restart procedure above. Switching frontend source does not delete localStorage. Do not use reset --hard or clean -fdx.

Preserve the existing untracked `build-image-cuda.bat`, `enable_strata_tailscale.py`, and `third_party/stable-diffusion.cpp/` in live. Runtime configs stay local; only the backed-up projector property changes for reference editing. API keys, existing weights, packs, launchers and scheduled tasks are preserved. Do not print config contents or API keys. See `C:\AI\Strata-controls\README.md` and `Strata Fork Workflow.md` for the installation and general workflow.
