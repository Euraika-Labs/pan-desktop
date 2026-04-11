# Pan Desktop — Windows 11 AUMID verification checklist

**Ticket:** M1.1-#003
**Audience:** A human tester with a clean Windows 11 VM who has never run Pan Desktop before.
**Estimated time:** 15 minutes.
**Last updated:** 2026-04-11

## What we're verifying

Pan Desktop sets the Windows **App User Model ID (AUMID)** in two places:

1. `electron-builder.yml` → `appId: net.euraika.pandesktop` (stamped onto the NSIS Start Menu + Desktop shortcuts by electron-builder's NSIS template at install time).
2. `src/main/index.ts` → `app.setAppUserModelId("net.euraika.pandesktop")` at module top level, before `app.whenReady()`. This tells the *running* process which AUMID it belongs to, which is what Windows uses to group taskbar windows and to route toast notifications to the correct Start Menu shortcut.

Both must agree, and both must match the AUMID Windows actually sees on the installed shortcut. When they diverge you get the classic **pin-duplication bug**: clicking the pinned shortcut launches a *second* taskbar icon because Windows can't match the running process to the pinned target.

**Expected AUMID:** `net.euraika.pandesktop`
**Expected productName (both `package.json` and `electron-builder.yml`):** `Pan Desktop`

> **Naming caveat:** `net.euraika.pandesktop` is lowercase reverse-DNS. Microsoft's documented convention is PascalCase (`CompanyName.ProductName.SubProduct.VersionInformation`), but lowercase reverse-DNS works in practice and is what electron-builder's default template emits. We are intentionally *not* changing it in M1.1 — the convention mismatch is cosmetic and matches what the installer stamps. If a future version needs to change this, update `appId` in `electron-builder.yml`, `setAppUserModelId` in `src/main/index.ts`, and then re-run this entire checklist.

## Prerequisites

- Clean Windows 11 22H2 or later VM (no prior Pan Desktop install).
- Administrator access to the VM user account (uninstall step needs it).
- PowerShell 5.1+ (ships with Windows 11) — no extra modules required.
- The `pan-desktop-<version>-setup.exe` NSIS installer from the GitHub Releases page or from a local `build:win` run.

## Procedure

### 1. Install

1. Copy `pan-desktop-<version>-setup.exe` to the VM.
2. Double-click the installer. Accept the prompts. The installer is **per-user** (`perMachine: false`), so it installs to `%LOCALAPPDATA%\Programs\pan-desktop\` and does NOT require admin elevation.
3. Let the installer create the Desktop shortcut (`createDesktopShortcut: always`).

**Expected:** A "Pan Desktop" entry appears in the Start Menu and on the Desktop.

### 2. Query the installed shortcut AUMID

Open PowerShell (non-elevated is fine) and run:

```powershell
Get-StartApps | Where-Object { $_.Name -like 'Pan*' }
```

**Expected output:**

```
Name        AppID
----        -----
Pan Desktop net.euraika.pandesktop
```

The `AppID` column *is* the AUMID as Windows sees it for the installed Start Menu shortcut. If this column shows anything else (a random GUID, `{…}!App`, an empty string, or a mismatched string), **stop** — the installer is not stamping the shortcut correctly and the rest of the checklist will fail.

> **Known gotcha:** NSIS itself does **not** auto-stamp AUMID on shortcuts — it's electron-builder's custom NSIS template that does it via the `ApplicationID::Set` plugin. If you're testing a non-standard installer (e.g. a manual `makensis` run), this step may fail even though the code-side `setAppUserModelId` call is correct. The verification is only meaningful against an `electron-builder --win nsis` installer.

### 3. Launch and verify process AUMID

1. Click the Start Menu "Pan Desktop" entry.
2. Wait for the main window to appear.
3. With Pan Desktop still running, run the following PowerShell one-liner to read the AUMID directly from the running process's top-level window via `SHGetPropertyStoreForWindow` + `PKEY_AppUserModel_ID`:

```powershell
# Simple version — compares against the installed shortcut, which is
# sufficient for the grouping/pinning invariant we actually care about:
Get-StartApps | Where-Object { $_.Name -like 'Pan*' } | Format-List Name, AppID
```

For a strict runtime query (optional, only needed if step 5 fails and you want to prove the code-side `setAppUserModelId` ran), compile a tiny C# helper — Windows doesn't ship a built-in PowerShell cmdlet for PKEY_AppUserModel_ID queries on HWNDs. Skip unless debugging.

**Expected:** AppID column is `net.euraika.pandesktop` (same as the installed shortcut from step 2).

### 4. Pin to taskbar and verify ONE icon

1. Right-click the Pan Desktop icon in the taskbar while it's running.
2. Select **Pin to taskbar**.
3. Close Pan Desktop entirely (File → Quit, or click the X on the last window).
4. Click the pinned taskbar icon to relaunch.
5. **Critical check:** Watch the taskbar as the window appears.

**Expected:** Exactly ONE Pan Desktop icon in the taskbar. The pinned icon should "fill in" (indicating it's now the running instance), not spawn a second icon next to it.

> **Known gotcha — pin duplication:** If you see **two** Pan Desktop icons in the taskbar (one pinned + one "running" next to it), that is the classic pin-duplication bug. It is almost always caused by `productName` diverging between `package.json` and `electron-builder.yml`, or by the process-side AUMID not matching the shortcut-side AUMID. Re-verify:
>
> - `package.json` → `productName` == `electron-builder.yml` → `productName` == `"Pan Desktop"`
> - `electron-builder.yml` → `appId` == `setAppUserModelId` call in `src/main/index.ts` == `"net.euraika.pandesktop"`
> - The `setAppUserModelId` call runs at module top level, **before** `app.whenReady()`.

### 5. Test toast notifications

Toast notifications on Windows require a Start Menu shortcut with an AUMID embedded in it — Windows refuses to show toasts from a process whose AUMID doesn't match any installed shortcut. This is effectively a live test that steps 1-3 worked.

Trigger a toast from the running app. Until Pan Desktop has its own UI-exposed toast trigger, the fastest path is from the DevTools console:

```js
// In Pan Desktop's DevTools (View → Toggle DevTools in dev builds):
new Notification("AUMID test", { body: "Toast from Pan Desktop" });
```

**Expected:** A Windows toast appears in the bottom-right corner with "Pan Desktop" as the sender. Click through to Action Center (Win+A) and confirm the notification is attributed to "Pan Desktop", not "Electron" or a generic sender.

> **Known gotcha:** Running Pan Desktop in `electron-vite dev` mode from a local clone typically uses a different AUMID than the installed NSIS build (because no NSIS shortcut exists). Toasts from `npm run dev` may attribute to "Electron" even though the installed build attributes correctly. **Always test toasts against an installed NSIS build, not `npm run dev`.**

### 6. Jump List (right-click menu on taskbar)

1. Right-click the pinned Pan Desktop taskbar icon.
2. Observe the context menu.

**Expected:** The menu shows a "Pan Desktop" header, the "Pin to taskbar / Unpin from taskbar" toggle, and any recent items (may be empty on a fresh install — that's fine). There should be NO "Electron" strings, NO "fathah" strings, and NO legacy "hermes-desktop" strings anywhere in the menu.

### 7. Uninstall and verify pin removed cleanly

1. Open Settings → Apps → Installed apps.
2. Find "Pan Desktop" in the list. Click the `...` menu → Uninstall.
3. Confirm the uninstall prompt.
4. After the uninstaller exits, look at the taskbar.

**Expected:**

- The pinned Pan Desktop icon is gone from the taskbar (Windows removes taskbar pins when the underlying Start Menu shortcut is uninstalled, but only if the AUMID matched cleanly).
- `Get-StartApps | Where-Object { $_.Name -like 'Pan*' }` returns nothing.
- `%LOCALAPPDATA%\Programs\pan-desktop\` is gone or contains only leftover logs.

> **Known gotcha:** If the taskbar pin persists as a "ghost" (clicking it does nothing or shows an error), that is another signal of AUMID mismatch between install and runtime. The ghost can be manually removed by right-click → Unpin from taskbar, but its presence after uninstall means the fix failed and this ticket should be reopened.

## Results

Fill this in when running the checklist. Attach screenshots where useful.

| Step | Expected | Actual | Pass/Fail |
|---|---|---|---|
| 1. Install | NSIS installer completes without admin prompt, Start Menu + Desktop entries appear | | |
| 2. `Get-StartApps` shows AppID `net.euraika.pandesktop` | | | |
| 3. Launch from Start Menu succeeds | | | |
| 4. Pin → close → click pinned → **ONE** taskbar icon | | | |
| 5. Toast attributes to "Pan Desktop" | | | |
| 6. Jump List shows only "Pan Desktop" strings | | | |
| 7. Uninstall removes pin cleanly | | | |

**Overall verdict:**
- [ ] PASS — M1.1-#003 can be closed.
- [ ] FAIL — reopen with findings; reference the failing step above.

**Tester:**
**Date:**
**Windows build:** (run `winver` and paste the version string)
**Pan Desktop version:** (from Help → About or `pan-desktop --version`)
**Installer filename tested:**

## References

- `docs/DECISIONS_M1.md` — Windows identity invariants
- `src/main/index.ts` — `app.setName` + `app.setAppUserModelId` call sites (at module top level, before `crashReporter.start()`)
- `electron-builder.yml` — `appId`, `productName`, NSIS template settings
- Microsoft: [Application User Model IDs (AppUserModelIDs)](https://learn.microsoft.com/en-us/windows/win32/shell/appids)
- electron-builder: [Windows NSIS options](https://www.electron.build/nsis)
