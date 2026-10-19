# Upstream 0.2.0-beta integration, 2026-10-19

Candidate branch: `update/upstream-0.2.0-beta-20261019`, from stable `4d460156` and pinned upstream
`e88ee39d1d6be6e3364183af3b39b62a7ed6f211`. Native validation passed in isolation. Stable/live remain
`4d460156`; this update is not merged into stable or deployed. [PR #6](https://github.com/ThisWayLabsAI/Strata/pull/6)
tracks review and CI separately from deployment.

## Compatibility changes

- Combine the installed-model factory/registry with upstream's component-engine startup and preflight authentication.
- Close the currently selected model during shutdown while retaining upstream drain, lifecycle events, and owned ready-file cleanup.
- Keep strict context validation for existing registry startup configs unless `fit_max_tokens: true` or `--fit-max-tokens` opts in.
  Single-model configurations follow upstream's fitting default. Regression tests cover overrides and unchanged transcript content.
- The native switch gate accepts two existing configs with `--configs`, so an isolated worktree does not need private config copies.
- Add an opt-in paired engine comparison using explicit sampling, a warm-up outside the timed request, interleaved fresh server starts,
  and one GPU owner. It reports both text differences and engine timings. Three short prompt pairs are not a general quality benchmark.

No fork changes are made to native engine code or CUDA kernels. The upstream sm_86 performance defaults remain available for the RTX 3090.
The 3060/A4000 upstream gains are not local 3090 measurements. HIP/SYCL/Metal are not locally built.

## Validation and deployment boundary

The isolated assessment passed 146 fork Python tests, 634 of 645 broader Python tests (11 skips), two targeted probes,
seven of nine Windows process tests (two POSIX skips), 32 Node tests, and 348 browser assertions across six viewports.
Both installed Original/SC117 profiles passed CPU preparation at 131072 context with vision, without starting native processes.

Integration CPU run: 794 tests, 783 passed and 11 documented platform/optional-dependency skips; no failures.
All 15 standalone CPU state/cache tests passed. The CUDA 13.3/MSVC portable sm_86 engine and `strata_kq.dll` built successfully,
and the executable reports `strata 0.1.45.3`.

The tested merge is `420f242a`; native runtime source was `2aa53241` (documentation follow-up only).
Subsequent `7e7d78b3` changes one test, not runtime code: Linux full-suite CI exposed a global sampler-thread count race.
The cleanup regression now identifies and joins its own server's sampler instead of comparing counts affected by earlier tests.
Its focused local run passed. Full runtime-only CI is tracked on PR #6; the initial failure must not be represented as a passing run.

One full Linux rerun then passed 972 tests (14 skips), while its parallel run exposed an additional portable-watcher bug.
The parent and watcher included `ps` process state in their start token; an ordinary R-to-S transition could make the same child
look like a different process and refuse cleanup. Both token readers now use the stable start time and recognize zombie state
prefixes. Two deterministic regressions failed before and pass after the fix, including mutable state and `Z+` cases.
The final local process suite ran 11 tests, nine passed and two POSIX-only tests skipped on Windows. The Windows job-object path,
native engine and tested GPU runtime behavior are unchanged. Linux CI runs the real process-lifeline suite explicitly before the
broader suite so a process-cleanup regression fails earlier. Current-head CI remains the release gate.

## Native gate passed

On the RTX 3090 24576 MiB, driver 616.92, the existing elevated Stop control succeeded after Windows UAC approval.
Independent checks confirmed zero 8080/8081 listeners and native workers before the candidate started. The existing 131072-context
Original and SC117 profiles, vision assets, MTP head and CUDA Qwen-Image-2.1-Turbo Q8_0 settings were retained.

Both models passed arithmetic, actual serving IDs, history after model round trips, client tool calls, vision, a real web MCP result,
streaming cancellation/recovery, Generate/Edit with chat restoration, busy-switch rejection during streaming and image sampling,
and image cancellation/recovery. Seven selections took 23.89–27.73 seconds. The final Original arithmetic response was `391`.
All four PNGs were inspected: generated robots were red, and reference edits turned the source green while retaining the yellow star
and blue legs. These are functional smoke tests, not long-context, general identity, or camera-fidelity measurements.

End-to-end chat-image-chat times, including restoration: Original Generate/Edit 39.95/42.41 s; SC117 39.06/42.33 s.
The existing `auto` policy performed unload/save/reload/restore. These are not image-generation-only benchmarks or paired image-speed comparisons.

Evidence: `C:\AI\Strata-data\logs\model-switch-native-20261019-154855\report.json`, `server.log`, and four output PNGs.
The report records `passed`, `server_stopped`, `private_config_removed`, and `original_configs_unchanged` as true.

## Local text comparison

The same candidate Python server tested installed engine 0.1.45 against candidate 0.1.45.3 with Original IQ2_XS at 131072 context.
Each condition used a fresh server/engine, one warm-up outside the measured request, temperature 0, seed 4242,
reasoning disabled and 192 generated tokens. Order was baseline/candidate, candidate/baseline, baseline/candidate.
No named sm_86 performance override was present in the dev config or inherited environment.

| Short prompt | Installed decode tok/s | Candidate decode tok/s | Change | Installed / candidate request wall time |
| --- | ---: | ---: | ---: | --- |
| LRU cache | 99.1 | 107.3 | +8.27% | 2.297 / 2.078 s |
| Merge sorted lists | 90.7 | 98.7 | +8.82% | 2.422 / 2.218 s |
| HTTP retry/idempotency | 94.3 | 111.3 | +18.03% | 2.391 / 2.031 s |

Median decode rates were 94.3 and 107.3 tok/s; the median of the three paired percentage gains was 8.82%.
Prompt lengths were only 31–36 tokens. Responses differed in two pairs; the second pair matched exactly. These are preliminary
local throughput samples, not a fixed-token identity gate, broad quality evaluation, or isolated attribution to the sm_86 table.
Different output sequences can affect throughput. No cold-load, SC117 speed, long-prompt, or paired image-performance claim is made.

Evidence: `C:\AI\Strata-data\logs\upstream-engine-compare-20261019-155628\report.json` and six sample logs.
The comparison passed and removed its temporary private config. Candidate engine SHA-256:
`965a42ad63a8c730b31a28c4a8e568d66234a3d577439f3ade831773220d171b`.

## Live restored unchanged

After independent worker/listener cleanup, the unchanged `Strata - Qwen` scheduled task restarted live.
Health, Original selection with no load error, API 401 rejection without a key, three web MCP tools, closed dev/fixture ports,
unchanged source `4d460156`, unchanged installed engine hash and all four config hashes passed verification.
Temporary credential-bearing configs were removed. The wrapper report is `integration-native-evidence/report.json` in the Codex task workspace.
Live remains the prior tested release, available with lazy loading. The candidate engine is still only in its separate build directory.

Before any native run, check idle live and all four config hashes; stop through the existing controls and independently verify zero
live/dev listeners and native workers. Restore the unchanged live source/engine/task after testing. Do not deploy from a successful build alone.
Keys, models, packs, runtime config values, packages, controls and task settings remain preserved. Camera changes remain experimental.

Local evidence begins in the Codex task workspace: `integration-cuda-build.log`, `integration-cpu-build-tests.log`,
`upstream-assessment-2026-10-19/integration-mocks.log`, and the dated assessment report. Native reports and outputs belong under
`C:\AI\Strata-data\logs`; temporary credential-bearing configs must be deleted after their owned servers stop.
