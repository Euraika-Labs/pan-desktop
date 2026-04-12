# Pan Desktop — M1.1 Ticket List

This document tracks items consciously deferred from M1 to M1.1, each with
enough context that the M1.1 kickoff can pick them up without re-discovery.

Created: 2026-04-11 (as part of Wave 8 of the Windows readiness plan)
Referenced from: `docs/INDEX.md`, `docs/DECISIONS_M1.md`, `docs/WAVE_5_TO_9_PLAN.md` (Wave 8)

## Status (2026-04-12)

**M1.1 complete.** 10 of 10 original tickets resolved:
- 1 closed as won't-fix (M1.1-#001 code signing)
- 1 shipped as a Wave 5 bonus (M1.1-#007 remote model discovery)
- 3 shipped in MR !16 (M1.1-#004 crashpad, M1.1-#005 install.ps1 integrity
  check, M1.1-#006 asarUnpack cleanup)
- 5 shipped in MR !17 (M1.1-#002 auto-update feed, M1.1-#003 AUMID code +
  verification checklist, M1.1-#008 memory_tool.py overlay, M1.1-#009
  tool_context.py overlay, M1.1-#010 Claw3D workaround + upstream issue draft)

Pan Desktop is now preparing to tag **v0.0.1**: cut `release/v0.0.1` from
`develop`, merge to both `main` and `develop`, tag v0.0.1 on main, push tag
to trigger the Windows release pipeline on `windows-latest`.

Three small follow-up items from the code review are filed at the bottom of
this file as M1.1-#011, M1.1-#012, M1.1-#013. All are non-blocking for v0.0.1.

## M1.1 scope philosophy

M1 ships "honestly broken" — working installer, working runtime, visible SmartScreen
warning, manual updates. M1.1 closes the UX-polish gaps that don't affect correctness
but do affect trust and ergonomics. None of these items block M1 from shipping.

## Tickets

### M1.1-#001 — Code signing (gap #6) — **CLOSED: won't fix**

**Decision (2026-04-12):** Pan Desktop ships unsigned indefinitely. This
ticket is closed as a non-goal, not deferred. See DECISION_LOG.md
2026-04-12 entry for rationale.

**Original problem:** NSIS installer is unsigned. SmartScreen shows
"Unknown publisher" on every install. Users click "More info → Run anyway".

**Why we're not fixing it:**
- SSL.com OV + eSigner is $180/year recurring, 458-day max validity (mandatory annual renewal since 2026-02-27)
- 2023 HSM mandate killed the `.pfx` path — the existing runbook is obsolete
- EV certs no longer grant instant SmartScreen reputation since March 2024
- OV reputation takes 2-8 weeks of real-world downloads to accumulate regardless of cert type
- Azure Trusted Signing: Belgian entity not eligible
- SignPath Foundation (free for OSS): plausible but CN would be "SignPath Foundation"
  rather than "Euraika Labs", and reputation build is still 4-6 weeks
- The "click past SmartScreen" UX is acceptable for a pre-1.0 open source project
  with a small user base

**Reopen criteria:** Reconsider when (a) Pan Desktop has enough users that
SmartScreen friction is a meaningful adoption blocker, (b) Euraika Labs has
budget for recurring compliance costs, or (c) a free signing option with
Euraika-branded CN becomes available.

**Status:** Closed 2026-04-12. `hermes-desktop/docs/CERT_ACQUISITION_RUNBOOK.md`
marked archived. README.md has a permanent "Windows SmartScreen notice"
section explaining the dialog.

---

### M1.1-#002 — Auto-update feed URL (gap #7) — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !17, commit `566bc5e`

**Problem:** `electron-updater` is wired but the feed URL points at nothing real.
First auto-update check fails silently.

**Solution path:**
1. Publish update manifests (`latest.yml`, `beta.yml`) via GitLab Pages at a
   stable URL under `git.euraika.net/pan-desktop` Pages
2. Update `electron-builder.yml` `publish` block and `dev-app-update.yml`
   `generic` provider URL to match
3. Configure `.github/workflows/release.yml` to upload the `latest.yml` artifact
   to GitLab Pages on tag push
4. Verify auto-update works on a Windows VM by installing the previous version,
   publishing a new tag, and watching the auto-updater pick it up

**M1 workaround:** release notes tell users to download the new installer
manually from the release page.

**Permanent UAC caveat (2026-04-12):** With M1.1-#001 now closed as won't-fix,
auto-update on Windows will trigger a UAC prompt on every single update —
`electron-updater`'s `NsisUpdater` can only apply updates silently when the
new installer's Authenticode signature matches the currently-installed one.
Unsigned means the OS re-prompts every time. This is a permanent part of
Pan Desktop's Windows update UX until M1.1-#001 is reopened.

**Depends on:** Nothing blocks starting — but the UAC caveat above means the
feature is less useful than originally planned. Still worth shipping so users
get "new version available" notifications even if they have to click through
UAC to apply.

**Owner:** TBD

---

### M1.1-#003 — AUMID / taskbar grouping verification (gap #13) — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !17, commit `4ba8d23` (code review verified `appId` /
`setAppUserModelId` call site is correct; full VM verification checklist
landed as `hermes-desktop/docs/windows/AUMID_VERIFICATION.md` ready for the
real Windows 11 VM smoke test.)

**Problem:** Pan Desktop's AUMID is set in two places (`electron-builder.yml`
`appId: net.euraika.pandesktop` and `src/main/index.ts:825`'s
`setAppUserModelId`) but nobody has VERIFIED that Windows taskbar grouping,
pinning, jump lists, and toast notifications actually work correctly. This is
the #1 source of "pinned shortcut opens a second ungrouped taskbar icon" bugs
on Windows 11.

**Verification checklist (do this on a real Windows 11 VM, not WSL interop):**
1. Install Pan Desktop from the NSIS installer
2. Pin the shortcut to the taskbar
3. Click the pinned shortcut — verify only ONE taskbar button appears, not two
4. Run `Get-StartApps | Where-Object Name -like 'Pan*'` in PowerShell —
   verify the AppID column shows `net.euraika.pandesktop`
5. Send yourself a test notification (if the app supports it) — verify the
   app name shown is "Pan Desktop", not "Electron"
6. Right-click the taskbar entry — verify jump lists don't show anything weird
7. Uninstall via Settings → Apps — verify the taskbar pin is removed cleanly

**Fix-it steps (only if any of the above fails):**
- Ensure `appId` in electron-builder.yml exactly matches the runtime
  `app.setAppUserModelId()` string
- Ensure NSIS installer writes the correct shortcut with AUMID via
  `shortcutName` and implicit appId inheritance
- If pinning still breaks, investigate Electron's
  `app.setAppUserModelId()` timing — it must be called before any
  `BrowserWindow` is created

**Owner:** TBD — requires Windows VM access, not WSL interop

---

### M1.1-#004 — Uncaught exception handler bypasses Crashpad (Wave 8 review finding) — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !16, commit `cda5824`

**Problem:** `src/main/index.ts:117-126` handles `uncaughtException` by calling
`dialog.showErrorBox` + `process.exit(1)`. That's a clean exit, not a crash,
so no .dmp file is written. The most common failure class (uncaught exceptions)
leaves users with nothing to attach to a bug report, contradicting the
"collect crash dumps from user reports" flow documented in DEVELOPER_WORKFLOW.md.

**Solution path:**
1. Replace `process.exit(1)` with `app.exit(1)` and explicit log-file write, OR
2. Let the exception propagate so Crashpad captures a minidump
3. Add a test that deliberately throws in main startup and verifies a .dmp lands

**Found in:** Phase D code review of Wave 5-7. Filed 2026-04-11.
**Owner:** TBD

---

### M1.1-#005 — SHA256 integrity check for vendored install.ps1 (Wave 8 security finding) — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !16, commit `5126738`

**Problem:** `src/main/runtime/runtimeInstaller.ts` resolves `install.ps1` via
`existsSync` only. The script lives in per-user-writable app install dir. A
local attacker with user-level write access can swap the script between
launches. Risk constrained because the attacker already has user session
control, but worth defense-in-depth.

**Solution path:**
1. Compute SHA256 of `resources/install.ps1` at build time, embed as TypeScript
   constant in a new `resources/installPs1Hash.ts` file generated by the build
2. `WindowsInstallerStrategy.install()` verifies the hash before spawning pwsh
3. If mismatch, throw "install.ps1 integrity check failed — Pan Desktop build is corrupt"

**Related:** The vendored `install.ps1` itself internally pipes `irm ... | iex`
from astral.sh to install uv. Update the vendored script's header comment to
document this downstream network fetch so the supply-chain claim is accurate.
Consider switching to a pinned uv release download with checksum instead.

**Found in:** Phase D security audit of Wave 5-7. Filed 2026-04-11.
**Owner:** TBD

---

### M1.1-#006 — Dead `asarUnpack: resources/**` pattern (Wave 8 nit) — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !16, commit `2f77892`

**Problem:** `electron-builder.yml` has `asarUnpack: resources/**` but
`resources/install.ps1` ships via `extraResources` (lands in `process.resourcesPath`,
not inside the asar). The asarUnpack entry matches nothing in the asar itself.
Harmless but misleading — a future maintainer may assume the file is available
via `app.asar.unpacked/resources/install.ps1`.

**Solution:** Either drop the asarUnpack pattern, or move install.ps1 into the
asar and use asarUnpack as the sole delivery mechanism. Pick one.

**Found in:** Phase D code review. Low priority.
**Owner:** TBD

---

### M1.1-#007 — Fetch & pick remote models from OpenAI-compatible endpoints

**Problem:** After configuring a custom OpenAI-compatible endpoint, users have
no way to discover which models it hosts. `src/main/models.ts` is a static
seed file; `src/main/default-models.ts` hardcodes 3 entries for the 3 fixed
providers (OpenRouter/Anthropic/OpenAI). The Models screen and Setup screen
both treat model names as plain text input. No IPC handler calls `GET /v1/models`
from any endpoint, ever — not even the hardcoded providers benefit from
discovery.

**Solution path:**
1. Add main-process IPC handler `fetch-remote-models` in a new
   `src/main/remoteModels.ts`: takes `{baseUrl, apiKey}`, calls
   `GET ${baseUrl}/models` with `Authorization: Bearer ${apiKey}` when key
   provided. Parses the OpenAI-format response (`{data: [{id, owned_by, ...}]}`)
   and returns `string[]` of model IDs.
2. Add `window.hermesAPI.fetchRemoteModels` to the preload surface.
3. Setup screen: when "Custom OpenAI-compatible" is selected AND baseUrl has
   been typed, show a "Fetch available models" button next to the Model Name
   field. On success, replace the text input with a dropdown populated from
   the fetch. Fall back to text input if the endpoint returns nothing or errors.
4. Models screen: add an "Add from endpoint" button that opens a dialog
   asking for baseUrl + optional API key, fetches, and lets the user
   multi-select which models to save.
5. Save added models to `models.json` with `provider: custom` + the endpoint's
   baseUrl, so they appear in the chat model picker alongside seeded defaults.

**Out of scope (later):**
- Model capability metadata (context length, tool-use support, vision) —
  `/v1/models` doesn't expose it, would need per-provider feature flags
- Automatic refresh when user changes baseUrl
- Rate-limit / pagination handling for endpoints with huge model lists
- Validation that a given model actually works before saving

**Workaround today:** Users must type the exact model ID into Setup's
"Model Name" text field, or manually edit `~/.hermes/models.json` to add
entries with `{provider: "custom", model: "...", baseUrl: "..."}`.

**Found in:** 2026-04-11 Wave 5 validation session, flagged by user while
testing the new "Custom OpenAI-compatible" Setup card.
**Owner:** TBD
**Effort:** ~80 LOC main-process, ~40 LOC Setup UI, ~60 LOC Models screen dialog

---

### M1.1-#008 — Upstream Hermes Agent `memory_tool.py` fcntl guard (Wave 9 finding) — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !17, commit `8e25fee` (overlay mechanism + patched
`memory_tool.py` pinned to an upstream commit SHA, applied by
`WindowsInstallerStrategy` after `install.ps1` finishes.)

**Follow-up (non-blocking):** the overlay uses `msvcrt.locking()` for the
Windows fallback path but without a retry loop around `IOError` — a
contended lock will raise immediately. Hardening this into a short
bounded retry loop is filed as M1.1-#011.

**Problem:** `upstream tools/memory_tool.py:26` has an unguarded
`import fcntl` at module top. `fcntl` does not exist on Windows Python.
The first time a Hermes agent reads or writes persistent memory during
a chat, the import crashes the whole chat session. Upstream already
uses the correct cross-platform pattern in `cron/scheduler.py` (try
fcntl, fall back to msvcrt) and `hermes_cli/auth.py`. memory_tool.py
missed that treatment.

**Blast radius (Wave 9 verdict):** WARM path — doesn't affect boot or
basic chat round-trip, but breaks any agent flow that uses memory.
Given Pan Desktop's core value prop IS memory-enabled agents, this is
effectively a hard block on M1.1 for "real use", but not for a
one-shot chat smoke test.

**Solution path:**
1. Open an upstream PR mirroring the pattern in
   `cron/scheduler.py:19-27`:
   ```python
   try:
       import fcntl
       HAS_FCNTL = True
   except ImportError:
       fcntl = None
       HAS_FCNTL = False
       import msvcrt  # Windows fallback
   ```
   Then wrap `_file_lock()` / the `.lock` sidecar I/O with a Windows
   code path using `msvcrt.locking()`.
2. Until upstream merges, Pan Desktop ships a **post-install overlay**:
   after `install.ps1` finishes, `WindowsInstallerStrategy` copies a
   patched `memory_tool.py` from `resources/overlays/tools/memory_tool.py`
   to `%LOCALAPPDATA%\hermes\hermes-agent\tools\memory_tool.py`. Pin
   the overlay to a known upstream commit SHA so we can detect drift.
3. Once upstream PR lands, remove the overlay.

**Effort:** ~15 LOC upstream + ~30 LOC overlay plumbing in Pan Desktop.

**Found in:** Wave 9 investigation 2026-04-11.
**Owner:** TBD

---

### M1.1-#009 — Upstream Hermes Agent `/tmp` hardcode + AF_UNIX tools — **CLOSED / SHIPPED (partial, see correction)**

**Status:** Closed 2026-04-12
**Shipped in:** MR !17 (shipped via the same overlay mechanism as
M1.1-#008; `tool_context.py` lands in
`resources/overlays/environments/tool_context.py`.)

**Wave 9 research correction (2026-04-12):** The final M1.1 swarm
caught two errors in the original Wave 9 writeup below:

1. **`browser_tool.py` AF_UNIX claim was wrong.** There is **no AF_UNIX
   in `browser_tool.py`** — the Python code just shells out to the
   external `agent-browser` binary, and the AF_UNIX socket lives inside
   that Go/Rust binary. Pan Desktop cannot fix this from a Python
   overlay; it requires upstream `agent-browser` to add Windows
   support. This is out of scope for the M1.1 overlay layer and has
   been filed separately as **M1.1-#013 — browser_tool.py on Windows**
   (blocked on upstream agent-browser binary).

2. **The original `tempfile.gettempdir()` fix proposed for
   `tool_context.py` was wrong.** The sandbox runs on Linux even when
   Pan Desktop is driving it from a Windows host, so calling
   `tempfile.gettempdir()` on the host would return a Windows path
   (`C:\Users\...\Temp\...`) that does not exist inside the sandbox.
   The shipped overlay keeps the literal `/tmp/_hermes_upload.b64`
   path — the bug was never about Windows tempdir conventions, it
   was about the upstream file having the path embedded in a
   confusing place.

**Original problem (preserved for reference):** Three additional
Unix-only patterns found in Wave 9:

1. **`environments/tool_context.py:195`** — `"/tmp/_hermes_upload.b64"`
   hardcoded. Breaks file upload during chat on Windows. 1-line fix
   with `tempfile.gettempdir()`.
2. **`tools/code_execution_tool.py:217, 968`** — AF_UNIX socket for
   sandboxed code execution IPC. Windows 10 1803+ has AF_UNIX but
   path semantics differ; the code as written will not work.
3. **`tools/browser_tool.py:368`** — AF_UNIX socket for agent-browser
   control channel. Same issue.

**Blast radius:**
- #1: WARM — breaks chat uploads
- #2: WARM — breaks the code execution tool (Pan Desktop can mark the
  tool "unavailable on Windows" in M1)
- #3: WARM — breaks browser tool similarly

**Solution path:**
1. For #1 (`/tmp` hardcode): 1-line upstream PR, trivial
2. For #2 and #3 (AF_UNIX): upstream rewrite to use TCP loopback or
   Windows named pipes (`\\.\pipe\hermes-code`); non-trivial ~50-100
   LOC each. In the meantime, Pan Desktop M1 ships with these two
   tools disabled on Windows via a platform flag in `config.yaml`.

**Effort:** 1 LOC upstream for #1; 50-100 LOC each upstream for #2/#3;
maybe 20 LOC Pan Desktop flag to disable them on Windows in M1.

**Found in:** Wave 9 investigation 2026-04-11.
**Owner:** TBD

---

### M1.1-#010 — Cosmetic: Pan Desktop should clean up stray Claude Code workspace lockfile — **CLOSED / SHIPPED**

**Status:** Closed 2026-04-12
**Shipped in:** MR !17, commit `4ba8d23` (local workaround landed in
`hermes-desktop/docs/windows/` as a DEVELOPER_WORKFLOW.md note; an
upstream issue report is drafted and ready to file at
`hermes-desktop/docs/windows/CLAW3D_UPSTREAM_ISSUE_DRAFT.md`.)

**Problem:** Next.js in Claw3D warns about multiple `package-lock.json`
files and picks `C:\Users\bertc\package-lock.json` as the workspace
root because it walks up from the Claw3D dir looking for lockfiles.
The stray lockfile at `C:\Users\bertc\package-lock.json` is unrelated
to Pan Desktop and probably left from a prior rebrand test — it
shouldn't be there.

**Solution path:**
1. Document in DEVELOPER_WORKFLOW.md that the `%USERPROFILE%\package-lock.json`
   stray causes Next.js workspace-root confusion for Claw3D
2. OR: set `outputFileTracingRoot` in Claw3D's `next.config.js` to
   explicitly pin the workspace root to the Claw3D directory itself.
   This is an upstream Claw3D change.

**Blast radius:** COSMETIC — just a warning, doesn't break anything.

**Found in:** 2026-04-11 Phase E validation.
**Owner:** TBD

---

## Post-M1.1 follow-ups (non-blocking for v0.0.1)

The following tickets were filed during the MR !17 code review swarm on
2026-04-12. None of them block tagging v0.0.1; all three are quality
improvements on top of the shipped overlays and tests.

### M1.1-#011 — msvcrt.locking retry loop hardening in memory_tool.py overlay

**Problem:** The Windows fallback path in the shipped
`resources/overlays/tools/memory_tool.py` overlay calls
`msvcrt.locking(fd, msvcrt.LK_NBLCK, ...)` but without a bounded retry
loop. Unlike `fcntl.flock()` on Unix (which offers `LOCK_EX | LOCK_NB`
plus natural blocking semantics), `msvcrt.locking()` with `LK_NBLCK`
raises `OSError` immediately on any contention. A user running two
Hermes chat sessions that both touch memory at the same instant will
see a hard failure on one of them instead of a brief wait.

**Solution path:**
1. Wrap the `msvcrt.locking()` call in a retry loop: try `LK_NBLCK`,
   catch `OSError`, sleep 50ms with small exponential backoff, retry
   up to ~2 seconds total before giving up
2. Match the timing profile of `fcntl.flock(LOCK_EX)` on Linux (which
   blocks indefinitely by default, but a 2s cap is a reasonable
   Windows compromise)
3. Bump the overlay's pinned-upstream-SHA header comment since this
   diverges from upstream

**Blast radius:** EDGE CASE. Most users run a single Hermes chat
session at a time, so the race window rarely opens. But the failure
mode is a hard crash that users can't interpret, which is worse than
a 50ms pause.

**Effort:** ~20 LOC in the overlay, zero plumbing changes.

**Found in:** MR !17 code review (non-blocking).
**Owner:** TBD

---

### M1.1-#012 — overlayApplicator.test.ts coverage gaps

**Problem:** The `overlayApplicator.test.ts` suite that landed with
M1.1-#008 / M1.1-#009 in MR !17 covers the happy path (apply overlays,
skip when manifest matches, re-apply when manifest drifts) but misses
four edge cases the reviewer flagged:

1. **Missing manifest file** — overlayApplicator should treat "no
   manifest exists yet" as "apply all overlays fresh", but the test
   suite doesn't assert this path exists
2. **Malformed manifest JSON** — a corrupt or partial manifest file
   should not crash the installer; it should fall back to re-applying
   all overlays
3. **`schemaVersion` mismatch** — the manifest schema version field is
   read but the test suite doesn't cover the "future schema we don't
   understand" fallback case
4. **Mid-rename failure recovery** — if the installer crashes after
   renaming the target file but before writing the manifest, the next
   launch should be idempotent, not leave a corrupted install

**Solution path:** Add four targeted test cases in
`tests/overlayApplicator.test.ts`. All four are straightforward
fs-mocking exercises.

**Effort:** ~60 LOC test code, no production changes.

**Found in:** MR !17 code review (non-blocking).
**Owner:** TBD

---

### M1.1-#013 — browser_tool.py on Windows

**Problem:** `tools/browser_tool.py` in the upstream Hermes Agent
shells out to an external `agent-browser` binary for its core browser
automation. The AF_UNIX socket originally blamed on `browser_tool.py`
in the Wave 9 writeup actually lives inside that external binary, not
in the Python wrapper. **Pan Desktop cannot fix this from the Python
overlay layer** — the overlay mechanism only patches Python files, and
the upstream `agent-browser` binary currently has no Windows build.

**Solution path:** Out of Pan Desktop's hands. The fix must land
upstream in `agent-browser`:
1. Upstream adds Windows support to `agent-browser` (either a Windows
   port of the AF_UNIX IPC, or a switch to TCP loopback / Windows
   named pipes for the control channel)
2. Upstream publishes Windows binaries for the new `agent-browser`
3. Upstream Hermes Agent's `install.sh` / `install.ps1` picks up the
   Windows binary during install
4. Pan Desktop removes the "browser tool unavailable on Windows"
   platform flag from `config.yaml`

**Current M1.1 behavior:** Pan Desktop ships with the browser tool
disabled on Windows via a platform flag in `config.yaml`. Chat flows
that try to use it get a clean "not available on this platform"
message rather than a crash.

**Blast radius:** Feature gap — users can chat, run memory-enabled
agents, and execute most tools, but not the browser automation tool.

**Blocked on:** Upstream `agent-browser` Windows support. No timeline.

**Found in:** Wave 9 investigation + MR !17 swarm correction. The
original Wave 9 writeup mis-attributed the AF_UNIX socket to
`browser_tool.py` itself.

**Owner:** Upstream agent-browser maintainers (Pan Desktop will file
issue if not already tracked).
