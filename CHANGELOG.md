# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-21

### Changed

- README documents the release procedure, including the constraint that made the first attempt fail: npm trusted publishing cannot create a package's first version, because a trusted publisher can only be configured on a package that already exists (`ENEEDAUTH`, npm/cli#8544). It also records the `actions/setup-node` `registry-url` gotcha, which writes an `_authToken` line that expands to empty and silently prevents the OIDC exchange.

## [0.1.0] - 2026-09-21

### Added

- Initial extraction of the shared core from `pi-ros-helper` and `pi-python-helper`, which had each implemented the same envelope, runner, safety, validation, and staleness logic independently (`src/core/version.ts` was byte-identical; `src/core/result.ts` had already drifted).
- `core/result.ts`: the shared response envelope with the `ok`/`attention` contract, `CORE_SCHEMA_VERSION`, and an ecosystem-neutral `ToolchainInfo` that replaces per-ecosystem metadata fields (`pythonVersion`, `rosDistro`). `createResultFactory(toolVersion)` binds the envelope to a package so a helper keeps its own call sites.
- `core/runner.ts`: one bounded subprocess entry point with timeout, `AbortSignal`, output caps, process-group termination, and `isSpawnFailure` for "the command never started".
- `core/safety.ts`: risk classification from command text. Universal rules (repository history, file system, containers, destructive SQL, pipe-to-shell) always apply; adapters add only their own package-manager rules.
- `validation/evidence.ts`, `validation/tdd.ts`, `validation/bundle.ts`: the completion gates, parameterised by adapter-supplied labels and file classification. `summarizeValidation` treats a preview, an unexecuted step, and a run that executed zero tests as failures rather than as non-failures.
- `build/staleness.ts`: generic "derived artifact older than its newest source" detection with adapter-supplied artifact specs.
- `selection/select.ts`: the test-selection ranking with injected file classification and module naming. Signals shared by every candidate are discarded so a package-rooted test tree narrows instead of selecting the whole suite.
- `adapter.ts`: the `EcosystemAdapter` seam and its supporting types.
- `test/purity.test.ts`: fails the build if an ecosystem name appears in core executable code, or if the core imports anything outside itself and Node builtins.
