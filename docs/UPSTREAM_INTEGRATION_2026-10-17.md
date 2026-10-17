# Upstream 0.1.45 integration, 2026-10-17

Current state: [PR #2](https://github.com/ThisWayLabsAI/Strata/pull/2) has passed CPU, browser, native build and Original/SC117 GPU validation and is ready for stable merge/deployment. Live was stopped through the existing control after user-approved UAC. Source and engine deployment require a final zero-listener/native-worker check, then the existing scheduled startup task.

The integration branch merges upstream `477ac13cbe8e582c20484871ce459d20d82df09d` into stable base `c3af2e08`, preserving the fork's published history. The earlier [assessment](UPSTREAM_REVIEW_2026-10-17.md) records the 264 upstream commits and user-relevant enhancements. This record tracks integration checks and deployment separately.

## Compatibility fixes

- Registry transitions now transfer upstream's tokenizer-bound `prompts` encoder and `model_arch`, including rollback. A regression switches between distinct token-ID mappings and verifies the correct encoder and family; failed replacement restores the old cache/family.
- CPU-created installed-model services initialize their model family, keeping model-card sampling consistent with startup services.
- Saved sampling values remain explicit, including a legacy saved 0.6. New/Reset sampling uses upstream model-card defaults. Editing temperature/top-p/top-k records custom mode, so deliberate values equal to defaults are still sent. Apply/reload and request-body browser checks cover this migration.
- The native registry gate accepts `--engine` to test a separately built candidate in a temporary private config without changing the four real configs. Reports include the candidate binary hash.

## CPU and browser evidence

Upstream server/reasoning/frontend/prompt-tokenizer tests passed: 444 tests, with six asset-dependent skips in the broad run. The real installed tokenizer vocabulary then passed all 18 tokenizer tests without skips. Focused registry/sampling checks passed all 38 tests. The initial combined fork run had five sampling-test-harness failures because its JavaScript extraction boundary moved; the corrected sampling extraction and six sampling tests pass. The other fork MCP/image/edit/reference tests passed. JavaScript syntax and diff checks passed.

Mobile composer, image toggle and Options suites passed at 320x568, 390x844, 844x390, 1280x844, 390x300 and 320x256 (410 assertions). Saved threads (26), chat reference editing (23), private mode (21), model selection (26) and sampling Apply/Reset (4) passed, plus real reload preserving explicit 0.6. Browser errors were empty. Initial thread tests rejected the wrong fixture port before mutation and were rerun on their required CPU fixture 8092.

Native build: separate portable CUDA engine version 0.1.45, sm_86, CUDA 13.3, MSVC 14.44, Ninja, Q6_K experts/MMQ enabled, no optional performance flags requested. Build output: `Strata-data\build\upstream-0.1.45-sm86`. All 15 standalone CPU state/cache tests passed in a separate non-CUDA build after building every registered target. Existing vision source is unchanged by the upstream merge; keep the installed GPU vision encoder and validate it in the native gate. HIP/SYCL/Metal toolchains/hardware are not installed here and were not locally built; the fork changes on top of upstream are Python/browser/test code.

Evidence: `Strata-data\logs\upstream-integration-20261017`. Backups of all four configs and the live engine/metadata are in `Strata-data\backups\upstream-sync-20261017-1`. Keys, models, configs, controls and scheduled-task settings remain outside Git. Native GPU validation and deployment results must be recorded before describing this candidate as deployed.

## Native validation passed

`tools/model_switch_smoke.py --engine C:/AI/Strata-data/build/upstream-0.1.45-sm86/strata.exe` passed on the installed RTX 3090 using the existing 131072-context Original and SC117 profiles. Each model passed arithmetic, conversation history after a model round trip, client tools, vision, a real web MCP result, streaming cancellation/recovery, Generate and Edit with chat restoration, busy-switch rejection during text/image work, and image cancellation/recovery. The final Original arithmetic check passed. All four output PNGs were inspected: generated robots were red, and edits changed the selected fixture to green while preserving its yellow star and blue legs. This is a functional gate, not a speed comparison or broad edit-fidelity assessment.

Evidence: `Strata-data\logs\model-switch-native-20261017-115326\report.json`, `server.log` and PNGs. The report records `passed`, stopped development server, removed temporary credential-bearing config and unchanged hashes of all four real configs. No development engine remains before live deployment. Clean `main` was fast-forwarded and pushed to the pinned upstream revision `477ac13c`; no force push or live checkout switch was used.
