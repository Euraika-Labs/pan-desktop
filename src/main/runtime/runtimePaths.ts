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
   * The venv's bin/Scripts directory — where pip installs console_scripts.
   * Needed so subprocess PATH includes `hermes`, `pip`, `uv`, etc. without
   * feature code re-computing the Windows vs Unix split. Platform-aware:
   *   Unix:    <venvDir>/bin
   *   Windows: <venvDir>\Scripts
   */
  readonly venvBinDir: string;

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

  /** Filesystem path whose presence indicates the CLI is invokable here. */
  readonly cliProbePath: string;

  /**
   * Get the command and args to invoke the Hermes CLI.
   * On Windows, uses `python -m hermes` to bypass bash wrappers.
   */
  buildCliCmd(): { command: string; args: string[] };

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
 * The venv's bin/Scripts directory. Unix uses `bin`, Windows uses
 * `Scripts`. Always built via `path.join` so callers never have to
 * guess the separator.
 */
function resolveVenvBinDir(venvDir: string, adapter: PlatformAdapter): string {
  return adapter.platform === "windows"
    ? join(venvDir, "Scripts")
    : join(venvDir, "bin");
}

/**
 * Python interpreter path inside the venv. The venv layout differs by OS:
 * Unix uses `bin/python`, Windows uses `Scripts\python.exe`. This is a
 * pure path-join (no filesystem check) because the venv is assumed present.
 */
function resolvePythonExe(venvDir: string, adapter: PlatformAdapter): string {
  const binDir = resolveVenvBinDir(venvDir, adapter);
  if (adapter.platform === "windows") {
    return join(binDir, `python${adapter.executableExtension}`);
  }
  return join(binDir, "python");
}

/**
 * Resolve the canonical Hermes Agent home directory. On Windows we prefer
 * %LOCALAPPDATA%\hermes, but we still detect a pre-existing ~/.hermes
 * install so an app session can recover from legacy/manual Git Bash
 * installs without changing the canonical write target.
 */
function resolveHermesHome(adapter: PlatformAdapter): string {
  if (adapter.platform === "windows") {
    const localAppData = process.env.LOCALAPPDATA;
    const canonicalHome = localAppData
      ? join(localAppData, "hermes")
      : join(adapter.homeDir(), "AppData", "Local", "hermes");
    const legacyHome = join(adapter.homeDir(), ".hermes");

    if (existsSync(canonicalHome)) {
      return canonicalHome;
    }
    if (existsSync(legacyHome)) {
      return legacyHome;
    }
    return canonicalHome;
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
  const venvBinDir = resolveVenvBinDir(venvDir, adapter);
  const pythonExe = resolvePythonExe(venvDir, adapter);
  const hermesCli = resolveHermesCli(hermesRepo, adapter);
  const envFile = join(hermesHome, ".env");
  const configFile = join(hermesHome, "config.yaml");
  const profilesRoot = join(hermesHome, "profiles");

  // Invoke the hermes console_script directly on every platform.
  //
  // On Windows, `pip install`/`uv pip install` generates
  // `venv\Scripts\hermes.exe` — a tiny launcher that spawns the venv's
  // python with the right entry point. Calling it directly is cleaner
  // than `python -m hermes` (which FAILS on upstream Hermes Agent
  // because the installed Python package is named `hermes_agent`, not
  // `hermes`). On Unix, the upstream repo root ships a bash script
  // named `hermes` that already activates the venv — hermesCli resolves
  // to that. Uniform `command: hermesCli, args: []` works in both cases.
  //
  // Regression this fixes: "Hermes is installed but appears to be broken"
  // loop on Windows (2026-04-11) — checkInstallStatus's verification was
  // spawning `python -m hermes --version` which exits 1 with "No module
  // named hermes", even though hermes.exe in the venv works fine.
  const buildCliCmd = (): { command: string; args: string[] } => {
    return { command: hermesCli, args: [] };
  };
  const cliProbePath = hermesCli;

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
    venvBinDir,
    pythonExe,
    hermesCli,
    cliProbePath,
    envFile,
    configFile,
    profilesRoot,
    profileHome,
    buildCliCmd,
  };
}
