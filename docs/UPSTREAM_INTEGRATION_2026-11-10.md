# Upstream integration candidate, 2026-11-10

## Source and publication

The upstream revision is pinned to `dbb2d168cffa8cf793d9325358809d5263c7c6b0`.
It follows tag `v0.2.13.1` and includes the November 10 picture-reader fixes.
The product is 0.2.13, Terminal 0.2.13.1, Control 0.1.59.1 and engine 0.1.59.
Compared with stable `c4152d27`, upstream contributes 3,020 commits; stable retains 74 fork-only commits.

The fork's remote `main`, development `main` and live checkout's inactive `main` mirror were fast-forwarded
to this revision. No published history was rebased or force-pushed. The integration branch is
`update/upstream-0.2.13.1-20261110`, published as [draft PR #11](https://github.com/ThisWayLabsAI/Strata/pull/11)
against `thiswaylabs`. Merge commit `4e290f1a` preserves both parents. Follow-up `399748eb` fixes image response
metadata and reconciles the web UI and its tests.

Stable `thiswaylabs` in GitHub, development and live remains `c4152d27`. This is a candidate, not a stable deployment.
Follow [the fork workflow](FORK_WORKFLOW.md) before merging or deploying.

## Merge decisions

Eleven files had textual conflicts. The resolution retains installed-model selection, reference images and chat image
tools, private browser storage, private Monitor exclusion, uploaded-images-only vision, and the mobile composer.
Upstream's declared-tool parsing, final tool-free answer, logprobs, image backgrounds, translation support, previews,
and linked-question safety are included.

- A linked `?q=` question becomes a draft. It never starts inference or tools by itself.
- Model changes replace the template parser as well as the tokenizer and engine. A failed load restores the previous parser.
- Existing registry profiles keep their explicit vision and reserve settings. Applying the new vision defaults only to the
  startup copy would make it differ from the installed profile and from later model switches.
- Reference paths stay inside a temporary image job. The actual alpha-channel result is copied back for response metadata,
  including when a malformed PNG prevents flattening. The existing upstream regression exposed this merge interaction.
- Upstream's scroll-follow rule respects a reader who scrolls up. The fork's mobile viewport and reading anchor remain.
- The fork's IndexedDB thread library and memory-only private mode remain the canonical chat store. Upstream's separate
  sidebar, rewind, answer editing and queued/interrupted-message controls are not enabled. Their standalone modules remain
  available, but the page does not load their competing controller. The interruption-specific source test is explicitly skipped;
  the existing fork browser tests cover thread changes, concurrent saves, private storage and model identity.
- Translation catalogs match the retained marked UI. Custom controls that were English remain English.

## Validation

Evidence is local under `C:\AI\Strata-data\backups\upstream-20261110`. Private configs and raw logs stay there and
are excluded from Git publication. Initial failures and interrupted runs are retained alongside the corrected runs.

Passed checks:

- CPU CMake configure/build/CTest: 69 passed, three stated skips, using the upstream CPU preset and MSVC.
- CUDA 13.3 configure/build/link for the RTX 3090 (`sm_86`): `strata` and `strata_kq`, separate build directory,
  vendored ggml, portable CPU kernels, native experts and K-quant MMQ enabled. Compilation is separate from execution below.
- Desktop host typecheck and production build. Config snapshots: 38 tests and 199 subtests passed.
- Image metadata, protected-region compositing and edit controls: 31 Node tests. Monitor credential/storage handling: 12 checks.
- Browser fixtures: private storage/reload; saved-chat revisions and model/draft restoration; private model selection;
  image generation/editing and recipe upload; mobile composer, Options, keyboard, image toggle and scroll behavior at
  360x640, 390x844, 768x1024 and 1440x900. Test browsers use synthetic data and no GPU.
- Final focused image/registry suite under pinned dependencies, including Pillow 13: 88 tests and 47 subtests passed.
- Focused web compatibility suite: 38 passed, three stated skips, 24 subtests passed.
- The broad server run completed with 1,628 passes, 33 skips and 14,416 passing subtests. Its only four failing subcases
  were in the portable identity test harness: the extracted helper lacked `os`, and its ps test needed to isolate the new
  procfs fast path from the host. After that test-only correction, the entire lifecycle file passed: six tests, eight
  subtests and three stated skips. No runtime change followed the broad run. Its three thread/generator warnings remain
  in the log and are not described as clean results. The separately run replica stress case accounts for its one deselection.
- The replica stress case passed alone on unchanged upstream in 116.21 seconds and on the candidate in 117.02 seconds.
  The earlier broad run stalled there and was interrupted; its traceback is retained.
- Documentation links, release manifest, capability table, benchmark index, settings register and vendored-file checks passed.

The Terminal/control run is being finalized; its results must be recorded before this candidate is described as ready.
The exhaustive Terminal every-key/every-screen walk was interrupted and remains incomplete. A second full server run
after the test-only lifecycle correction was not performed; the complete affected file was rerun instead.

### Native execution and live restoration

The native gate ran merge revision `4e290f1a`, using the newly compiled engine and the retained installed vision helper
and `sd-cli`. It did not install a different helper, image engine, drafter or model. The later follow-up changes image
response metadata and browser/test/catalog code; its metadata path is covered by the 88-test focused rerun.

The normal Stop control succeeded after two idle checks. Independent listener and native-worker checks preceded
candidate startup. The candidate used loopback port 8081, copied configs and a separate image output directory.

All three installed profiles passed private arithmetic and uploaded-image vision:

| Profile | Arithmetic including load | Uploaded synthetic picture |
| --- | ---: | --- |
| Original IQ2_XS | 28.14 s | identified the red robot |
| SC117 IQ2_XS | 29.20 s | identified the red robot |
| IQ3_XXS | 53.16 s | identified the red robot |

These are single validation calls, not comparative performance measurements. Tool-call parsing and restricted file/HTTP(S)
vision rejection passed. Image Generate produced a red cube; reference Edit changed it to blue while retaining the scene.
Chat resumed after both GPU handoffs. Private requests remained absent from the candidate Monitor.

After stopping the candidate and independently checking cleanup, the unchanged Limited scheduled task restored the live
release. The prior active IQ3_XXS selection and unloaded state were restored through its API. Live reports engine 0.1.45.3.
All backed-up live/development config hashes matched. Live source, engine files, launchers, keys, model assets and task
settings were not replaced. Native cancellation and separate new vision-helper validation were not run.

## Remaining gates and observed limits

- GitHub rejects backend, Checks and Docs workflow dispatches with HTTP 422: `Actions has been disabled for this repository`.
  The permissions endpoint reports enabled and the workflows report active; setting enabled and retrying did not remove
  the refusal. No CI run started. CUDA/HIP/SYCL/Metal CI remains unverified. Keep the PR in draft until this is resolved.
- The desktop host suite initially reported 1,566 passes, 112 skips and three failures. Both symlink-permission failures
  reproduced on unchanged upstream on this Windows account. The timing case passed on an isolated candidate rerun
  (seven tests), and also passed on unchanged upstream. No application change was made for these environment/timing results.
- The setup/tool suite reported 1,672 passes, 81 skips and three failures. The template fingerprint failure came from a
  pre-merge CRLF worktree file retained when the new LF attribute arrived; normalizing that local file to the committed LF
  bytes made the check pass without a source change. The two SYCL guard tests also failed on unchanged upstream because
  this machine's WSL bash cannot start. A rerun with the already-installed Git Bash first on that command's PATH passed
  all 24 shell/Docker/SYCL-guard tests. This resolves the three observed tool-test failures; it does not establish a SYCL
  engine compile result.
- Camera-direction fidelity remains experimental. No comparative speedup or compatibility on untested hardware is claimed.

Do not advance stable or replace live engine/runtime artifacts on the strength of the clean textual merge or local CUDA
build alone. Record the outstanding test and backend results, review the PR, then use the existing deployment and rollback gates.
