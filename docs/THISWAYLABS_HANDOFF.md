# Thiswaylabs Strata handoff

Updated 2026-10-15. Continue in `C:\AI\Strata-dev`; do not infer runtime state from these notes without checking Git and `/health`.

## User intent and implementation order

Mobile support is first. Automatically choose the layout using viewport size and primary touch capability, with Automatic / Mobile / Desktop under About > Settings. Save the preference per browser. The user explicitly requested this automatic default, overriding the general opt-in rule for this layout feature.

Next: chat image generation with persistent inline results and safe GPU handoff. Reference-photo editing follows separately. Then implement validated per-conversation model switching. Detailed acceptance criteria remain in [THISWAYLABS_FEATURE_PLANS.md](THISWAYLABS_FEATURE_PLANS.md).

## Checkouts and branches

- `main` mirrors upstream and must remain clean of customizations.
- `thiswaylabs` is the stable customized branch. Live code is `C:\AI\Strata`; development is `C:\AI\Strata-dev`.
- Mobile work is on `fix/mobile-chat`, based on `8e798771` (the API Monitor link and original plans).
- Existing later-feature branches: `feature/chat-images` and `feature/model-switcher`. Update them from stable before implementation; do not discard existing work.
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

## Local rollout and rollback

The user authorized deployment in this chat; the mobile frontend is deployed locally for phone verification after automated checks. Check the actual live commit with `git -C C:\AI\Strata rev-parse HEAD` rather than assuming a remote branch is up to date.

The pre-mobile source is `8e79877102340a8859190351d186c99fd9110273`. The deployment creates `rollback/pre-mobile-chat-20261015` in the live checkout. That commit includes the API Monitor link. The earlier `rollback/pre-api-monitor-link-20261015` points to `296b59d2`.

Only source files, fixture/check tools, and docs are part of the mobile commit. The running server reads the HTML/JS/CSS from disk, so this source-only update needs a browser refresh and no engine restart. For rollback, verify tracked edits first, then switch the live source to the named rollback branch; refresh browser assets. Switching frontend source does not delete localStorage. Do not use reset --hard or clean -fdx. Later backend/dependency changes require their own stop/restart/build procedure.

Preserve the existing untracked `build-image-cuda.bat`, `enable_strata_tailscale.py`, and `third_party/stable-diffusion.cpp/` in the live checkout. Runtime configs, API keys, model weights, packs, launchers and scheduled tasks stay local and untouched. Do not print config contents or API keys. See `C:\AI\Strata-controls\README.md` and `Strata Fork Workflow.md` for the installation and general workflow.
