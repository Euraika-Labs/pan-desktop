# Pan Desktop — Windows smoke test checklist

A structured checklist for a human tester to walk through a Pan Desktop
Windows install. Complements `smoke-test.ps1` which automates the
install/launch mechanics. This file is the manual verification layer —
things a PowerShell script can't check (UI rendering, user experience,
obvious visual regressions).

Copy this into an issue / comment and tick items as you go.

## Session info

- Tester: __________________________
- Date: ____________________________
- Windows version (`winver`): ______
- Architecture (x64 / ARM64): ______
- Installer artifact: ______________
- Git SHA: _________________________
- Time to complete: ________________

## Pre-install (clean VM)

- [ ] VM is a fresh or reset Windows 10/11 image (NOT a dirty machine
      with a prior Pan Desktop install lingering)
- [ ] Git for Windows is installed (`git --version` in Command Prompt)
- [ ] PowerShell 7+ is available (`pwsh --version`)
- [ ] Windows Defender is enabled (default state; we want to see real
      SmartScreen behavior, not a disabled-AV result)
- [ ] Network access is working (`ping github.com`)

## Phase 1 — NSIS installer

- [ ] Double-click `pan-desktop-*-setup.exe`
- [ ] **Expected:** Windows SmartScreen warning appears
      ("Windows protected your PC — Unknown publisher")
  - [ ] Record EXACT message text
  - [ ] Click `More info`
  - [ ] Click `Run anyway`
- [ ] **Expected:** Possibly a UAC prompt depending on install location
- [ ] NSIS installer UI appears
  - [ ] Title says "Pan Desktop Setup" (NOT "Hermes Agent Setup")
  - [ ] License page shows MIT + Euraika Labs + fathah attribution
  - [ ] Install location defaults to `%LOCALAPPDATA%\Programs\Pan Desktop`
- [ ] Install completes without errors
- [ ] Desktop shortcut created (check the desktop)
- [ ] Start Menu entry exists under `Pan Desktop`
- [ ] `%LOCALAPPDATA%\Programs\Pan Desktop\Pan Desktop.exe` exists on disk

## Phase 2 — First launch

- [ ] Launch Pan Desktop (from desktop shortcut or Start Menu)
- [ ] **Expected:** Electron window opens within ~3 seconds
  - [ ] Window title shows "Pan Desktop"
  - [ ] Taskbar icon shows the Pan Desktop icon
  - [ ] No native crash dialogs
  - [ ] No red console output in DevTools (open with Ctrl+Shift+I)
- [ ] **Expected:** Welcome screen appears (Hermes Agent is not yet installed)
  - [ ] Heading says "Install Hermes Agent on Windows" (not the Unix heading)
  - [ ] Body text mentions Git Bash / WSL manual install
  - [ ] **NO** `curl | bash` command displayed (that's the Unix-only path)
  - [ ] "Get Started" button is either hidden or disabled on Windows
        (because `supported: false` on Windows)
- [ ] Check DevTools Console for uncaught errors / warnings
  - [ ] Paste any errors into the report

## Phase 3 — Manual Hermes Agent install (via Git Bash)

This is the M1 workaround for Windows. The installer script is bash-only
and Pan Desktop punts to Git Bash until Wave 5.

- [ ] Open Git Bash (Start Menu → Git → Git Bash)
- [ ] Run:
      ```bash
      curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
      ```
- [ ] **Expected:** installer downloads uv, Python, clones hermes-agent,
      builds a venv, installs deps, exits 0
- [ ] Verify Hermes Agent files exist:
      - `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe`
      - `%LOCALAPPDATA%\hermes\hermes-agent\hermes` (or `.exe` / `.cmd`)
- [ ] Switch back to Pan Desktop window
- [ ] Click "I've installed it — check again"
- [ ] **Expected:** Pan Desktop transitions from Welcome to the main
      workspace (Chat / Sessions / etc.)

**If the "Check again" button doesn't pick up the install:**
- [ ] Check that `runtime.hermesCli` resolves correctly on Windows by
      inspecting DevTools (Main process console in Electron)
- [ ] Verify the `.exe`/`.cmd` extension resolution actually walks the
      candidate list — see `runtime/runtimePaths.ts::resolveHermesCli`
- [ ] This is the most likely place for Wave 4 bugs to surface

## Phase 4 — Basic chat flow

- [ ] Navigate to Settings
- [ ] Configure a provider (OpenRouter recommended for testing — cheapest)
      - [ ] Paste an API key
      - [ ] Select a cheap model (e.g. `openrouter/auto`)
      - [ ] Save
- [ ] Navigate to Chat
- [ ] Send a simple message: `"Hello, respond with one word."`
- [ ] **Expected:** response streams into the chat UI within 5 seconds
- [ ] If the chat works:
  - [ ] **This is the first end-to-end Pan Desktop success on Windows.**
  - [ ] Record this as a win in the MR comment

**If chat fails:**
- [ ] Check DevTools Main process logs for the spawn call
- [ ] Verify `runtime.pythonExe` resolves to `venv\Scripts\python.exe`
      (NOT `venv/bin/python` — that would mean the adapter didn't
      detect Windows correctly)
- [ ] Verify `buildHermesEnv()` built a PATH with `;` separator
- [ ] Report findings

## Phase 5 — Advanced features (optional, stretch goals)

These are nice-to-have validations but not blockers for M1.

- [ ] Profile switching works
- [ ] Settings persistence survives app restart
- [ ] Gateway start/stop from the Settings screen
- [ ] Session history reads from `state.db` correctly
- [ ] Skills list populates (if any installed skills exist)
- [ ] Claw3D setup/start (if you want to test the integration)

## Phase 6 — Uninstall

- [ ] Settings → Apps → Pan Desktop → Uninstall
      (or Control Panel → Programs → Uninstall)
- [ ] **Expected:** uninstaller runs without errors
- [ ] Check that `%LOCALAPPDATA%\Programs\Pan Desktop\` is gone
- [ ] Check that `%APPDATA%\Pan Desktop\` still exists
      (user data should be preserved on uninstall)
- [ ] Check that `%LOCALAPPDATA%\hermes\` still exists
      (Hermes Agent is separate; Pan Desktop uninstall should NOT
      touch it)

## Reporting template

```
**Windows smoke test — <date>**

Tester: <name>
Windows: <version>
SHA: <git sha>
Result: PASS / PARTIAL PASS / FAIL

**What worked:**
- [list the phases that passed]

**What didn't:**
- [list phases that failed with brief description]

**Unexpected things:**
- [anything that surprised you — dialogs, latencies, visual glitches]

**Logs / screenshots:**
- [paste or link]
```
