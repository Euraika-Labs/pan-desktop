import { existsSync } from "fs";
import { join } from "path";
import type { PlatformAdapter } from "../platform/platformAdapter";

/**
 * Where Hermes Agent (the underlying Python runtime) lives on disk.
 *
 * This is distinct from where the Pan Desktop Electron shell stores its own
 * state — see desktopPaths.ts for that. The split is intentional: Hermes
 * Agent is an external project we install/update/run; its storage layout
 * is defined by its upstream installer. Pan Desktop's own storage follows
 * Electron conventions via `app.getPath('userData')`.
 *
 * Every path here is a LAZY function, not an exported constant. Feature
 * code calls `getRuntimePaths(adapter).pythonExe` rather than importing
 * a `HERMES_PYTHON` constant. The two reasons:
 *
 *   1. Platform-aware: `pythonExe` differs on Windows (venv\Scripts\python.exe)
 *      vs Unix (venv/bin/python). A single exported constant can't capture that.
 *   2. Enforcement: by removing the exported constants from installer.ts,
 *      any file that still tries to `import { HERMES_PYTHON } from "./installer"`
 *      will fail to compile, forcing migration through this abstraction.
 */
export interface RuntimePaths {
  /** Hermes Agent home directory. Windows: %LOCALAPPDATA%\hermes. Unix: ~/.hermes. */
  readonly hermesHome: string;

  /** Cloned hermes-agent git repo inside hermesHome. */
  readonly hermesRepo: string;

  /** Python virtualenv root inside hermesRepo. */
  readonly venvDir: string;

  /**
   * Python interpreter inside the venv. Platform-aware:
   *   Unix:    <venvDir>/bin/python
   *   Windows: <venvDir>\Scripts\python.exe
   */
  readonly pythonExe: string;

  /**
   * Hermes CLI wrapper script. This is the first of these that exists:
   *   Unix:    <hermesRepo>/hermes
   *   Windows: <hermesRepo>/hermes.exe | hermes.cmd | hermes.bat | hermes
   *
   * If none exist, returns the bare path (hermesRepo/hermes) so error
   * messages point at the expected location.
   */
  readonly hermesCli: string;

  /** Pan Desktop's .env file for the Hermes Agent. */
  readonly envFile: string;

  /** Pan Desktop's config.yaml for the Hermes Agent. */
  readonly configFile: string;

  /** Root directory of Hermes Agent profile subdirectories. */
  readonly profilesRoot: string;

  /**
   * Resolve the "home" directory for a specific profile. The default profile
   * returns hermesHome itself; named profiles return subdirectories under
   * profilesRoot. Keeps the "profile is a subdirectory with identical
   * structure" invariant in one place.
   */
  profileHome(profile?: string): string;
}

/**
 * Resolve the correct Hermes CLI path on disk by walking the platform's
 * script extension candidates in order. This is a filesystem check, not a
 * path join, because on Windows a Python-installed entry-point typically
 * lands as `hermes.exe` in `Scripts\` but can also be `.cmd` or `.bat`
 * depending on installer tooling.
 *
 * If nothing exists, return the bare path so the caller's error message
 * ("file not found: .../hermes") points at the expected location.
 */
function resolveHermesCli(
  hermesRepo: string,
  adapter: PlatformAdapter,
): string {
  // Prefer the CLI that lives inside the venv's Scripts/bin directory on
  // Windows, because Python console_scripts land there by default. On Unix
  // the convention is a bare `hermes` script at the repo root, so we check
  // that first.
  const candidatesByPlatform: string[] =
    adapter.platform === "windows"
      ? [
          join(hermesRepo, "venv", "Scripts", "hermes.exe"),
          join(hermesRepo, "venv", "Scripts", "hermes.cmd"),
          join(hermesRepo, "venv", "Scripts", "hermes.bat"),
          join(hermesRepo, "venv", "Scripts", "hermes"),
          join(hermesRepo, "hermes.exe"),
          join(hermesRepo, "hermes.cmd"),
          join(hermesRepo, "hermes"),
        ]
      : [join(hermesRepo, "hermes"), join(hermesRepo, "venv", "bin", "hermes")];

  for (const candidate of candidatesByPlatform) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Nothing found — return the canonical expected path so errors point here.
  return adapter.platform === "windows"
    ? join(hermesRepo, "venv", "Scripts", "hermes.exe")
    : join(hermesRepo, "hermes");
}

/**
 * Python interpreter path inside the venv. The venv layout differs by OS:
 * Unix uses `bin/python`, Windows uses `Scripts\python.exe`. This is a
 * pure path-join (no filesystem check) because the venv is assumed present.
 */
function resolvePythonExe(venvDir: string, adapter: PlatformAdapter): string {
  if (adapter.platform === "windows") {
    return join(venvDir, "Scripts", `python${adapter.executableExtension}`);
  }
  return join(venvDir, "bin", "python");
}

/**
 * Resolve the canonical Hermes Agent home directory. On Windows this lives
 * in %LOCALAPPDATA%\hermes to match Windows conventions for per-user
 * application data. On Unix we keep `~/.hermes` for backward compatibility
 * with existing installs.
 */
function resolveHermesHome(adapter: PlatformAdapter): string {
  if (adapter.platform === "windows") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      return join(localAppData, "hermes");
    }
    // Fallback: %USERPROFILE%\AppData\Local\hermes
    return join(adapter.homeDir(), "AppData", "Local", "hermes");
  }
  // macOS and Linux: ~/.hermes
  return join(adapter.homeDir(), ".hermes");
}

/**
 * Build the RuntimePaths for the given platform. This is a pure function —
 * no IO except the single filesystem check inside resolveHermesCli which
 * picks the correct extension. Call it once at main-process startup and
 * thread the result through feature code, or call it on demand.
 */
export function getRuntimePaths(adapter: PlatformAdapter): RuntimePaths {
  const hermesHome = resolveHermesHome(adapter);
  const hermesRepo = join(hermesHome, "hermes-agent");
  const venvDir = join(hermesRepo, "venv");
  const pythonExe = resolvePythonExe(venvDir, adapter);
  const hermesCli = resolveHermesCli(hermesRepo, adapter);
  const envFile = join(hermesHome, ".env");
  const configFile = join(hermesHome, "config.yaml");
  const profilesRoot = join(hermesHome, "profiles");

  const profileHome = (profile?: string): string => {
    if (!profile || profile === "default") {
      return hermesHome;
    }
    return join(profilesRoot, profile);
  };

  return {
    hermesHome,
    hermesRepo,
    venvDir,
    pythonExe,
    hermesCli,
    envFile,
    configFile,
    profilesRoot,
    profileHome,
  };
}
