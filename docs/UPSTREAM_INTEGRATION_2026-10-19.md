# Upstream 0.2.0-beta integration, 2026-10-19

Candidate branch: `update/upstream-0.2.0-beta-20261019`, from stable `4d460156` and pinned upstream
`e88ee39d1d6be6e3364183af3b39b62a7ed6f211`. This update is being validated separately. It is not deployed.

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

The actual integration worktree is checked separately after the final changes. CUDA 13.3 portable sm_86 engine/DLL and standalone CPU
state/cache builds are separate from the installed engine. Native test and paired-comparison results will be recorded after they run.

Integration CPU run: 794 tests, 783 passed and 11 documented platform/optional-dependency skips; no failures.
All 15 standalone CPU state/cache tests passed. The CUDA 13.3/MSVC portable sm_86 engine and `strata_kq.dll` built successfully,
and the executable reports `strata 0.1.45.3`. Native GPU behavior is not established by these results.

Before any native run, check idle live and all four config hashes; stop through the existing controls and independently verify zero
live/dev listeners and native workers. Restore the unchanged live source/engine/task after testing. Do not deploy from a successful build alone.
Keys, models, packs, runtime config values, packages, controls and task settings remain preserved. Camera changes remain experimental.

Local evidence begins in the Codex task workspace: `integration-cuda-build.log`, `integration-cpu-build-tests.log`,
`upstream-assessment-2026-10-19/integration-mocks.log`, and the dated assessment report. Native reports and outputs belong under
`C:\AI\Strata-data\logs`; temporary credential-bearing configs must be deleted after their owned servers stop.
