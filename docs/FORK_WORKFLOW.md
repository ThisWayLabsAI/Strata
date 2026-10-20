# Thiswaylabs fork and upstream updates

This is the repository's authoritative maintenance workflow. The machine guide at `C:\AI\Strata-controls\Strata Fork Workflow.md` contains local launcher details; use this document for branch, publication and upstream-update policy. Current deployed revisions and verification evidence belong in [the handoff](THISWAYLABS_HANDOFF.md).

## Branches and publication

- `upstream` is `https://github.com/Niko1221/Strata.git`.
- `origin` is `https://github.com/ThisWayLabsAI/Strata.git`.
- `main` is a clean upstream mirror; custom changes belong on branches from `thiswaylabs`.
- `thiswaylabs` is tested stable source. Development is `C:\AI\Strata-dev`; live is `C:\AI\Strata`.
- Feature/update branches are reviewed through PRs inside the fork, targeting `thiswaylabs`. Historical local fast-forwards were published after the authentication block was resolved. Preserve that shared history with merges and normal fast-forward pushes.

Before publishing, inspect the commits and file versions being sent. Exclude keys, ignored machine configs, weights, packs, engines, outputs and local logs/backups. Verify authentication and push permission. After pushing, compare `git ls-remote origin refs/heads/thiswaylabs` with the intended stable commit; `git rev-list --left-right --count origin/thiswaylabs...thiswaylabs` should show `0 0`. Old local feature tips need no separate push when their commits are reachable from remote stable. An unmerged feature branch needs its own publication.

GitHub authentication is working as of 2026-10-17. Record actual failures if it changes; old pending-authentication notes are historical. Remote publication and local deployment are separate actions and must each be verified.

## Assess upstream before integrating

1. Verify clean development/stable state and capture live/stable commit IDs. Fetch `origin` and `upstream`; pin the upstream SHA for the review rather than using a moving target.
2. Compare commits, changed paths, release/engine requirements and upstream measurements. Separate benefits relevant to the installed model/GPU from other hardware or opt-in features. Report upstream measurements as such; local gains need local measurements.
3. Use `git merge-tree --write-tree thiswaylabs <upstream-sha>` for an initial conflict check. A clean textual merge does not establish compatibility. Run CPU tests from an isolated snapshot/worktree of the resulting merge, keeping stable/live unchanged.
4. Record the scope, findings and test results in a dated assessment. [The 2026-10-17 assessment](UPSTREAM_REVIEW_2026-10-17.md) covers the 0.1.45 candidate.

## Integrate and validate

1. Create an `update/upstream-<version>-<date>` branch from current `thiswaylabs` and merge the pinned upstream revision. Preserve commits; do not rebase published stable history.
2. Review semantic interactions even when Git reports no conflicts: model registry/identity and load cancellation; image ownership, save/restore and failure recovery; MCP finalization and local round overrides; chat/private storage; sampling and reasoning defaults; mobile controls and viewport handling.
3. Run the relevant Python mock suites and isolated browser fixtures. Include stored-setting migrations and both Original/SC117 choices. Build changed native backends using appropriate build environments/CI; the installed RTX 3090 requires a separate CUDA build and native validation. Upstream source alone is not a deployed engine.
4. For native tests, finish active live work and use the existing Stop control. Verify zero live/dev listeners and native workers before starting a development GPU server. Use one GPU owner at a time. Test chat, vision, tools, cancellation, model switching, image Generate/Edit and GPU handoff; record build options, model/context and measurements.
5. Review the candidate PR and merge into stable only after required checks pass. A clean merge or successful CPU tests alone do not authorize describing the candidate as native-validated/deployed.

## Mirror, deploy and roll back

The clean `main` mirror may be fast-forwarded to a verified upstream revision and pushed with a normal push. This does not merge upstream into `thiswaylabs` or deploy it. If `main` has custom commits or the remote has diverged, investigate rather than rewriting it.

For runtime backend/native/config/dependency changes, check idle live, back up configs, record a rollback branch, stop with the existing control and independently verify shutdown before fast-forwarding live source. Deploy separately tested engine/dependency artifacts where required, then use the unchanged scheduled startup task. Preserve all config values except explicitly intended changes, keys, model/pack paths, GPU policy, model registry, controls and task settings. Verify health, authentication, runtime settings, models, changed flows and served assets.

Since local security maintenance on 2026-10-19, the canonical `Strata - Qwen` task uses Limited privileges. Run everyday controls normally; the background launcher refuses administrator startup. Stop requests shutdown of the specifically configured task, ends owned servers and waits for native cleanup using scoped ancestry/PID/creation checks. Independently confirm zero listeners/native workers before taking the GPU. Do not restore Highest privileges to work around a failed stop or tool environment. Local web tools use the dedicated hash-locked environment documented in the handoff and controls README; a source pull does not install or update that environment.

Documentation-only updates need no restart. Compatible HTML/CSS/JS-only updates can use the established static-file path while the Python server keeps running, after confirming the running handler reads those files afresh, idle state, preserved config hashes and served asset hashes. Python/server/native/config/package changes require restart.

Rollback restores the recorded tested source/engine and any corresponding config backup under the same coordinated shutdown/startup gate. Keep user data. Avoid force pushes, routine `reset --hard` and `clean -fdx`. Write deployment/publication results and outstanding limits into the handoff. Camera features remain experimental until their own fidelity gate is met.
