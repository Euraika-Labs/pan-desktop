# Analysis Report — Hermes Desktop → Windows Port Readiness

Date: 2026-04-10
Scope: `/opt/projects/pan-desktop/hermes-desktop/src`
Lens: architectural smells listed in `docs/windows/WINDOWS_PORT_ROADMAP.md` and the planned Wave 1 targets
Depth: deep, pattern-grounded

## Bottom line

Current code runs on Unix assumptions end-to-end.
A native Windows install will fail at first launch unless the runtime layer is refactored first.

The good news: the problems are concentrated exactly where the roadmap predicted they would be.
The even better news: there are almost no scattered half-finished Windows hacks yet, so the adapter layer can still be introduced cleanly.

---

## Severity scoreboard

| # | Smell | Present? | Location | Severity |
|---|---|---|---|---|
| 1 | Hardcoded `~/.hermes` | Yes | `src/main/installer.ts:8` and propagated via exports | Blocker |
| 2 | Hardcoded `venv/bin/python` | Yes | `src/main/installer.ts:11` | Blocker |
| 3 | `curl ... | bash` install string | Yes | `src/main/installer.ts:411`, `src/renderer/src/constants.ts:329` | Blocker |
| 4 | `spawn("bash", ...)` in install path | Yes | `src/main/installer.ts:414` | Blocker |
| 5 | `.bashrc` / `.zshrc` sourcing assumptions | Yes | `src/main/installer.ts:318-329` | High |
| 6 | `which ... || where ...` shell string | Yes | `src/main/claw3d.ts:247` | High |
| 7 | PATH built with Unix `:` separator | Yes | `src/main/installer.ts:41` | Blocker |
| 8 | Hardcoded `/usr/local/bin`, `/opt/homebrew/bin` | Yes | `src/main/installer.ts:37-39` | High |
| 9 | Install command in renderer constants | Yes | `src/renderer/src/constants.ts:329` | High |
| 10 | Existing `win32` conditionals scattered everywhere | No | — | Good news |
| 11 | Existing platform adapter layer | No | `src/main/platform/` missing | Blocker |
| 12 | Existing runtime abstraction layer | No | `src/main/runtime/` missing | Blocker |

---

## Architectural findings

### A1. `installer.ts` is the single biggest failure surface

Current exported constants:
- `HERMES_HOME = join(homedir(), ".hermes")`
- `HERMES_REPO = join(HERMES_HOME, "hermes-agent")`
- `HERMES_VENV = join(HERMES_REPO, "venv")`
- `HERMES_PYTHON = join(HERMES_VENV, "bin", "python")`
- `HERMES_SCRIPT = join(HERMES_REPO, "hermes")`

Why this matters:
- these constants leak a Unix runtime model into the rest of the app
- importers are forced to assume a fixed Hermes layout
- on Windows the venv path and executable model are different

Required action:
- move all runtime path logic into `src/main/runtime/runtimePaths.ts`
- expose functions, not exported path constants
- force importers through the abstraction

### A2. PATH construction is Unix-shaped

Current behavior:
- builds enhanced PATH with `:`
- assumes Unix-centric locations like `.local/bin`, `.cargo/bin`, `/usr/local/bin`, `/opt/homebrew/bin`

Required action:
- move PATH construction into `platformAdapter.buildEnhancedPath()`
- define per-OS logic there

### A3. Install strategy is literally a bash pipe

Current behavior:
- install command is `curl ... install.sh | bash`
- install is launched with `spawn("bash", ["-c", ...])`
- renderer constants also know about the install command

Required action:
- create an installer strategy boundary
- keep Unix installer flow in a Unix strategy
- add a Windows installer strategy
- remove installer command knowledge from renderer constants

### A4. Shell profile sourcing is Unix-only

Current behavior:
- installer tries `.zshrc`, `.bashrc`, `.bash_profile`, `.profile`

Required action:
- move this behind a platform adapter method
- Windows should not pretend shell profile sourcing is the right environment model

### A5. `claw3d.ts` mixes platforms inside one shell string

Current behavior:
- `which npm 2>/dev/null || where npm 2>/dev/null`

Required action:
- route executable lookup through a shared process/executable resolver
- no shell glue strings for cross-platform lookup

### A6. Subprocess orchestration is not abstracted

Observation:
- subprocess logic is spread across multiple files without a shared runner

Required action:
- introduce `ProcessRunner`
- centralize spawn/exec/lookup/env shaping there

### A7. Wave 1 architecture layer does not exist yet

Observation:
- `src/main/platform/` does not exist
- `src/main/runtime/` does not exist

Interpretation:
- the roadmap is directionally correct
- implementation has simply not started yet

---

## What is NOT a problem

Good news worth preserving:
- the Electron app already has Windows packaging hooks
- the app builds cleanly
- there are not yet random `win32` hacks all over the codebase
- main/renderer separation is still clean enough to refactor properly
- the update split (desktop app vs Hermes runtime) is already conceptually present

This means the codebase is still in the “refactorable” phase rather than the “haunted house of workaround debt” phase.

---

## Prioritized recommendations

### PR 1 — foundation layer
Create:
- `src/main/platform/platformAdapter.ts`
- `src/main/platform/processRunner.ts`
- `src/main/runtime/runtimePaths.ts`

Then:
- delete exported runtime constants from `installer.ts`
- make all runtime path access go through the new abstractions

### PR 2 — installer migration
- create installer strategy boundary
- preserve Unix path on Unix
- add Windows installer strategy
- remove install command leakage from renderer constants

### PR 3 — feature service migration
Migrate to runtime/path abstractions:
- `config.ts`
- `profiles.ts`
- `memory.ts`
- `tools.ts`
- `soul.ts`
- `cronjobs.ts`

### PR 4 — subprocess cleanup
- replace shell-string executable lookup in `claw3d.ts`
- migrate remaining subprocess logic onto `ProcessRunner`

### Cross-cutting enforcement
Add lint / code review rules that ban raw occurrences of:
- `~/.hermes`
- `venv/bin`
- `.bashrc`, `.zshrc`
- `curl ... | bash`
- `spawn("bash", ...)`
outside the platform/runtime abstraction layer

That is how the port stays healthy instead of slowly regressing back into accidental Unixism.

---

## Metrics snapshot

| Metric | Value |
|---|---|
| `src/main` files containing Unix-only path assumptions | multiple core files |
| `homedir()` call sites in `src/main` | concentrated across installer/runtime-related modules |
| subprocess call sites without shared abstraction | present across `installer.ts`, `hermes.ts`, `claw3d.ts` |
| platform/runtime abstraction layers present | 0 |
| existing scattered `win32` special cases | almost none |
| estimated PRs to reach Windows-capable milestone 1 | about 5 |

---

## Final verdict

The roadmap was right.
The code confirms it.

The next highest-value move is still the same:
- build the platform/runtime foundation first
- do not start by sprinkling Windows conditionals through feature files

If that foundation lands cleanly, future Hermes Agent updates remain manageable.
If it does not, every future change will cost more than it should and the project will slowly congeal into a cursed path-joining machine.
