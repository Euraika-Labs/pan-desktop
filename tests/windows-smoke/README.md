# Pan Desktop — Windows smoke test harness

This directory contains the scripts and checklists for validating a Pan
Desktop build on a real Windows VM. Pan Desktop compiles / lints / tests
cleanly on `windows-latest` in CI, but **nobody has actually launched the
shipping NSIS installer end-to-end on Windows** as of M1. This harness
exists so the first human who tries it has a structured path that
catches the common failure modes.

The harness is deliberately documentation-heavy. It's meant to be read
by the tester, not a reliability suite.

## What's in this directory

- **`README.md`** (you are here) — VM setup instructions + where to get
  a free Windows test image
- **`checklist.md`** — manual verification steps with expected results
  and a reporting template
- **`smoke-test.ps1`** — PowerShell script that automates the
  install → launch → health-check → uninstall flow against a NSIS
  artifact

## Why this is not in CI

The GitHub Actions `windows-latest` runner can build the NSIS installer
but:
1. **No Hermes Agent install exists on the runner.** Running the installer
   won't give you a working app — just a UI that shows the Welcome screen.
2. **No display server.** The Electron window can't actually render.
3. **No interactive testing.** The harness verifies that the installer
   runs, that the `.exe` lands in the right place, and that a running
   process starts. Everything beyond that (UI rendering, chat flow,
   actual gateway invocation) requires a human.

So CI validates the build pipeline, this harness validates the user-facing
flow on a real desktop.

## Getting a Windows VM for testing

You don't need a paid Windows license. Microsoft provides free evaluation
images that are good for 90 days and can be reset.

### Option 1 — Microsoft's free Windows 11 evaluation VM (easiest)

1. Visit <https://developer.microsoft.com/en-us/windows/downloads/virtual-machines/>
2. Download the appropriate image for your hypervisor:
   - VMware
   - Hyper-V
   - VirtualBox
   - Parallels (macOS only)
3. Boot the VM. Default credentials are:
   - Username: `User`
   - Password: `Passw0rd!` (check the Microsoft page for the current value)
4. No activation needed for 90 days; reset the eval period by re-downloading.

### Option 2 — Microsoft Windows 11 Evaluation ISO

If you want a fresh install or a different hypervisor:

1. Visit <https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise>
2. Fill out the form (any real email address works)
3. Download the ISO
4. Create a VM in your hypervisor of choice and boot from the ISO

### Option 3 — Reuse an existing Windows install

If you already have a Windows 10/11 VM or machine lying around, use that.
Pan Desktop needs at minimum:
- Windows 10 1809+ or Windows 11
- 8 GB RAM (4 GB will work but be slow)
- 20 GB free disk space
- Internet access for the Hermes Agent installer

## Prerequisites to install on the VM (before running the harness)

The smoke test harness assumes the VM is a clean Windows install with
the following tools already present:

| Tool | Why | How |
|---|---|---|
| **PowerShell 7+** | smoke-test.ps1 uses modern PS syntax | Pre-installed on Windows 11, otherwise from <https://github.com/PowerShell/PowerShell/releases> |
| **Git for Windows** | Hermes Agent installer needs Bash; also for cloning the repo | <https://gitforwindows.org/> — accept all defaults |
| **Node.js 22** (optional) | Only if you want to build from source on the VM instead of using a pre-built NSIS artifact | <https://nodejs.org/> — LTS installer |

Git for Windows bundles Git Bash, which Hermes Agent's install.sh script
can use even though Pan Desktop itself is a Win32 GUI app. This is the
"manual install via Git Bash" path documented in
`getInstallInstructions()` on Windows for M1.

**You do NOT need Visual Studio or MSVC build tools** unless you're building
Pan Desktop FROM SOURCE on the VM. For the smoke test, you're running a
pre-built NSIS installer produced by CI.

## Running the smoke test

1. Build the NSIS installer (locally or via CI):
   - Local: `npm run build:win` → produces `dist/pan-desktop-*-setup.exe`
   - CI: download the artifact from the latest `release.yml` run
2. Copy the `.exe` to the VM — either:
   - Drag-and-drop via hypervisor shared folders
   - Download from a GitHub Actions artifact URL inside the VM
   - Mount the artifact via ISO
3. Open PowerShell 7 **as Administrator** (right-click → Run as admin)
4. Navigate to where you copied the installer and the smoke-test.ps1
5. Run:
   ```powershell
   .\smoke-test.ps1 -InstallerPath .\pan-desktop-0.0.1-setup.exe
   ```
6. Follow any prompts. The script will:
   - Verify the installer signature (will fail on M1 — unsigned build)
   - Run the NSIS installer silently
   - Launch Pan Desktop
   - Wait for the window to appear
   - Capture a screenshot (optional, requires extra tooling)
   - Uninstall
   - Report pass/fail for each step

See `checklist.md` for the manual verification steps to run in parallel.

## Reporting results

After running, file a bug or comment on the Wave 4 MR with:
1. The output of `smoke-test.ps1`
2. Windows version: `winver`
3. PowerShell version: `$PSVersionTable.PSVersion`
4. Any dialogs that popped up
5. Screenshots of the Welcome screen and Settings screen if you got that far

## Known limitations (M1)

- **Unsigned NSIS installer.** Windows SmartScreen will show "Unknown
  publisher" on first launch. Click `More info` → `Run anyway`. This is
  documented in `README.md` at the repo root. M1.1 ships signed.
- **Hermes Agent install fails on Windows.** Pan Desktop's runInstall()
  currently throws a clear error directing you to Git Bash. The correct
  path for M1 is: run the Hermes Agent installer MANUALLY from Git Bash,
  then launch Pan Desktop and use its "Check again" button to pick up
  the install.
- **No auto-update on Windows yet.** electron-updater is wired up but
  the generic provider URL points at GitLab Pages which hasn't been
  built for this version yet. The first real update path lands in M1.1.
