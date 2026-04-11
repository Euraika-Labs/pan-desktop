import { homedir, platform as nodePlatform } from "os";
import { delimiter } from "path";

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
  const scriptExtensionCandidates: readonly string[] =
    platform === "windows" ? ["", ".exe", ".cmd", ".bat"] : [""];

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
  };
}
