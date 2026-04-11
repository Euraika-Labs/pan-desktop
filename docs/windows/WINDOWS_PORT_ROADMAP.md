# Windows Port Roadmap

Date: 2026-04-10
Repository: `fathah/hermes-desktop`

## 1. Goal

Turn Hermes Desktop into a maintainable native Windows desktop app for Hermes Agent.

That means:

- Windows packaging works
- Hermes Agent can be detected, installed, updated, and run on Windows
- users do not have to manually open terminals to make the app usable
- future Hermes Agent upstream changes can be absorbed without rewriting half the desktop app every release

## 2. What already works

The Electron side is in decent shape:

- `package.json` already has `build:win`
- `electron-builder.yml` already has a Windows target
- the app builds cleanly
- `electron-updater` is already integrated

So the GUI shell is not the hard part.

## 3. Main blockers

A detailed repo audit is captured in `WINDOWS_PORT_ANALYSIS_REPORT.md`.
The roadmap below remains the execution order for fixing those findings.

## 3.1 Unix-only runtime installer flow

File:

- `src/main/installer.ts`

Current behavior:

- hardcodes `~/.hermes`
- hardcodes `venv/bin/python`
- hardcodes `curl ... install.sh | bash`
- spawns `bash -c ...`
- sources `.zshrc`, `.bashrc`, `.profile`

Impact:

- core install/update path is wrong for native Windows

## 3.2 Runtime path assumptions leak everywhere

Files:

- `src/main/installer.ts`
- `src/main/utils.ts`
- `src/main/config.ts`
- `src/main/profiles.ts`
- `src/main/memory.ts`
- `src/main/tools.ts`
- `src/main/soul.ts`
- `src/main/cronjobs.ts`

Impact:

- even if installer is fixed, the rest of the app still assumes Unix layout

## 3.3 Renderer tells users the wrong story

File:

- `src/renderer/src/constants.ts`

Current behavior:

- hardcoded bash installer command in the UI layer

Impact:

- onboarding and product messaging remain Unix-only

## 3.4 Helper subprocess logic is mixed and brittle

File:

- `src/main/claw3d.ts`

Current behavior:

- mixed `which ... || where ...`
- POSIX-first executable discovery logic

Impact:

- optional helper flows become a death by 1000 subprocess paper cuts on Windows

## 4. Target architecture

## 4.1 App shell vs runtime split

### Electron shell

Responsibilities:

- windowing
- menus
- updater UI
- renderer state
- IPC

### Hermes runtime layer

Responsibilities:

- install detect
- install
- repair
- update
- version probe
- doctor
- run Hermes CLI processes

### Platform adapter

Responsibilities:

- Windows/macOS/Linux pathing
- env construction
- shell/process strategy
- executable resolution

### Feature services

Responsibilities:

- profiles
- config
- memory
- tools
- skills
- cron
- sessions

Feature services must depend on runtime/path abstractions, not raw OS assumptions.

## 4.2 Architecture rules

1. No renderer code should construct installer commands.
2. No feature service should hardcode `~/.hermes` or `venv/bin/python`.
3. All process spawning should go through a shared process abstraction.
4. Desktop app updates and Hermes runtime updates must stay separate.

## 5. Recommended implementation waves

## Wave 1 — runtime foundation

Focus files:

- `src/main/installer.ts`
- `src/main/utils.ts`
- `src/renderer/src/constants.ts`

Create:

- `src/main/platform/platformAdapter.ts`
- `src/main/platform/processRunner.ts`
- `src/main/runtime/runtimePaths.ts`
- `src/main/runtime/runtimeInstaller.ts`
- `src/main/runtime/runtimeUpdate.ts`
- `src/main/runtime/runtimeProbe.ts`

Outcome:

- Windows install/detect/update path becomes real and centralized

## Wave 2 — migrate feature services

Focus files:

- `src/main/config.ts`
- `src/main/profiles.ts`
- `src/main/memory.ts`
- `src/main/tools.ts`
- `src/main/soul.ts`
- `src/main/cronjobs.ts`

Outcome:

- profiles/config/memory/tools stop leaking OS assumptions

## Wave 3 — subprocess/helper cleanup

Focus files:

- `src/main/claw3d.ts`
- any remaining subprocess-heavy services

Outcome:

- Windows process handling is predictable and testable

## Wave 4 — runtime update and compatibility polish

Create/finish:

- runtime compatibility manifest
- runtime version checks in UI
- update/repair UX

Outcome:

- Hermes Agent updates become routine instead of improv theater

## 6. Update model

There are two update streams:

### Desktop app updates

Handled by:

- `electron-updater`

### Hermes runtime updates

Handled by:

- a dedicated runtime update service
- initially likely by running `hermes update`
- later optionally by versioned runtime bundles

This split is mandatory for long-term sanity.

## 7. Recommended success definition for milestone 1

Milestone 1 is done when:

- Windows build launches
- app can detect Hermes install on Windows
- app can install Hermes on Windows using a Windows-aware strategy
- app can update Hermes on Windows
- paths for profiles/config/memory are correct on Windows
- no core installer/runtime UX still depends on bash-specific instructions in the UI

## 8. Main risk area

The biggest risk is not Electron.
The biggest risk is letting runtime assumptions remain scattered across the codebase.

If we centralize installer/path/process logic early, the port remains maintainable.
If we do not, every future Hermes Agent update becomes a forensic exercise with string concatenation as the murder weapon.
