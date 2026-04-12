# Waves 5–9 — M1 Windows Readiness Plan

Author: 2026-04-11
Status: proposed — awaiting decisions D1–D3 before work begins
Supersedes: nothing; extends `REFACTOR_ORDER_AND_WAVES.md` past Wave 4

## Goal

Close every gap between "Pan Desktop compiles clean on Windows" (Wave 4 exit)
and "Pan Desktop actually works end-to-end on a vanilla Windows 11 machine"
(M1 ship). The end-to-end smoke test performed on 2026-04-11 via WSL interop
proved Waves 1–4 are structurally correct but surfaced 13 concrete gaps that
must be closed or consciously deferred before M1 can be called honest.

## Current state (validated on 2026-04-11)

- Wave 1–4 refactor is merged and structurally sound: platform adapter, process
  runner, runtime paths, desktop paths, runtime installer strategies, runtime
  update service, runtime manifest, Windows smoke harness, cert runbook.
- `pan-desktop.exe` launches on a real Windows 11 host (via WSL interop, using
  `dist/win-unpacked/`), reaches the splash screen, renders the Welcome screen
  with correct Windows-specific copy.
- `getInstallInstructions()` returns `supported: false` on Windows and the
  Welcome screen shows an "I've installed it — check again" button that loops
  back through `checkInstall()` — working as designed.
- Everything below this line is either broken, never exercised, or deliberately
  deferred from Wave 4.

### Gap inventory

Severity taxonomy: 🔴 hard blocker, 🟠 known and documented (deferral
candidate), 🟡 untested/unknown.

| # | Sev | Gap | Why it matters |
|---|---|---|---|
| 1 | 🔴 | `$HOME/.hermes` vs `%LOCALAPPDATA%\hermes` mismatch | Installer writes to one path, runtimePaths reads the other → "installed but not detected" |
| 2 | 🔴 | `runtime.hermesCli` resolves to a bash wrapper script | `processRunner.run(hermesCli, …)` fails on cmd.exe — blocks every CLI call |
| 3 | 🔴 | No Python3 preflight on Windows | Upstream `install.sh` dies with "python3 not found" — unactionable error |
| 4 | 🔴 | `npmRebuild: false` + `better-sqlite3` native binary | Linux-built `.node` in `dist/win-unpacked/`; first DB write throws |
| 5 | 🔴 | Real NSIS installer never exercised | CI produces it, nobody has launched it — could fail at install time |
| 6 | 🟠 | Code signing / SmartScreen | Runbook exists, no cert — "Unknown publisher" on every install |
| 7 | 🟠 | Auto-update on Windows | Feed URL points at nothing — silent update failures |
| 8 | 🟠 | `WindowsInstallerStrategy.install()` throws | Cop-out from Wave 4; user told to open Git Bash themselves |
| 9 | 🟡 | `app.requestSingleInstanceLock()` not called | Second launch stomps the first's sqlite db |
| 10 | 🟡 | Upstream Hermes Agent on Windows — reality unknown | Python side may hit `fcntl`/`os.fork`/signal bugs regardless of install success |
| 11 | 🟡 | 260-char path limit | Deep venv `site-packages` paths routinely exceed — pip install fails mid-flight |
| 12 | 🟡 | No crash reporting | First-launch crashes on user machines are invisible to us |
| 13 | 🟡 | AUMID / taskbar pinning not verified | Multiple icons, broken shortcut on pin — minor but user-visible |

## Target state

A clean Windows 11 host with no Hermes Agent, no Python, and no Git for Windows
can:

1. Download `pan-desktop-<version>-setup.exe` from a release URL
2. Double-click → SmartScreen warning (M1) → proceed → NSIS installer runs
3. Pan Desktop launches, splash shows "Pan Desktop", Welcome screen detects
   missing prerequisites and shows an actionable install button
4. Install button triggers the real install flow (Git Bash subprocess invoking
   `install.sh`), streams output to the Install screen
5. On success, Pan Desktop routes to Setup → Main
6. Chat round-trip works (proves `state.db` loads, Python side runs, IPC is
   healthy)
7. Closing and reopening Pan Desktop shows Main immediately (single-instance
   lock holds, state persists)
8. If the app crashes, a dump lands somewhere we can find

Everything M1.1 (real signing, auto-update, native installer without Git Bash)
is explicitly out of scope.

## Wave structure

Each wave ends with a validation gate. No wave is "done" until its gate passes
on a real Windows host (WSL interop is acceptable for 5–7; waves 8–9 require a
full VM or download-and-run).

### Wave 5 — Windows install enablement

**Goal:** Gaps #1, #2, #3, #8 — make the Install button actually install.

**Touch list:**
- `src/main/platform/platformAdapter.ts` — add `detectGitBash()` (checks
  `C:\Program Files\Git\bin\bash.exe`, `Program Files (x86)`, `where bash`), add
  `detectPython()` (filters out MS Store redirector stubs by size check).
- `src/main/runtime/runtimeInstaller.ts` — rewrite `WindowsInstallerStrategy`:
  - Bail with actionable error if Git Bash missing → Welcome shows "Install Git
    for Windows" manual step (this is the one manual step M1 accepts, unlike
    the current full manual install)
  - Bail with actionable error if Python missing → Welcome shows "Install
    Python 3.11+ from python.org"
  - Otherwise: spawn `bash.exe -lc "<install cmd>"` via `processRunner`, stream
    stdout/stderr to the Install screen
  - Pass `HERMES_HOME` env pointing at the resolved `runtime.hermesHome`. If
    upstream installer ignores it (see D1), fall back to the runtimePaths-side
    fix.
- `src/main/runtime/runtimePaths.ts` — `resolveHermesCli` on Windows returns
  **a tuple** of `{ command, args }` so callers can invoke `python -m hermes`
  directly instead of going through the bash wrapper. OR wraps through bash.
  Chosen path depends on D1 (see Open decisions).
- `src/main/installer.ts::getInstallInstructions()` — return `supported: true`
  on Windows **when Git Bash is detected**; keep the current `supported: false`
  message when it is not, but with the new prerequisite-focused copy.
- `src/renderer/src/screens/Welcome/Welcome.tsx` — no changes expected; the
  branch logic already handles both states correctly.
- `src/renderer/src/screens/Install/Install.tsx` — verify it renders the
  streamed output cleanly for the Windows invocation (should already work,
  since processRunner's streaming API is platform-agnostic).

**Validation gate (5G):**
- On the 2026-04-11 WSL interop host: launch Pan Desktop, click Install,
  watch Hermes Agent install into `C:\Users\bertc\.hermes\hermes-agent`
  (or `%LOCALAPPDATA%\hermes` depending on D1), land on Setup screen.
- `runtime.hermesCli` invocation succeeds (`getHermesVersion()` returns a real
  string, not null).

### Wave 6 — Native packaging correctness

**Goal:** Gaps #4, #5, #9, #11 — the build we ship must actually work.

**Touch list:**
- `electron-builder.yml`:
  - Flip `npmRebuild` to `true` (see D2)
  - Add `win.requestedExecutionLevel: asInvoker`
  - Add app manifest with `<longPathAware xmlns="…">true</longPathAware>`
  - Verify `nsis.oneClick: false`, `perMachine: false` (per-user install to
    `%LOCALAPPDATA%\Programs\Pan Desktop` — this is what we tested)
- `.github/workflows/release.yml`:
  - Windows NSIS build runs only on `windows-latest` (required once npmRebuild
    is true — we cannot cross-build native modules reliably)
  - Upload `pan-desktop-*-setup.exe` as a release artifact
  - Block merge to main on Windows job failure
- `src/main/index.ts`:
  - Call `app.requestSingleInstanceLock()` at top of main entry; on failure,
    `app.quit()`. Wire `second-instance` event to focus the existing window.
- `package.json`:
  - Pin `better-sqlite3` to a version with prebuilt Windows Electron binaries
    OR confirm `@electron/rebuild` rebuilds cleanly in CI.
- `tests/windows-smoke/checklist.md`:
  - Add "open chat, send 1 message" as the state.db regression check

**Validation gate (6G):**
- Download the CI-produced `pan-desktop-*-setup.exe` from a GitHub Actions run
- Run it on a clean Windows 11 VM via `smoke-test.ps1`
- Install succeeds, launches, chat round-trip works, closing and reopening
  does not double-launch, `state.db` is preserved.
- Smoke test passes all automated checks.

### Wave 7 — Operational safety

**Goal:** Gap #12 — when M1 users hit a first-launch crash we can learn from
it.

**Touch list:**
- `src/main/index.ts`:
  - Call `crashReporter.start()` with `submitURL` left undefined and
    `uploadToServer: false` — this enables local dump capture without requiring
    Sentry or any backend
  - Log the crashes directory once at startup so users can find it
- `src/main/utils.ts` (or a new `src/main/crashReports.ts`):
  - Helper to surface `app.getPath('crashDumps')` in a user-visible error
    screen if we ever hit a main-process exception before the window opens
- Document in `docs/DEVELOPER_WORKFLOW.md` how to collect a crash dump from a
  user report.

**Validation gate (7G):**
- Deliberately throw in `main` process startup path behind a dev flag
- Confirm a `.dmp` or minidump file lands in `app.getPath('crashDumps')` on
  Windows
- Revert the flag, confirm no dumps are created in normal operation.

### Wave 8 — M1.1 deferrals (document, don't fix)

**Goal:** Gaps #6, #7, #13 — deferred consciously, not forgotten.

**Touch list:**
- `docs/OPEN_QUESTIONS.md` — add a "Deferred to M1.1" section with one entry
  per gap, each linking to its ticket or runbook.
- `docs/DECISION_LOG.md` — log the decision to defer with rationale (cert lead
  time, update infra cost, low-severity UX polish).
- `docs/DECISIONS_M1.md` — update the "explicit non-goals" section to name
  these three by number.
- Create tracking issues on GitLab for M1.1 scope.

**Validation gate (8G):**
- None — documentation-only wave. Gate is "M1.1 ticket list exists and is
  linked from INDEX.md".

### Wave 9 — Upstream reality check

**Goal:** Gap #10 — does the Python side of Hermes Agent actually run on
Windows, and if not, what's our fallback?

**Touch list:** depends entirely on what breaks. Expected investigation order:
- Install Hermes Agent on a Windows VM via the Wave 5 flow
- Attempt `hermes doctor`, `hermes chat --once`, profile create, skill sync
- Document every failure with: (a) symptom, (b) upstream file/line, (c) blast
  radius, (d) patch complexity
- Decide per-failure: (i) patch locally in Pan Desktop's clone, (ii) file
  upstream PR, (iii) declare "not M1-supported" and gate the feature behind a
  platform check

**Validation gate (9G):**
- Chat round-trip works on a clean Windows install, or every failure mode is
  documented with a deferral plan.
- If wave 9 surfaces a showstopper (e.g., upstream Python assumes Unix sockets
  throughout), this wave escalates to a go/no-go meeting rather than more
  refactoring.

## Open decisions (D1–D3) — need answers before Wave 5 starts

### D1 — `$HOME` vs `%LOCALAPPDATA%` resolution

Two options:

**D1a — set `HERMES_HOME` when invoking bash** (preferred, pending upstream
check):
- Pan Desktop exports `HERMES_HOME=C:\Users\<user>\AppData\Local\hermes` before
  spawning `bash.exe`
- Upstream `install.sh` respects it → installs where runtimePaths expects
- If upstream ignores it, we either patch upstream or fall back to D1b

**D1b — teach runtimePaths to prefer `$HOME/.hermes` on Windows**:
- `resolveHermesHome` checks Git Bash's `$HOME` (typically `C:\Users\<user>`)
  before `%LOCALAPPDATA%`
- Matches upstream installer behavior exactly
- Cost: conflicts with "follow Windows conventions" principle; `$HOME` is not
  where Windows apps store data

**Recommendation:** D1a. It's cleaner and respects the architecture invariant.
Validation: `rg HERMES_HOME` in the upstream Hermes Agent repo (one grep,
five minutes) decides this before Wave 5 touches any code.

### D2 — `better-sqlite3` rebuild strategy

Two options:

**D2a — flip `npmRebuild: true` + restrict Windows builds to windows-latest CI**
- Simple, one-line config change
- Forces us to give up cross-building on Linux (which already doesn't work
  cleanly, so this is mostly formalizing reality)
- CI already has windows-latest runner per Wave 0.5

**D2b — add explicit `@electron/rebuild` step in the CI workflow**
- More portable (could rebuild for multiple Electron versions in one build)
- More moving parts, more CI maintenance
- No benefit unless we start multi-targeting Electron versions

**Recommendation:** D2a. Wave 0.5 already established windows-latest as the
canonical Windows build runner; this codifies it.

### D3 — Wave 9 blast-radius tolerance

If upstream Python refuses to run on Windows, what's the fallback?

**D3a — fork and patch upstream locally**
- Fastest ship
- Creates a Pan Desktop maintenance burden on Hermes Agent Python code (we
  explicitly wanted to avoid this per the hard-fork decision)

**D3b — contribute upstream and wait**
- Aligned with upstream project health
- M1 ship date becomes dependent on upstream review cycles (unbounded)

**D3c — pivot M1 to Linux/macOS only, relabel Windows as M2**
- Honest about what we can ship on our own timeline
- Eliminates the "unknown unknowns" risk
- Cost: the whole point of this refactor was the Windows port

**Recommendation:** D3 is a judgment call the maintainer has to make. My
instinct is **D3a for anything the patch is <100 lines, D3c for anything
bigger**, with D3b as an always-on parallel track (file the PR regardless).
This needs an explicit decision before Wave 9 starts — I can't make it.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Upstream installer doesn't respect `HERMES_HOME` | Medium | Wave 5 | 5-min grep check before writing code |
| `better-sqlite3` has no prebuilt binary for our Electron version | Low | Wave 6 | Pin to a known-good version, test in CI before merging |
| NSIS installer fails on a vanilla VM (not just WSL interop) | Medium | Wave 6 | That's exactly what the smoke harness exists for |
| Upstream Python has deep Unix assumptions | Medium | Wave 9 | D3 pre-commits a decision framework |
| Code signing cert acquisition blocks M1 ship | High | Wave 8 | Already deferred; runbook exists; OV cert lead time tracked |
| WSL interop hides Windows-specific bugs | Medium | Wave 6/9 | Gate 6G and 9G explicitly require non-WSL VM |
| Wave 5 touches too many files at once and breaks Wave 1–4 invariants | Low | Wave 5 | ESLint rules (no-restricted-imports, no-restricted-syntax) already prevent the worst cases; code-reviewer agent catches the rest |

## Validation strategy

Every wave's gate is a real-user scenario, not a unit test pass:

- 5G → click Install, watch it work, reach Setup screen
- 6G → download CI artifact, run NSIS installer on a clean VM, open chat
- 7G → deliberately crash, find the dump, feel good about it
- 8G → docs-only gate, M1.1 ticket list exists
- 9G → chat round-trip on Windows, or documented failures with deferrals

Unit tests continue to run on every PR via the Wave 0.5 CI matrix; they're
table stakes, not validation gates.

## Effort estimate

| Wave | Focused work | Elapsed (incl. CI, review cycles) |
|---|---|---|
| 5 | 4–6 h | 1–2 days |
| 6 | 3–4 h | 1 day |
| 7 | 1 h | Half day |
| 8 | 1 h | Half day |
| 9 | 2–4 h open-ended | 1–3 days (blocked on D3) |

Total focused: ~11–16 h. Total elapsed: 4–7 days assuming no upstream
showstoppers in Wave 9.

## Out of scope

Anything not listed in the gap inventory. Specifically:

- Real native Windows installer (no Git Bash dependency) — M1.1
- Bundled Python runtime — M1.1 or later
- Multi-profile Windows support (`%APPDATA%\Pan Desktop\profiles\*`) — works
  today via `desktopPaths.ts`, not touched here
- EV or OV code signing cert acquisition — parallel track per runbook
- Hermes Agent Python code modifications for Windows compatibility — Wave 9
  decides per-failure
- Marketing site, download page, release announcement — M1 ship comms

## Exit criteria for "M1 ready to announce"

1. Waves 5, 6, 7 merged and tagged
2. Wave 8 tickets exist and are linked from INDEX.md
3. Wave 9 either passes or has a documented deferral plan with explicit
   user-visible behavior for each failure mode
4. `smoke-test.ps1` passes on a clean Windows 11 VM running the real NSIS
   installer from CI
5. A human can: download the installer, run it, reach the Main screen, send
   one chat message, close and reopen the app, without consulting any
   documentation other than the SmartScreen "More info → Run anyway" step

Nothing in this list requires a signed binary — that's M1.1. M1 ships
honestly with the SmartScreen warning and a README note that explains it.

---

## Wave 9 results (2026-04-11)

Executed as a read-only scan of the Windows-installed upstream Hermes
Agent at `%LOCALAPPDATA%\hermes\hermes-agent\` plus live runtime probes
via `hermes.exe` subcommands. Full report preserved in session notes.

### Verdict: **Ship M1**

Upstream Python side already runs on Windows. Runtime probe evidence:

- `hermes.exe --version` → exit 0, returns "Hermes Agent v0.8.0"
- `hermes.exe --help` → exit 0, clean subcommand listing
- `hermes.exe doctor` → exit 0 (with `PYTHONIOENCODING=utf-8`)
- `hermes.exe gateway status` → exit 0 (with `PYTHONIOENCODING=utf-8`)
- `hermes.exe gateway run` → reaches steady state, logs normal
  "no platforms enabled" warning, no stack trace

The upstream team is already Windows-aware — systemd/launchd code,
signal handling, cron scheduler file locks, and auth store locks all
have proper `hasattr`/`try-except-msvcrt-fallback` guards. Only the
pieces they missed need addressing:

1. **cp1252 UnicodeEncodeError on CLI glyphs** — fixed in Pan Desktop
   by setting `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` in
   `buildHermesEnv()` on Windows. Zero upstream changes.
   **Landed in this wave.**
2. **`tools/memory_tool.py` unguarded fcntl** — 15 LOC upstream patch,
   same pattern as `cron/scheduler.py` already has. Pan Desktop will
   ship a post-install overlay until upstream merges. Tracked as
   M1.1-#008.
3. **`environments/tool_context.py:195` `/tmp` hardcode** — 1 LOC
   upstream patch. Tracked as M1.1-#009.
4. **AF_UNIX in `code_execution_tool.py` and `browser_tool.py`** —
   warm but not on chat round-trip critical path. M1 ships with these
   two tools flagged "unavailable on Windows". Tracked as M1.1-#009.

Everything else the Wave 9 scan flagged was either already guarded
or cold-path (systemd/launchd helpers, upstream uninstall hooks).

### D3 decision

**D3a with D3b follow-up** — Pan Desktop overlays the 2 Windows-unfriendly
upstream files post-install, then opens upstream PRs to eliminate the
overlay long-term. No fork, no pivot, no multi-week blocker.

---

## All waves complete (2026-04-12)

Every wave in this plan is now shipped on `develop` via three merge
requests:

| Wave | MR | Commit highlights |
|---|---|---|
| Wave 5 — Windows install enablement | MR !15 (initial) + MR !16 (final bundle) | Gaps #1, #2, #3, #8 closed; Git Bash + Python preflight + `install.ps1` path; bonus: M1.1-#007 remote model discovery landed here |
| Wave 6 — Native packaging correctness | MR !16 | Gaps #4, #5, #9, #11 closed; `npmRebuild: true`, single-instance lock, long-path-aware manifest |
| Wave 7 — Operational safety (crash reporting) | MR !16 | Gap #12 closed; `crashReporter.start()` wired; M1.1-#004 uncaught-exception fix |
| Wave 8 — M1.1 deferrals | MR !16 (docs) + MR !17 (status flip) | Q15 closed won't-fix; Q16 and Q17 shipped in M1.1 instead of deferred; docs updated |
| Wave 9 — Upstream reality check | MR !15 (research) + MR !17 (M1.1-final: overlays + auto-update + AUMID + Claw3D) | Gap #10 closed; `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` landed in Wave 9; overlay mechanism for `memory_tool.py` + `tool_context.py` landed in MR !17 |

Two Wave 9 research errors were caught and corrected by the final M1.1
swarm on 2026-04-12 — both documented in full on the corresponding
M1.1 tickets but worth recording here for the historical record:

1. **`browser_tool.py` AF_UNIX claim was wrong.** The Wave 9 scan
   attributed an AF_UNIX socket to `tools/browser_tool.py` itself.
   That was incorrect — there is no AF_UNIX in the Python file. The
   AF_UNIX socket lives in the external `agent-browser` binary that
   `browser_tool.py` shells out to. Pan Desktop cannot fix this via
   the Python overlay layer because the overlay only patches Python
   files, and the upstream `agent-browser` binary has no Windows
   build. Filed as **M1.1-#013 — browser_tool.py on Windows**
   (blocked on upstream agent-browser Windows support).

2. **`tempfile.gettempdir()` fix for `tool_context.py` was wrong.**
   The Wave 9 writeup proposed replacing `/tmp/_hermes_upload.b64`
   with `tempfile.gettempdir()`, which would resolve to the host
   Windows temp directory. But the sandbox where this path is used
   runs on **Linux** even when Pan Desktop drives it from a Windows
   host, so a Windows path from `gettempdir()` would be meaningless
   inside the sandbox. The shipped overlay keeps the literal `/tmp`
   path — the real bug was just the path being embedded in a
   confusing place, not a Windows tempdir convention mismatch.

Pan Desktop is now preparing to tag v0.0.1. See DECISION_LOG.md
2026-04-12.
