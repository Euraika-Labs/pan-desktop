# Windows Task Breakdown

This document turns the roadmap into concrete engineering tasks.

## Wave 1 — runtime foundation

This wave is directly justified by the findings in `WINDOWS_PORT_ANALYSIS_REPORT.md`:
- installer/runtime constants leak Unix paths
- install/update orchestration assumes bash
- runtime abstractions do not exist yet

### Task 1.1 — Introduce runtime path abstraction
Create:
- `src/main/runtime/runtimePaths.ts`

Responsibilities:
- resolve Hermes home
- resolve repo dir
- resolve venv dir
- resolve Hermes CLI path
- resolve env/config paths
- resolve profiles root and profile home

Acceptance criteria:
- no new direct path joins for Hermes internals outside this module
- Windows paths support `%LOCALAPPDATA%`-style layout

### Task 1.2 — Introduce platform adapter
Create:
- `src/main/platform/platformAdapter.ts`

Responsibilities:
- identify platform
- define path separator behavior
- expose installer shell strategy
- expose default runtime root behavior

Acceptance criteria:
- Windows/macOS/Linux decisions no longer live inline in unrelated service files

### Task 1.3 — Introduce shared process runner
Create:
- `src/main/platform/processRunner.ts`

Responsibilities:
- exec/spawn wrappers
- stdout/stderr capture
- executable lookup
- detached/background process support

Acceptance criteria:
- new subprocess logic uses this module
- no new `bash -c` strings in feature code

### Task 1.4 — Split installer.ts into runtime services
Refactor:
- `src/main/installer.ts`

Move logic into:
- `runtimeInstaller.ts`
- `runtimeUpdate.ts`
- `runtimeProbe.ts`

Acceptance criteria:
- `installer.ts` becomes orchestration facade, not giant logic dump

### Task 1.5 — Remove hardcoded install command from renderer constants
Refactor:
- `src/renderer/src/constants.ts`

Replace:
- hardcoded `INSTALL_CMD`

With:
- platform-aware installer hint from IPC/runtime service

Acceptance criteria:
- UI does not advertise Unix-only install commands on Windows

## Wave 2 — service migration

### Task 2.1 — Migrate utils.ts away from raw `HERMES_HOME`
Refactor:
- `src/main/utils.ts`

Acceptance criteria:
- `profileHome()` becomes adapter/runtime aware
- helper comments/docs no longer claim Unix-only assumptions

### Task 2.2 — Migrate profiles service
Refactor:
- `src/main/profiles.ts`

Acceptance criteria:
- profile listing, creation, switching use runtime path service
- no direct `~/.hermes/profiles` assumptions remain

### Task 2.3 — Migrate config service
Refactor:
- `src/main/config.ts`

Acceptance criteria:
- config file paths come from runtime path service

### Task 2.4 — Migrate memory service
Refactor:
- `src/main/memory.ts`

Acceptance criteria:
- memory file paths are runtime/profile aware
- Windows path behavior is validated in tests

### Task 2.5 — Migrate tools/soul/cron services
Refactor:
- `src/main/tools.ts`
- `src/main/soul.ts`
- `src/main/cronjobs.ts`

Acceptance criteria:
- all Hermes-owned files are resolved through the shared path layer

## Wave 3 — subprocess and helper cleanup

### Task 3.1 — Fix claw3d subprocess lookup
Refactor:
- `src/main/claw3d.ts`

Acceptance criteria:
- no `which ... || where ...` shell string hacks remain
- executable resolution goes through `processRunner`

### Task 3.2 — Audit remaining spawn/exec users in `src/main/`
Acceptance criteria:
- process logic is centralized
- shell choice is explicit and platform-aware

## Wave 4 — updates and compatibility

### Task 4.1 — Add runtime compatibility module
Create:
- `src/main/runtime/runtimeManifest.ts`

Responsibilities:
- minimum supported Hermes version
- preferred/tested Hermes version
- migration/compatibility checks

### Task 4.2 — Add runtime update service UI integration
Integrate with renderer:
- current runtime version
- update available state
- progress
- failure reason
- repair path

### Task 4.3 — Decide on long-term runtime update strategy
Decision required:
- use `hermes update` long-term
- or move to versioned runtime bundles

## Testing tasks

### Test task A — path unit tests
Add tests for:
- runtime home on Windows
- CLI path resolution on Windows
- profile home path resolution on Windows

### Test task B — installer command tests
Add tests for:
- Windows installer command generation
- Linux/macOS installer command generation
- update command generation

### Test task C — subprocess contract tests
Add tests for:
- executable lookup
- process spawning
- stdout/stderr capture normalization

### Test task D — Windows CI smoke coverage
Ensure CI covers at minimum:
- installer/runtime path modules
- profile/config pathing
- update flow logic generation

## Suggested PR breakdown

### PR 1
- platform adapter
- runtime path abstraction
- initial installer refactor

### PR 2
- renderer install constants cleanup
- runtime probe/update service foundation

### PR 3
- profiles/config/memory/tools migration

### PR 4
- claw3d and subprocess cleanup

### PR 5
- runtime compatibility/update polish

## Do-not-do list

Do not:
- patch each file with random `if (process.platform === 'win32')`
- leave installer command strings in renderer constants
- hardcode Windows paths in multiple modules
- mix desktop app update code with Hermes runtime update logic
- treat successful Electron packaging as proof the runtime layer is Windows-ready

Because that is exactly how we end up debugging path joins at 2am while pretending this was all part of the design.
