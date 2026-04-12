# Refactor Order and Waves

This is the order we attack the codebase in. The sequence matters. Order was
updated on 2026-04-10 to reflect the M1 decisions captured in `DECISIONS_M1.md`.

## Wave 0 — Rebrand + docs housekeeping (new, must land first)

This wave did not exist in the original plan. It was added after the discover/define
session established that Pan Desktop is a hard fork with a full rebrand, and that
Wave 1 touches files carrying product-name references — so renaming after the
refactor would mean editing the same files twice.

### PR 0a — `docs/housekeeping`
Pure doc changes, zero risk:
- STALE 1: record repo co-location in `DECISION_LOG.md`, remove `OPEN_QUESTIONS.md` Q8, update `CLAUDE.md` scope
- GAP 5: add "Windows developer prerequisites" section to `DEVELOPER_WORKFLOW.md` (MSVC Build Tools, Python, node-gyp, Git for Windows, consider `@vscode/better-sqlite3` prebuilds)
- GAP 7: add IPC namespace rule to `DEVELOPER_WORKFLOW.md` (`runtime:*`, `platform:*`, `desktop:*` prefixes for new handlers)

### PR 0b — `rebrand/pan-desktop`
Full product rename. Touches a lot of files but no runtime logic:
- `package.json` — `name`, `description`, `author`, `homepage`, add `productName`, version → `0.0.1`
- `electron-builder.yml` — `appId`, `productName`, NSIS artifact name, `publish` block
- `dev-app-update.yml` — `generic` provider pointing at GitLab Pages URL
- `src/main/index.ts:748` — `setAppUserModelId("net.euraika.pandesktop")`
- Electron `BrowserWindow` titles, macOS bundle ID
- All product-name strings in `src/renderer/src/`
- `README.md`, `CONTRIBUTING.md`
- `LICENSE` (add Euraika copyright line) + new `NOTICE` file documenting fork origin
- `.github/workflows/*.yml` — repo references

**Git history:** squash all prior commits, reset to `v0.0.1`. Preserves upstream attribution via `LICENSE` + `NOTICE`, not via commit history.

### Exit criteria
- `npm run build` still succeeds on macOS/Linux (Windows build still broken pre-Wave-1 — that's fine)
- All UI strings reflect "Pan Desktop"
- `DECISIONS_M1.md` and `ARCHITECTURE_OVERVIEW.md` invariants are explicit

## Wave 0.5 — CI foundation (new)

### PR 0.5a — `ci/github-mirror-setup`
One-time infra setup:
- Create GitHub mirror of `git.euraika.net/pan-desktop`
- Configure mirror push/pull (GitLab-primary → GitHub-mirror)
- Document the two-remote workflow in `DEVELOPER_WORKFLOW.md`

### PR 0.5b — `ci/windows-matrix`
- `.github/workflows/ci.yml` (new) — PR checks matrix `{windows-latest, macos-latest, ubuntu-latest}` running `lint + typecheck + build`
- `.github/workflows/release.yml` — extend with a `windows-latest` job producing NSIS artifact
- Cache: `~/.npm` only
- First Windows CI run against pre-Wave-1 `develop` to capture baseline failure signature as a tracking issue

### Exit criteria
- PR CI runs green on macOS and Linux, red-but-documented on Windows (baseline)
- Every PR to `develop`/`main` triggers the 3-OS matrix

## Wave 1 — Runtime foundation

### First files to refactor
1. `src/main/installer.ts`
2. `src/main/utils.ts`
3. `src/renderer/src/constants.ts`

### Why this wave comes first (after Wave 0/0.5)
These are the choke points where Unix-only assumptions leak into everything else.

### Target outputs (modules to create)
- `src/main/platform/platformAdapter.ts`
- `src/main/platform/processRunner.ts` — with `killTree()` using the `tree-kill` package (default 5000ms grace, caller-overridable)
- `src/main/runtime/runtimePaths.ts` — with `.exe`/`.cmd`/`.bat` extension resolution inside `getHermesCli()`
- `src/main/runtime/desktopPaths.ts` — parallel boundary for Electron-owned state (lazy accessor, `ready`-event-safe, fallback-reads from legacy Unix paths)
- `src/main/runtime/runtimeInstaller.ts`
- `src/main/runtime/runtimeUpdate.ts`
- `src/main/runtime/runtimeProbe.ts`

### Recommended PR structure for this wave
- `feature/wave1-foundation` — create all four abstraction files with unit tests. No migrations yet. Deletes `HERMES_PYTHON` / `HERMES_SCRIPT` exports from `installer.ts` as the last step — this is the enforcement mechanism that forces importers through the new paths.
- `feature/claw3d-windows` — migrate `claw3d.ts` to `processRunner.killTree()` AND `desktopPaths.claw3dSettings` in a single PR (both gaps touch the same file; splitting causes merge churn)
- `feature/wave1-refactor` — migrate `installer.ts` + `utils.ts` + `constants.ts` onto the new abstractions. This is where real Windows support lands.

### Exit criteria
- No hardcoded install shell flow in renderer constants
- Installer logic no longer directly assumes bash on Windows
- Path resolution happens through runtime helpers only
- `processRunner.killTree()` cleanly terminates a multi-child npm subtree on all three platforms
- Zero direct `process.kill`, `proc.kill("SIGKILL")`, or `app.getPath('userData')` calls outside the platform/runtime layer
- ESLint rules enforcing the above are active

## Wave 2 — Service migration

### Files
4. `src/main/config.ts`
5. `src/main/profiles.ts`
6. `src/main/memory.ts`
7. `src/main/tools.ts`
8. `src/main/soul.ts`
9. `src/main/cronjobs.ts`

### Goal
Move all feature services onto `runtimePaths` and `desktopPaths` abstractions.

### Exit criteria
- Profile/config/memory/tool code does not hardcode Hermes home assumptions
- All file path generation is centralized through the runtime/desktop paths boundaries
- `state.db`, `sessions.json`, and Claw3D settings live behind `desktopPaths` (migrated from wherever they were before)

## Wave 3 — Helper subprocess cleanup

### Files
10. Any remaining subprocess-heavy files in `src/main/` that Wave 1 didn't catch
11. Hermes gateway process lifecycle in `src/main/hermes.ts`

(Note: `claw3d.ts` already migrated in Wave 1 as part of `feature/claw3d-windows`.)

### Goal
Replace ad hoc shell command execution with `processRunner`.

### Exit criteria
- No mixed `which`/`where` shell strings in feature logic
- Subprocess lookup is predictable and testable across all platforms
- All termination routes through `processRunner.killTree()`

## Wave 4 — Update polish + signing scaffold + updater channel

### Files / modules
- `src/main/runtime/runtimeUpdate.ts` (full implementation)
- Compatibility manifest handling
- App/runtime version compatibility UI
- `electron-builder.yml` `win.sign` scaffold (commented, env-var driven)
- `build/afterPack.js` — drop macOS-only early return, add Windows branch
- `dev-app-update.yml` — wire to GitLab Pages `generic` provider
- GitLab Pages site setup for the `pan-desktop` project

### Goal
Make Hermes Agent updates routine, Pan Desktop app updates routine, and set the scaffold for signing in M1.1.

### Exit criteria
- Desktop app knows if a Hermes Agent runtime version is supported
- Runtime update flow has clear progress/errors
- Pan Desktop publishes `latest.yml` + NSIS binary to GitLab Pages
- `electron-updater` generic provider points at the GitLab Pages URL
- Release notes template + README include SmartScreen notice and install walkthrough
- `win.sign` scaffold in place (commented) for M1.1 activation

## Recommended landing order (wall-clock days)

| Day | PR | Wave |
|---|---|---|
| 0a | `docs/housekeeping` | Wave 0 |
| 0b | `rebrand/pan-desktop` | Wave 0 |
| 1a | `ci/github-mirror-setup` | Wave 0.5 |
| 1b | `ci/windows-matrix` | Wave 0.5 |
| 2–3 | `feature/wave1-foundation` | Wave 1 |
| 4 | `feature/claw3d-windows` | Wave 1 |
| 5 | `feature/wave1-refactor` | Wave 1 |
| 6–7 | `feature/wave2-services` | Wave 2 |
| 8 | `feature/wave3-subprocess-cleanup` | Wave 3 |
| 9 | `feature/wave4-updater-and-signing-scaffold` | Wave 4 |
| 10 | `release/m1-smoke-test` | — |
| 11+ | `release/v0.0.1` | ship |

## Rule of thumb

If a PR changes both:
- user-facing desktop behavior
- and low-level runtime path logic

without a clear abstraction boundary, it is probably trying to do too much.

Exception: `feature/claw3d-windows` intentionally bundles two gaps (process portability + desktop paths) because both touch the same file and splitting causes merge churn.
