#Requires -Version 7.0

<#
.SYNOPSIS
    Pan Desktop Windows smoke test harness.

.DESCRIPTION
    Automates the install/launch/verify/uninstall cycle for a Pan Desktop
    NSIS installer on a Windows VM. This is the "everything a PowerShell
    script can automate" layer; the human parts (UI verification, chat
    flow) live in checklist.md.

    The script is intentionally verbose and fail-loud. It prefers writing
    clear status lines to catching exceptions silently — when a smoke
    test fails, the tester needs to know exactly which step broke.

.PARAMETER InstallerPath
    Path to the pan-desktop-*-setup.exe file produced by `npm run build:win`
    or downloaded from a GitHub Actions artifact.

.PARAMETER SkipUninstall
    Leave the app installed at the end. Useful when you want to continue
    with the manual checklist after the automated phase finishes.

.PARAMETER AppWaitSeconds
    How long to wait after launching Pan Desktop before checking that
    the process is still alive. Default 10 seconds.

.EXAMPLE
    .\smoke-test.ps1 -InstallerPath .\pan-desktop-0.0.1-setup.exe

.EXAMPLE
    .\smoke-test.ps1 -InstallerPath .\pan-desktop-0.0.1-setup.exe -SkipUninstall

.NOTES
    Run from PowerShell 7+ as Administrator. The /S silent install flag
    NSIS uses requires elevation because it writes to %LOCALAPPDATA%\Programs.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [switch]$SkipUninstall,

    [int]$AppWaitSeconds = 10
)

$ErrorActionPreference = 'Stop'

# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

$script:StepNumber = 0
$script:Failures = @()

function Write-Step {
    param([string]$Message)
    $script:StepNumber++
    Write-Host ""
    Write-Host "===== [$script:StepNumber] $Message =====" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  ✗ $Message" -ForegroundColor Red
    $script:Failures += $Message
}

function Write-Info {
    param([string]$Message)
    Write-Host "  → $Message" -ForegroundColor Gray
}

function Assert-Admin {
    $currentUser = [Security.Principal.WindowsPrincipal]::new(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )
    if (-not $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This script must run as Administrator. Right-click PowerShell → Run as administrator."
    }
}

# ═══════════════════════════════════════════════════════════════════════
# Main flow
# ═══════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "Pan Desktop Windows smoke test" -ForegroundColor Magenta
Write-Host "================================" -ForegroundColor Magenta
Write-Host ""

# Environment report
Write-Step "Environment check"
Write-Info "PowerShell: $($PSVersionTable.PSVersion)"
Write-Info "Windows:    $((Get-CimInstance Win32_OperatingSystem).Caption)"
Write-Info "Arch:       $env:PROCESSOR_ARCHITECTURE"
Write-Info "User:       $env:USERNAME"
Write-Info "Home:       $env:USERPROFILE"
Write-Info "LocalApp:   $env:LOCALAPPDATA"
Write-Info "Roaming:    $env:APPDATA"

try {
    Assert-Admin
    Write-Ok "Running as Administrator"
} catch {
    Write-Fail $_.Exception.Message
    exit 1
}

# ───────────────────────────────────────────────────────────────────────
# Phase 1: Installer preflight
# ───────────────────────────────────────────────────────────────────────

Write-Step "Installer artifact preflight"

if (-not (Test-Path $InstallerPath)) {
    Write-Fail "Installer not found: $InstallerPath"
    exit 1
}
Write-Ok "Installer exists: $InstallerPath"

$installerInfo = Get-Item $InstallerPath
Write-Info "Size: $([math]::Round($installerInfo.Length / 1MB, 2)) MB"
Write-Info "Last modified: $($installerInfo.LastWriteTime)"

# Signature check — expected to fail on M1 (unsigned build)
try {
    $sig = Get-AuthenticodeSignature $InstallerPath
    if ($sig.Status -eq 'Valid') {
        Write-Ok "Installer is code-signed: $($sig.SignerCertificate.Subject)"
    } elseif ($sig.Status -eq 'NotSigned') {
        Write-Info "Installer is NOT signed — SmartScreen will warn (expected on M1)"
    } else {
        Write-Info "Signature status: $($sig.Status) (expected on M1)"
    }
} catch {
    Write-Info "Signature check failed: $($_.Exception.Message)"
}

# ───────────────────────────────────────────────────────────────────────
# Phase 2: Capture pre-install state
# ───────────────────────────────────────────────────────────────────────

Write-Step "Pre-install state snapshot"

$installDir = Join-Path $env:LOCALAPPDATA "Programs\Pan Desktop"
$exePath = Join-Path $installDir "Pan Desktop.exe"

if (Test-Path $installDir) {
    Write-Info "WARNING: Install directory already exists — previous install not cleaned up"
    Write-Info "Path: $installDir"
} else {
    Write-Ok "Install directory is clean: $installDir"
}

# ───────────────────────────────────────────────────────────────────────
# Phase 3: Silent NSIS install
# ───────────────────────────────────────────────────────────────────────

Write-Step "Running NSIS installer silently"
Write-Info "This uses /S which is NSIS's silent mode flag"
Write-Info "SmartScreen cannot be bypassed programmatically — if a dialog appears, approve it manually"

$proc = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -PassThru -Wait
$exitCode = $proc.ExitCode

if ($exitCode -eq 0) {
    Write-Ok "Installer exited with code 0"
} else {
    Write-Fail "Installer exited with code $exitCode"
}

if (Test-Path $exePath) {
    Write-Ok "Pan Desktop.exe exists at: $exePath"
} else {
    Write-Fail "Pan Desktop.exe NOT found at: $exePath"
    Write-Info "Install may have gone to a different location. Check the NSIS log."
    exit 1
}

# ───────────────────────────────────────────────────────────────────────
# Phase 4: Launch Pan Desktop
# ───────────────────────────────────────────────────────────────────────

Write-Step "Launching Pan Desktop"
$panProc = Start-Process -FilePath $exePath -PassThru
Write-Info "PID: $($panProc.Id)"

Write-Info "Waiting $AppWaitSeconds seconds for the window to come up..."
Start-Sleep -Seconds $AppWaitSeconds

# Check that the process is still alive
try {
    $runningProc = Get-Process -Id $panProc.Id -ErrorAction Stop
    Write-Ok "Pan Desktop process still alive after $AppWaitSeconds s (PID $($runningProc.Id))"
    Write-Info "Window title: $($runningProc.MainWindowTitle)"
    Write-Info "Working set:  $([math]::Round($runningProc.WorkingSet64 / 1MB, 2)) MB"
} catch {
    Write-Fail "Pan Desktop process exited within $AppWaitSeconds s — likely a startup crash"
    Write-Info "Check Event Viewer → Windows Logs → Application for the crash dump"
}

# Check for the userData directory
$userDataDir = Join-Path $env:APPDATA "Pan Desktop"
if (Test-Path $userDataDir) {
    Write-Ok "userData directory exists: $userDataDir"
    Write-Info "Contents:"
    Get-ChildItem $userDataDir | Select-Object Name, Length | Format-Table | Out-String | Write-Host
} else {
    Write-Info "userData directory not created yet: $userDataDir (may be normal on first launch)"
}

# ───────────────────────────────────────────────────────────────────────
# Phase 5: Stop the app
# ───────────────────────────────────────────────────────────────────────

Write-Step "Stopping Pan Desktop"

try {
    Get-Process -Name "Pan Desktop" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Info "Terminating PID $($_.Id)"
        Stop-Process -Id $_.Id -Force
    }
    Start-Sleep -Seconds 2
    $stillRunning = Get-Process -Name "Pan Desktop" -ErrorAction SilentlyContinue
    if ($stillRunning) {
        Write-Fail "Pan Desktop still running after Stop-Process — zombie processes?"
    } else {
        Write-Ok "All Pan Desktop processes stopped"
    }
} catch {
    Write-Info "No Pan Desktop processes found (already stopped)"
}

# ───────────────────────────────────────────────────────────────────────
# Phase 6: Uninstall (unless skipped)
# ───────────────────────────────────────────────────────────────────────

if ($SkipUninstall) {
    Write-Step "Uninstall skipped (SkipUninstall flag)"
    Write-Info "App remains installed at: $installDir"
    Write-Info "Run the manual checklist next, then uninstall via Settings → Apps"
} else {
    Write-Step "Running uninstaller"
    $uninstallerPath = Join-Path $installDir "Uninstall Pan Desktop.exe"

    if (Test-Path $uninstallerPath) {
        $uninstProc = Start-Process -FilePath $uninstallerPath -ArgumentList "/S" -PassThru -Wait
        if ($uninstProc.ExitCode -eq 0) {
            Write-Ok "Uninstaller exited with code 0"
        } else {
            Write-Fail "Uninstaller exited with code $($uninstProc.ExitCode)"
        }

        Start-Sleep -Seconds 2
        if (Test-Path $installDir) {
            Write-Fail "Install directory still exists after uninstall: $installDir"
        } else {
            Write-Ok "Install directory cleaned up"
        }

        # User data should survive uninstall
        if (Test-Path $userDataDir) {
            Write-Ok "userData preserved (as expected): $userDataDir"
        }
    } else {
        Write-Fail "Uninstaller not found at: $uninstallerPath"
    }
}

# ═══════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "================================" -ForegroundColor Magenta
Write-Host "Smoke test summary" -ForegroundColor Magenta
Write-Host "================================" -ForegroundColor Magenta

if ($script:Failures.Count -eq 0) {
    Write-Host ""
    Write-Host "  ✓ All automated checks passed" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next: run the manual checklist in checklist.md" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host ""
    Write-Host "  ✗ $($script:Failures.Count) check(s) failed:" -ForegroundColor Red
    foreach ($failure in $script:Failures) {
        Write-Host "    - $failure" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "See the output above for context. Report to the Wave 4 MR." -ForegroundColor Yellow
    exit 1
}
