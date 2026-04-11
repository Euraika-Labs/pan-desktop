import { existsSync, statSync } from "fs";
import { homedir, platform as nodePlatform } from "os";
import { delimiter, isAbsolute, join } from "path";

/**
 * Platform identity used throughout the Pan Desktop main process.
 *
 * Exactly one of these corresponds to the current runtime host. Anything
 * that needs to branch on OS must go through a PlatformAdapter rather
 * than `process.platform === 'win32'` sprinkled through feature code —
 * see docs/ARCHITECTURE_OVERVIEW.md §Invariants.
 */
export type SupportedPlatform = "windows" | "macos" | "linux";

/**
 * Everything feature code needs to know about the OS it is running on,
 * expressed as data (not branches). Tests inject a fixture adapter to
 * exercise cross-platform logic on a single runner.
 */
export interface PlatformAdapter {
  readonly platform: SupportedPlatform;

  /** Path separator character (":" on Unix, ";" on Windows). */
  readonly pathSeparator: string;

  /** Extension for native executables including the leading dot ("" on Unix, ".exe" on Windows). */
  readonly executableExtension: string;

  /**
   * Extensions to try in order when resolving a script name like "hermes".
   * Windows: ["", ".exe", ".cmd", ".bat"]. Unix: [""].
   * Order matters — bare name comes first so Unix paths that already include
   * their own extension are not double-extended.
   */
  readonly scriptExtensionCandidates: readonly string[];

  /** The current user's home directory. */
  homeDir(): string;

  /**
   * Filesystem directories to add to PATH for locating common user-installed
   * binaries (uv, pipx, cargo, etc.). Platform-specific.
   */
  systemPathExtras(): readonly string[];

  /**
   * Shell profile files to check when trying to pick up a user's PATH
   * modifications. Windows returns an empty array — Windows uses the registry
   * / environment, not dotfiles. Return order is preference order.
   */
  shellProfileCandidates(): readonly string[];

  /**
   * Return the PATH entries this adapter resolves against — the adapter's
   * captured `envPath` split on `pathSeparator`. Feature code that needs
   * to search PATH (e.g. processRunner.findExecutable) must go through
   * this rather than reading `process.env.PATH` directly, so tests that
   * override `envPath` actually affect behaviour.
   */
  pathEntries(): readonly string[];

  /**
   * Build a PATH env value by prepending the given extras to the current PATH,
   * joined with the platform's delimiter.
   *
   * The "current PATH" here is the LIVE `process.env.PATH` value at call
   * time, not a snapshot — so mutations to the environment during the
   * process lifecycle (e.g. electron-updater adding to PATH) are picked
   * up on the next call. Tests that inject a fixture adapter with a
   * specific `envPath` still see that fixture because the returned
   * closure captures the injected override.
   */
  buildEnhancedPath(extras: readonly string[]): string;

  /**
   * Detect Git Bash on Windows. Returns the path to bash.exe if found,
   * otherwise null. On Unix, always returns null.
   */
  detectGitBash(): string | null;

  /**
   * Detect Python on Windows. Filters out MS Store redirector stubs by size check.
   * Returns the path to python.exe if found, otherwise null.
   * On Unix, returns null.
   */
  detectPython(): string | null;

  /**
   * Detect PowerShell on Windows. Returns the path to pwsh.exe (PowerShell
   * 7+) if present, otherwise powershell.exe (Windows PowerShell 5.1), with
   * the System32 copy as a last-resort fallback because every supported
   * Windows version ships it there. Returns null on non-Windows.
   */
  detectPowerShell(): string | null;
}

/**
 * Options used by createPlatformAdapter. Every field is optional so tests can
 * override one thing (e.g. `platform: "windows"`) without having to construct
 * a whole environment.
 */
export interface PlatformAdapterOptions {
  platform?: SupportedPlatform;
  homeDir?: string;
  envPath?: string;
}

/**
 * Map Node's os.platform() strings to our three supported identities.
 * Anything that isn't darwin/win32 is treated as Linux — including BSDs
 * — because they all use the same PATH/shell/exec semantics for our purposes.
 */
function detectPlatform(): SupportedPlatform {
  const p = nodePlatform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

function unique(entries: readonly string[]): string[] {
  return [...new Set(entries.filter((entry) => entry.length > 0))];
}

function isUsableWindowsPython(path: string): boolean {
  try {
    const stats = statSync(path);
    const normalized = path.toLowerCase();
    if (normalized.includes("\\windowsapps\\")) {
      return stats.size > 64 * 1024;
    }
    return stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Construct a PlatformAdapter. Pass overrides to unit-test the cross-platform
 * logic on a single host. In production, main.ts calls this with no args at
 * startup and threads the result through the runtime layer.
 */
export function createPlatformAdapter(
  options: PlatformAdapterOptions = {},
): PlatformAdapter {
  const platform = options.platform ?? detectPlatform();
  const home = options.homeDir ?? homedir();
  // When the caller provides an explicit envPath override (tests), snapshot
  // it. Otherwise we read process.env.PATH LAZILY at each call so
  // runtime mutations to PATH are reflected. The override-vs-live choice
  // matters: tests inject a fixture and expect it to stick; production
  // code wants the current environment.
  const envPathOverride = options.envPath;
  const readCurrentPath = (): string =>
    envPathOverride ?? process.env.PATH ?? "";

  const pathSeparator = platform === "windows" ? ";" : ":";
  const executableExtension = platform === "windows" ? ".exe" : "";
  // Windows: .exe → .cmd → .bat → extensionless (last-resort).
  // Order matters: nodejs ships both `npm` (a bash shell script with
  // no extension that Windows can't execute) and `npm.cmd` (the real
  // batch wrapper). If "" comes first, findExecutable returns the bash
  // script and spawn() fails with ENOENT. Keep "" last as a safety net
  // for genuinely executable extensionless files (rare on Windows).
  const scriptExtensionCandidates: readonly string[] =
    platform === "windows" ? [".exe", ".cmd", ".bat", ""] : [""];

  const systemPathExtras = (): readonly string[] => {
    if (platform === "windows") {
      // Windows does not have a single canonical "extra bin dir" convention,
      // but pipx and uv both install shims to these locations. PATH entries
      // that don't exist are harmless.
      const extras: string[] = [];
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        extras.push(`${localAppData}\\Programs\\Python\\Launcher`);
        extras.push(`${localAppData}\\pipx\\venvs\\uv\\Scripts`);
      }
      const userProfile = process.env.USERPROFILE ?? home;
      extras.push(`${userProfile}\\.cargo\\bin`);
      extras.push(`${userProfile}\\.local\\bin`);
      return extras;
    }

    // Unix (macos + linux): the tools we care about install to one of these.
    const extras = [
      `${home}/.local/bin`,
      `${home}/.cargo/bin`,
      "/usr/local/bin",
    ];
    if (platform === "macos") {
      extras.push("/opt/homebrew/bin", "/opt/homebrew/sbin");
    }
    return extras;
  };

  const shellProfileCandidates = (): readonly string[] => {
    if (platform === "windows") return [];
    return [
      `${home}/.zshrc`,
      `${home}/.bashrc`,
      `${home}/.bash_profile`,
      `${home}/.profile`,
    ];
  };

  const pathEntries = (): readonly string[] => {
    return readCurrentPath()
      .split(pathSeparator)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const windowsSearchDirs = (): string[] => {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];

    return unique([
      ...(localAppData
        ? [
            join(localAppData, "Programs", "Git", "bin"),
            join(localAppData, "Programs", "Git", "usr", "bin"),
          ]
        : []),
      ...(programFiles
        ? [
            join(programFiles, "Git", "bin"),
            join(programFiles, "Git", "usr", "bin"),
          ]
        : []),
      ...(programFilesX86
        ? [
            join(programFilesX86, "Git", "bin"),
            join(programFilesX86, "Git", "usr", "bin"),
          ]
        : []),
      ...pathEntries(),
    ]).filter((entry) => isAbsolute(entry));
  };

  const findFirstExistingFile = (
    dirs: readonly string[],
    fileNames: readonly string[],
    predicate?: (path: string) => boolean,
  ): string | null => {
    for (const dir of dirs) {
      for (const fileName of fileNames) {
        const candidate = join(dir, fileName);
        if (
          existsSync(candidate) &&
          isAbsolute(candidate) &&
          (predicate ? predicate(candidate) : true)
        ) {
          return candidate;
        }
      }
    }
    return null;
  };

  const detectGitBash = (): string | null => {
    if (platform !== "windows") return null;
    return findFirstExistingFile(windowsSearchDirs(), ["bash.exe"]);
  };

  const detectPython = (): string | null => {
    if (platform !== "windows") return null;
    return findFirstExistingFile(
      windowsSearchDirs(),
      ["python3.exe", "python.exe"],
      isUsableWindowsPython,
    );
  };

  const detectPowerShell = (): string | null => {
    if (platform !== "windows") return null;

    // 1. PowerShell 7+ (pwsh.exe) — preferred if present, lives in PATH.
    // 2. Windows PowerShell 5.1 (powershell.exe) — ships on every Windows 10/11
    //    machine but may not always be first in PATH.
    const pathHit = findFirstExistingFile(pathEntries(), [
      "pwsh.exe",
      "powershell.exe",
    ]);
    if (pathHit) return pathHit;

    // 3. System32 fallback — always present on Windows, even if PATH is
    //    pathological. This is the "defensive always-works" branch.
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const systemFallback = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (existsSync(systemFallback)) return systemFallback;

    return null;
  };

  const buildEnhancedPath = (extras: readonly string[]): string => {
    // Filter empties so accidental "" entries don't corrupt PATH.
    // Preserve caller order — extras come BEFORE the existing PATH so we
    // shadow stale system binaries with ours.
    const segments = [...extras, readCurrentPath()]
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return segments.join(pathSeparator);
  };

  // Silence unused-import warning for `delimiter` — it's here intentionally
  // as a reminder that pathSeparator should agree with Node's own constant
  // on the real platform, but we don't enforce that at runtime.
  void delimiter;

  return {
    platform,
    pathSeparator,
    executableExtension,
    scriptExtensionCandidates,
    homeDir: () => home,
    systemPathExtras,
    shellProfileCandidates,
    pathEntries,
    buildEnhancedPath,
    detectGitBash,
    detectPython,
    detectPowerShell,
  };
}
