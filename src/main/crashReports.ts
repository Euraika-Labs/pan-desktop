import { app } from "electron";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export function getCrashDumpsPath(): string {
  return app.getPath("crashDumps");
}

export function formatCrashDumpHelp(context: string): string {
  return `${context}\n\nCrash dumps are written to:\n${getCrashDumpsPath()}`;
}

/**
 * Write a human-readable crash log to the crashDumps directory before
 * forcing Crashpad to capture a minidump. We do this because:
 *
 *   1. Crashpad minidumps preserve C++ native frames and loaded modules
 *      but DO NOT include V8 JavaScript frames. A JS exception captured
 *      only by Crashpad produces a dump with zero useful stack trace.
 *   2. Users need something they can attach to a bug report WITHOUT
 *      needing WinDbg + symbol server access. A plain text .log next
 *      to the binary .dmp gives them both.
 *   3. If Crashpad misfires (it does, intermittently — see Electron
 *      issue #27602), the .log file is the only evidence of the crash.
 *
 * The resulting file sits next to the minidump in:
 *   Windows: %APPDATA%\Pan Desktop\crashes\pan-desktop-<kind>-<ts>.log
 *   macOS:   ~/Library/Application Support/Pan Desktop/crashes/...
 *   Linux:   ~/.config/Pan Desktop/crashes/...
 *
 * Returns the absolute path of the written log file so callers can
 * surface it in an error dialog.
 */
export function persistCrashLog(kind: string, err: unknown): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = getCrashDumpsPath();
  const logPath = join(dir, `pan-desktop-${kind}-${ts}.log`);
  const body =
    `Pan Desktop crash log\n` +
    `Kind: ${kind}\n` +
    `Timestamp: ${ts}\n` +
    `Version: ${app.getVersion()}\n` +
    `Platform: ${process.platform} ${process.arch}\n` +
    `Electron: ${process.versions.electron}\n` +
    `Node: ${process.versions.node}\n\n` +
    (err instanceof Error
      ? `${err.name}: ${err.message}\n\n${err.stack ?? "(no stack)"}`
      : String(err));
  try {
    // Ensure directory exists — `getCrashDumpsPath()` points at a directory
    // Electron's crashReporter creates on start(), but if we try to write
    // before start() has run (unlikely but possible) we'd hit ENOENT.
    mkdirSync(dir, { recursive: true });
    writeFileSync(logPath, body, "utf8");
  } catch {
    // Best-effort; if we can't write a log we still try to crash so
    // Crashpad at least gets a shot.
  }
  return logPath;
}
