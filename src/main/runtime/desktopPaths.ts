import { app } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import type { PlatformAdapter } from "../platform/platformAdapter";
import { getRuntimePaths } from "./runtimePaths";

/**
 * Where the Pan Desktop Electron shell stores ITS OWN state.
 *
 * This is intentionally a separate abstraction from runtimePaths. Runtime
 * paths describe Hermes Agent (the Python runtime we install and update);
 * desktop paths describe Pan Desktop itself — sessions database, session
 * cache, Claw3D settings, logs. The split is one of the invariants in
 * docs/ARCHITECTURE_OVERVIEW.md §Invariants:
 *
 *   - Hermes Agent data lives in runtimePaths.hermesHome
 *     (Windows: %LOCALAPPDATA%\hermes, Unix: ~/.hermes)
 *   - Desktop shell data lives in desktopPaths.userData
 *     (Windows: %APPDATA%\Pan Desktop, macOS: ~/Library/Application Support/Pan Desktop,
 *      Linux: ~/.config/Pan Desktop)
 *
 * The desktop path on each platform is whatever Electron's `app.getPath('userData')`
 * returns, which already follows the right per-OS convention.
 *
 * # Migration fallback
 *
 * Existing Unix users have their desktop state files (state.db, sessions
 * cache, .openclaw/claw3d) under `~/.hermes` because the old code shoved
 * everything into HERMES_HOME. We do NOT force-migrate in M1 — doing so is
 * error-prone and offers nothing to Windows users (who are fresh installs).
 * Instead, each getter checks the new path; if empty and the legacy path
 * has data, it returns the legacy path with a one-time log line. Forced
 * migration is deferred to M1.1 (see docs/OPEN_QUESTIONS.md §8).
 */
export interface DesktopPaths {
  /** Root of all desktop-owned storage. */
  readonly userData: string;

  /**
   * Cached sessions JSON written by src/main/session-cache.ts.
   *
   * This is genuinely desktop-owned: Pan Desktop reads the session list
   * from Hermes Agent's state.db and materializes a small index file here
   * for fast "recent conversations" rendering. The canonical session
   * history itself lives in `runtime.hermesHome/state.db` because that's
   * where Hermes Agent (the Python process) writes it — see the Wave 2
   * correction in docs/DECISION_LOG.md.
   */
  readonly sessionCache: string;

  /** Claw3D local settings directory (previously ~/.openclaw/claw3d). */
  readonly claw3dSettings: string;

  /** Log directory for Pan Desktop itself. */
  readonly logs: string;
}

/**
 * Options accepted by createDesktopPaths. In production, `electronUserData`
 * and `electronLogs` come from `app.getPath('userData')` / `app.getPath('logs')`;
 * in tests they can be set directly so the test doesn't need a running
 * Electron main process.
 */
export interface DesktopPathsOptions {
  /**
   * The path Electron would return for app.getPath('userData').
   * Caller is responsible for providing this; see createDesktopPaths for
   * the production-default factory.
   */
  electronUserData: string;
  electronLogs: string;
  /** Whether to check for legacy data under hermesHome and fall back. Default true. */
  legacyFallback?: boolean;
}

/** Internal log hook. One-time warnings about legacy-path fallback. */
const warnedPaths = new Set<string>();
function warnOnceLegacyFallback(message: string): void {
  if (warnedPaths.has(message)) return;
  warnedPaths.add(message);
  // Use console.warn so this shows up in main-process logs. We don't have
  // a logger yet; when one lands in Wave 4, replace this with logger.warn.
  console.warn(`[desktopPaths] ${message}`);
}

/**
 * Given a new candidate path and a legacy candidate, return whichever one
 * should actually be read from right now. If the new path already has
 * content, use it. Otherwise, if the legacy path has content, fall back
 * to it and log a one-time warning.
 *
 * "Has content" is defined as "the file or directory exists on disk". For
 * sqlite databases we check the .db file; for directories we check existence.
 */
function preferNewOrFallbackLegacy(
  newPath: string,
  legacyPath: string,
  label: string,
): string {
  if (existsSync(newPath)) return newPath;
  if (existsSync(legacyPath)) {
    warnOnceLegacyFallback(
      `${label}: using legacy location ${legacyPath} (new location ${newPath} is empty). ` +
        `Data migration is deferred to M1.1.`,
    );
    return legacyPath;
  }
  // Neither exists yet — return the NEW path so first-write goes to the
  // correct convention.
  return newPath;
}

/**
 * Construct DesktopPaths given explicit userData/logs directories.
 *
 * Tests call this directly with temp directories. Production callers should
 * use getDesktopPaths() which wires up Electron's app.getPath().
 */
export function createDesktopPaths(
  adapter: PlatformAdapter,
  options: DesktopPathsOptions,
): DesktopPaths {
  const userData = options.electronUserData;
  const logs = options.electronLogs;
  const legacyFallback = options.legacyFallback ?? true;

  // For legacy fallback we need to know where the old code put things. The
  // old code used `HERMES_HOME/desktop/sessions.json` etc., so reach into
  // runtimePaths for the legacy base.
  const runtime = getRuntimePaths(adapter);
  const legacyHome = runtime.hermesHome;

  // Canonical new locations under userData.
  const newSessionCache = join(userData, "sessions.json");
  const newClaw3dSettings = join(userData, "claw3d");
  // Logs: Electron already returns a per-app logs directory, use it as-is.

  // Legacy locations where the old code put the same files.
  const legacySessionCache = join(legacyHome, "desktop", "sessions.json");
  const legacyClaw3dSettings = join(adapter.homeDir(), ".openclaw", "claw3d");

  const sessionCache = legacyFallback
    ? preferNewOrFallbackLegacy(
        newSessionCache,
        legacySessionCache,
        "sessions.json",
      )
    : newSessionCache;

  const claw3dSettings = legacyFallback
    ? preferNewOrFallbackLegacy(
        newClaw3dSettings,
        legacyClaw3dSettings,
        "claw3d settings",
      )
    : newClaw3dSettings;

  return {
    userData,
    sessionCache,
    claw3dSettings,
    logs,
  };
}

/**
 * Production-mode factory: reads Electron's app.getPath() for userData and
 * logs, then delegates to createDesktopPaths.
 *
 * ⚠ MUST be called AFTER Electron's `ready` event. Calling app.getPath()
 * before ready throws. Wire this into main.ts inside the whenReady callback
 * and pass the result down to feature code.
 */
export function getDesktopPaths(adapter: PlatformAdapter): DesktopPaths {
  // app.getPath throws if called before ready. We let the error propagate
  // rather than returning a fake path, because silent fallback would mask
  // a real ordering bug.
  const userData = app.getPath("userData");
  const logs = app.getPath("logs");
  return createDesktopPaths(adapter, {
    electronUserData: userData,
    electronLogs: logs,
  });
}
