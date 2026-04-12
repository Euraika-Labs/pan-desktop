# Architecture Overview

## Core principle

Treat the desktop app and the Hermes runtime as separate systems.

- Electron shell = UX, updater, orchestration
- Hermes runtime = install/update/run/detect/diagnose
- Platform adapter = translates Windows/macOS/Linux differences

If these concerns blur together, every upstream change becomes a scavenger hunt.

## Target layers

### 1. Electron shell
Responsibilities:
- windows
- menus
- updater UI
- IPC
- renderer state and presentation

Must NOT know:
- exact Hermes install commands
- exact Python path layout
- exact profile directory layout per OS

### 2. Runtime layer
Responsibilities:
- detect Hermes install
- install Hermes
- repair Hermes install
- update Hermes runtime
- run version/doctor/chat/process commands

Must expose a stable API to the Electron shell.

### 3. Platform adapter layer
Responsibilities:
- resolve home directories and runtime roots
- compute executable paths
- select installer strategy
- manage PATH separators and env shaping
- choose shell/process strategy

This is where Windows-specific behavior belongs.

### 4. Domain services
Examples:
- profiles service
- config service
- memory service
- tools service
- skills service
- cron/session helpers

These services should work only with runtime/path abstractions, not raw OS assumptions.

## Immediate architectural smells to eliminate

Smells we already know about from the audit:
- hardcoded `~/.hermes`
- hardcoded `venv/bin/python`
- hardcoded CLI install strings like `curl ... | bash`
- `spawn("bash", ...)` in core install/update paths
- `which ... || where ...` shell strings
- shell profile sourcing (`.bashrc`, `.zshrc`) in Windows-relevant flows

## Stable abstraction boundaries we want

### Runtime paths boundary (Hermes Agent only)
`src/main/runtime/runtimePaths.ts` — single source of truth for Hermes Agent storage:
- Hermes home
- repo dir
- venv dir
- Python path (with `Scripts\python.exe` vs `bin/python` resolved here)
- Hermes CLI path (with `.exe`/`.cmd`/`.bat` extension resolution — tries candidates in order)
- env/config files
- profiles root
- per-profile home

Must be function-based, not exported constants, so importers are forced through the abstraction.

### Desktop paths boundary (shell-owned storage)
`src/main/runtime/desktopPaths.ts` — parallel boundary for Electron-owned state, distinct from Hermes Agent storage:
- `userData` (via `app.getPath('userData')` → `%APPDATA%\Pan Desktop\` on Windows)
- `stateDb` (sessions SQLite)
- `sessionCache` (cached sessions JSON)
- `claw3dSettings` (Claw3D local settings, previously hardcoded at `~/.openclaw/claw3d`)
- `logs` (via `app.getPath('logs')`)

Must use a lazy accessor — `app.getPath()` is not valid until Electron's `ready` event fires. Must fall back to legacy Unix paths for backward compatibility without forcing migration in M1.

### Installer boundary
`src/main/runtime/runtimeInstaller.ts` — single source of truth for:
- install
- update
- doctor
- install prerequisites
- progress events

Implementations: `UnixInstallerStrategy`, `WindowsInstallerStrategy`. Renderer must NOT know install commands — all install strings live here.

### Process runner boundary
`src/main/platform/processRunner.ts` — single source of truth for:
- spawn/exec
- output capture
- detached/background processes
- Windows vs Unix executable lookup (via `findExecutable(name)`)
- environment construction (PATH separator, PATH extras, env shaping)
- **cross-platform process termination** via `killTree(handle, { timeout })` — uses `tree-kill` npm package to handle POSIX process groups vs Windows `taskkill /F /T`
- signal normalization — `SIGKILL` is not a Windows signal; caller uses the `killTree` abstraction rather than raw `proc.kill("SIGKILL")`

## Long-term maintainability rule

No feature code should care whether Hermes lives in:
- `~/.hermes`
- `%LOCALAPPDATA%\hermes`
- a bundled runtime directory
- a versioned runtime folder

That concern belongs entirely to the runtime/platform layer.

Equivalently: no feature code should care whether desktop-owned state lives in:
- `~/.hermes/state.db`
- `%APPDATA%\Pan Desktop\state.db`
- `~/Library/Application Support/Pan Desktop/state.db`
- `~/.config/Pan Desktop/state.db`

That concern belongs entirely to `desktopPaths`.

## Invariants (cannot be violated without reversing via `DECISION_LOG.md`)

1. No OS-specific logic outside `src/main/platform/`
2. No hardcoded Hermes Agent paths outside `src/main/runtime/runtimePaths.ts`
3. No hardcoded desktop-owned paths outside `src/main/runtime/desktopPaths.ts`
4. No subprocess `spawn`/`exec`/`kill` outside `src/main/platform/processRunner.ts`
5. No install/update command strings in `src/renderer/`
6. Two-layer update model: `electron-updater` for shell, `runtimeUpdate` service for Hermes Agent
7. No scattered `process.platform === 'win32'` checks — all branches go through `platformAdapter`

See `DECISIONS_M1.md` §10 for the full invariant list.
