# Developer Workflow

## Purpose

This doc defines how to work on the Pan Desktop Windows port without losing the thread.

## Developer prerequisites

Pan Desktop is an Electron app with native dependencies. The hardest part of the initial setup is the native module rebuild for `better-sqlite3`, which requires a working C/C++ toolchain.

### All platforms
- **Node.js 22 or newer** (pin via `.nvmrc` if you use nvm — we don't bundle one yet)
- **npm 10+** (ships with Node 22)
- **Git**

### Windows additionally
- **[Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)** — required for `better-sqlite3` native rebuild during `npm install` / `npm ci`. Pick the "Desktop development with C++" workload. Without this, the native rebuild fails and the app can't open the sessions database.
- **Python 3.x** — required by `node-gyp` for the native build. Add to PATH.
- **[Git for Windows](https://gitforwindows.org/)** — includes Git Bash, which the current Hermes Agent installer uses internally. Until the Windows installer strategy lands (Wave 4), Git Bash is a hard requirement.
- Optional: `@vscode/better-sqlite3` prebuilds — if you want to skip the native build entirely on most dev machines, we can swap `better-sqlite3` for the `@vscode/*` fork which ships prebuilt binaries for common platforms.

### macOS additionally
- Xcode Command Line Tools (`xcode-select --install`) — Python and toolchain.
- Apple Silicon machines: no extra steps; `electron-builder` handles the arch.

### Linux additionally
- `build-essential` (Debian/Ubuntu) or equivalent
- `libsecret-1-dev` if you add keychain features later (not required today)

### Verifying your setup

A clean bootstrap on a new machine should look like:

```bash
git clone https://git.euraika.net/euraika/pan-desktop.git
cd pan-desktop
npm ci
npm run typecheck
npm run lint
npm run dev
```

If any step fails, the prerequisite list above is the first thing to check.

## Working with the two-remote setup

Pan Desktop lives on **two git remotes**:

- **GitLab primary:** `git.euraika.net/euraika/pan-desktop` — all development, PRs, issues, and reviews
- **GitHub CI mirror:** `github.com/Euraika-Labs/pan-desktop` — read-only mirror used only for GitHub Actions Windows runners (free for public repos)

**Rules:**

1. **Always push to `origin` (GitLab).** Never push to `github` directly — it'll cause mirror divergence. The local `github` remote exists only as a fallback for the rare case where the automatic mirror hiccups.
2. **GitLab auto-mirrors to GitHub every ~5 minutes** (or on demand via the API). If your CI run looks stale, the mirror may be behind — check GitLab → Settings → Repository → Mirroring repositories.
3. **Contributors' feature branches must live on the GitLab primary**, not on personal forks, for CI to run on them. The mirror only covers branches that exist on the primary.
4. **`upstream` is fetch-only.** It points at `fathah/hermes-desktop` for historical reference and one-shot cherry-picks. Push to `upstream` is explicitly disabled in this project's local config as hard-fork hygiene.
5. **Credential note:** The GitLab → GitHub mirror uses a GitHub PAT stored encrypted in GitLab. If it stops working, the mirror's health indicator will turn red in GitLab's UI — rotate the PAT.

## Ground rules

1. Never add new hardcoded platform paths in feature code.
2. Never let renderer code invent runtime install commands.
3. Never solve a path/runtime problem in more than one place.
4. Every Windows-specific behavior should live in an adapter or service boundary.
5. New IPC handlers must follow the namespace rule (see below).

## Where new logic should go

- OS-specific concerns → `src/main/platform/`
- Hermes Agent install/update/run concerns → `src/main/runtime/` (especially `runtimePaths.ts`, `runtimeInstaller.ts`, `runtimeUpdate.ts`)
- Desktop-owned storage (state DB, session cache, Claw3D settings, logs) → `src/main/runtime/desktopPaths.ts`
- Domain behavior (profiles, memory, tools, skills, sessions, cron) → `src/main/*.ts` services
- UI concerns → `src/renderer/`

## IPC namespace rule

The main process exposes 50+ IPC handlers today (pre-Wave 1) under a flat namespace. As Wave 1/2 introduces new runtime and platform services, new handlers must use namespace prefixes to prevent collisions and keep concerns discoverable:

- `runtime:*` — runtime services (paths, installer, update, probe, manifest)
- `platform:*` — platform services (process runner, executable lookup, env shaping)
- `desktop:*` — desktop-owned services (sessions cache, state DB, Claw3D settings, logs)

**Examples:**
- `runtime:getHermesCli` (not `getHermesCli`)
- `platform:findExecutable` (not `findExecutable`)
- `desktop:getStateDbPath` (not `getStateDbPath`)

**Scope of the rule:**
- Applies to new handlers added in Wave 1 and later.
- **Existing unprefixed handlers stay unchanged.** Renaming them is deferred to M1.1 or later — the cost of IPC breakage during active refactoring is not worth the aesthetic win.
- If a new handler absolutely belongs in an existing unprefixed area (e.g., chat), leave it flat — the rule is for the three new boundaries, not a universal convention.

## Before starting a change

Read, in this order:

1. `docs/INDEX.md`
2. `docs/DECISIONS_M1.md` — **source of truth for M1 scope; supersedes older docs where they conflict**
3. `docs/ARCHITECTURE_OVERVIEW.md`
4. `docs/DECISION_LOG.md`
5. `docs/OPEN_QUESTIONS.md`

## When making architectural changes

Always update:

- `docs/DECISION_LOG.md` with a dated entry
- `docs/OPEN_QUESTIONS.md` if tradeoffs remain
- `docs/INDEX.md` if new docs are added
- `docs/DECISIONS_M1.md` §10 (invariants) if the change alters an invariant

## PR hygiene

Prefer small waves. Each PR should ideally answer one of these:

- introduces a new abstraction
- migrates one service onto the abstraction
- fixes one cross-platform subprocess/path issue
- improves runtime update behavior

**Exception:** the `feature/claw3d-windows` PR intentionally bundles two concerns (process portability + desktopPaths migration) because both touch `claw3d.ts` and splitting causes merge churn.

## Definition of a healthy change

A healthy change:

- reduces path/shell duplication
- moves logic toward adapters/services
- increases testability
- makes future Hermes Agent updates cheaper
- respects the IPC namespace rule

## Definition of an unhealthy change

An unhealthy change:

- sprinkles `process.platform === 'win32'` everywhere
- patches the renderer to compensate for runtime bugs
- adds new shell strings instead of using `processRunner`
- encodes installer logic in UI copy/constants
- adds a new IPC handler without a namespace prefix
- reintroduces hardcoded `~/.hermes`, `venv/bin/python`, `/usr/local/bin/...`, `curl | bash`, or `.bashrc`/`.zshrc` sourcing

## Documentation maintenance rule

If we learn something non-obvious while porting:

- add it to `DECISION_LOG.md` if it is decided
- add it to `OPEN_QUESTIONS.md` if still unresolved
- add it to architecture docs if it affects the model
- update `DECISIONS_M1.md` §10 if it creates or modifies an invariant

Because memory is finite and future confusion is infinite.


## Cross-building Windows NSIS from Linux (dev loop only)

**Canonical CI builds happen on `windows-latest`.** Do not push branches expecting Linux-to-Windows builds to be authoritative. The shipping NSIS installer is always produced by the `release_win` GitHub Actions job running on a real Windows runner, which rebuilds `better-sqlite3` against Electron's Node ABI via `electron-builder install-app-deps` (see `electron-builder.yml` `npmRebuild: true`). That is the binary users download.

For fast local iteration on Linux/WSL2, developers can still cross-build a `--dir` output without going through CI. The trick is to tell `npm install` to fetch the Electron-specific Windows prebuild of `better-sqlite3` instead of the host Linux one:

```bash
cd hermes-desktop
npm_config_runtime=electron \
npm_config_target="$(node -e 'console.log(require("electron/package.json").version)')" \
npm_config_platform=win32 \
npm_config_arch=x64 \
npm install --no-save better-sqlite3
npx electron-builder --win nsis --publish never
```

Notes:

- `electron-builder`'s asar integrity step on Linux requires `wine` for signed builds. For unsigned dev builds use `--dir` instead of `nsis` — this produces `dist/win-unpacked/` and skips NSIS + asar integrity entirely.
- The `npm_config_*` env vars instruct `prebuild-install` (which runs inside `better-sqlite3`'s install script) to download the prebuild keyed by Electron's V8/Node ABI for `win32-x64`, not the host Linux prebuild. Without these vars you will silently ship a Linux `.node` inside a Windows package — the exact bug Wave 6 is closing.
- The `--no-save` flag keeps the cross-platform binary out of `package-lock.json`.
- If `npx electron-builder --win --dir` ever produces a working output but `--win nsis` does not, that is the signed-integrity / asar step failing, not a native module issue. Use the `--dir` output for local smoke tests.
- **For the final shipping installer, ALWAYS use `windows-latest` CI.** The `release_win` job is the canonical artifact source and the Wave 6 PE-verification step is a belt-and-braces assertion that the `.node` inside the installer is a real PE32+ DLL, not an ELF that snuck through.

## Crash Dumps

When an M1 user experiences a hard crash (e.g. Electron process termination, native extension fault), a `.dmp` file is automatically saved to the user's local crash dump directory.

- **Windows:** `%APPDATA%\Pan Desktop\Crashpad\reports` (or check `app.getPath('crashDumps')` via the fatal error dialog).
- **macOS/Linux:** Consult the fatal error dialog for the exact `crashDumps` path.

To investigate:
1. Ask the user to zip and upload the `.dmp` file.
2. Load the `.dmp` into a debugger (e.g., WinDbg on Windows) or use breakpad tools to analyze the stack trace against our compiled Electron version.

## Collecting crash dumps from user reports

Pan Desktop configures Electron's `crashReporter` with `uploadToServer: false`
(see `src/main/index.ts` — Wave 7 landed the config), so every crash lands as
a local `.dmp` file. There is no backend; we ship zero telemetry by default.
When a user files a "Pan Desktop crashed" report, ask them to zip and send
the most recent `.dmp` from the directory corresponding to their OS:

- **Windows:** `%APPDATA%\Pan Desktop\crashes\reports\*.dmp`
- **macOS:** `~/Library/Application Support/Pan Desktop/crashes/reports/*.dmp`
- **Linux:** `~/.config/Pan Desktop/crashes/reports/*.dmp`

The path override is explicit — Pan Desktop calls
`app.setPath("crashDumps", <userData>/crashes)` before `crashReporter.start()`
so the directory is predictable across platforms. The fatal-error dialog that
Pan Desktop shows on main-process exceptions also prints the resolved path via
`formatCrashDumpHelp()`; users can paste it verbatim into a bug report.

### Forcing a crash for validation

The `PAN_DESKTOP_CRASH_ON_STARTUP=1` env var (wired in `src/main/index.ts`,
`maybeCrashForValidation()`) triggers `process.crash()` right after `whenReady`.
Use it to smoke-test the dump pipeline end-to-end without touching source:

```powershell
$env:PAN_DESKTOP_CRASH_ON_STARTUP = "1"
& "C:\Program Files\Pan Desktop\Pan Desktop.exe"
```

A new `.dmp` file should appear in the path above within a second or two.

### What to ask the user

Send the four-line template below in the bug-report thread:

1. Close Pan Desktop if it's still running.
2. Open `%APPDATA%\Pan Desktop\crashes\reports` in Explorer.
3. Zip the newest `.dmp` file.
4. Attach the zip to this bug report — don't worry, it only contains a
   stack trace, no personal data.

## Known warnings — Claw3D workspace root

**Ticket:** M1.1-#010
**Status:** Known issue. Not fixable from Pan Desktop's side. Requires an
upstream PR to `fathah/hermes-office` (Claw3D).

When Pan Desktop launches Claw3D, the first few lines of the streamed
dev-server logs in the Claw3D panel include this warning:

```
 ⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
 We detected multiple lockfiles and selected the directory of
 C:\Users\bertc\package-lock.json as the root directory.
 Consider adjusting `outputFileTracingRoot` or the `root` directory of your
 Turbopack config to the root of your application.
```

### Why it happens

Next.js walks up the filesystem looking for `package-lock.json` / `yarn.lock`
/ `pnpm-lock.yaml` files when it starts, and picks the **outermost** lockfile's
directory as the inferred workspace root. On Windows, if the user has any
stray `%USERPROFILE%\package-lock.json` — which is surprisingly common,
because various tools create one when you run `npm install` from the home
directory once — Next.js walks up from
`%APPDATA%\Roaming\.pan-desktop\hermes-office\` through `%USERPROFILE%\`
and lands on that stray file.

The result is a misleading "inferred workspace root" warning on every
Pan Desktop start. The warning is cosmetic — Claw3D still runs correctly —
but it is noisy and confusing for users triaging other issues.

### Why we can't fix it from Pan Desktop's side

The `outputFileTracingRoot` option (and its Turbopack sibling `turbopack.root`)
lives in Claw3D's own `next.config.js`. We verified during M1.1-#010
research that **there is no supported env var or CLI flag** to override
either option — Next.js reads both from the config module only, and there
is an explicit `wontfix` issue upstream ([vercel/next.js#82689](https://github.com/vercel/next.js/issues/82689))
rejecting a request to add one.

Pan Desktop's dev-server spawn already sets `NEXT_TELEMETRY_DISABLED=1` via
`buildHermesEnv` in `src/main/claw3d.ts` to reduce log noise, but that env
var is unrelated to the workspace-root warning and will not suppress it.

### User-side workaround

Until the upstream fix lands, users can suppress the warning themselves by
deleting any stray `%USERPROFILE%\package-lock.json` that doesn't belong to
another project. From PowerShell:

```powershell
# Check first — don't blindly delete if another project depends on it:
Get-Item $env:USERPROFILE\package-lock.json -ErrorAction SilentlyContinue

# If the file is truly stray (e.g. empty `{}` from a misplaced `npm install`),
# remove it:
Remove-Item $env:USERPROFILE\package-lock.json
```

### Proper fix (upstream)

The real fix is a 4-line change in Claw3D's `next.config.js`:

```js
const path = require('node:path');
module.exports = {
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // ...existing config...
};
```

A drafted upstream issue lives at
`hermes-desktop/docs/windows/CLAW3D_UPSTREAM_ISSUE_DRAFT.md`. When M1.1 lands
we will file it against `fathah/hermes-office` and link the resulting issue
here.
