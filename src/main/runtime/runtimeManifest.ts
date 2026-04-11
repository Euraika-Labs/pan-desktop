/**
 * Pan Desktop ↔ Hermes Agent compatibility contract.
 *
 * The Hermes Agent runtime is a separate project that Pan Desktop installs
 * and updates. Because the two projects have independent release cadences,
 * we need a way to declare "Pan Desktop version X is tested against Hermes
 * Agent versions Y through Z". This module is the single source of truth
 * for that contract.
 *
 * ## How compatibility is checked
 *
 * At startup (via runtimeUpdate.getCurrentVersion), Pan Desktop asks the
 * installed Hermes Agent for its version, then calls checkCompatibility()
 * to classify the result:
 *
 *   - `ok`         — version is in the supported range; proceed normally
 *   - `too_old`    — version is below minimumHermesAgentVersion; warn the
 *                    user and suggest running the update flow
 *   - `too_new`    — version is above maximumTestedHermesAgentVersion;
 *                    warn the user that behavior may be unstable
 *   - `unknown`    — can't parse the version string (legacy install, weird
 *                    build); treat as ok-with-caveat
 *
 * ## How to update this manifest
 *
 * When a new Hermes Agent release drops:
 *   1. Bump `preferredHermesAgentVersion` to the new release
 *   2. Bump `maximumTestedHermesAgentVersion` if QA has verified the new
 *      release
 *   3. Bump `minimumHermesAgentVersion` ONLY if Pan Desktop drops support
 *      for older agents (e.g. a breaking API change)
 *   4. Update `migrationFlags.configFormatVersion` if the upstream config
 *      format changed in a way Pan Desktop needs to detect
 *
 * Every bump should be paired with a CHANGELOG entry explaining what
 * changed and why the version pin moved.
 *
 * See docs/REFACTOR_ORDER_AND_WAVES.md §Wave 4 for the design rationale.
 */

/**
 * Manifest schema — exported so the test harness can construct fixtures
 * with arbitrary values instead of relying on the real constants below.
 */
export interface RuntimeManifest {
  /** Oldest Hermes Agent version this Pan Desktop release can talk to. */
  readonly minimumHermesAgentVersion: string;

  /**
   * Version the Pan Desktop team actively develops against. Anything
   * newer is "ahead of us"; anything older works but may be missing
   * features.
   */
  readonly preferredHermesAgentVersion: string;

  /**
   * Highest Hermes Agent version we've actually run end-to-end against.
   * Users on agent versions above this get a "untested" warning but are
   * not blocked.
   */
  readonly maximumTestedHermesAgentVersion: string;

  /**
   * Per-feature migration flags. When a flag is bumped, Pan Desktop runs
   * the corresponding migration on startup. Each flag represents a
   * schema/format change in some piece of Hermes Agent state that Pan
   * Desktop also reads or writes.
   */
  readonly migrationFlags: {
    /**
     * Bump when the upstream `config.yaml` schema changes in a way that
     * requires Pan Desktop to rewrite / re-parse the file differently.
     */
    readonly configFormatVersion: number;
  };
}

/**
 * Compatibility classifications returned by checkCompatibility().
 * Caller decides what to do per classification (warn, block, proceed).
 */
export type CompatibilityStatus = "ok" | "too_old" | "too_new" | "unknown";

export interface CompatibilityResult {
  status: CompatibilityStatus;
  installedVersion: string | null;
  manifest: RuntimeManifest;
  /** Short message suitable for displaying to users. */
  message: string;
}

/**
 * The live manifest for this Pan Desktop release.
 *
 * NOTE: these version strings are INTENTIONALLY conservative at M1 launch
 * because we haven't yet done extensive QA matrix runs. Bump them as we
 * test more.
 */
export const MANIFEST: RuntimeManifest = {
  minimumHermesAgentVersion: "0.7.0",
  preferredHermesAgentVersion: "0.8.0",
  maximumTestedHermesAgentVersion: "0.9.0",
  migrationFlags: {
    configFormatVersion: 1,
  },
};

/**
 * Parse a semver-ish version string into a [major, minor, patch] tuple.
 * Returns null if the string doesn't look like semver. Accepts optional
 * leading "v" (so "v1.2.3" and "1.2.3" both parse) and ignores pre-release
 * / build metadata (so "1.2.3-rc.1+hash" becomes [1, 2, 3]).
 *
 * Pan Desktop only cares about major/minor/patch for compatibility checks
 * — pre-release ordering is out of scope.
 */
export function parseVersion(version: string): [number, number, number] | null {
  const trimmed = version.trim().replace(/^v/, "");
  // Match `M.N.P` at the start, tolerating anything after.
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;
  return [major, minor, patch];
}

/**
 * Return -1 if a < b, 0 if a == b, 1 if a > b. Strict lexicographic
 * comparison of the [major, minor, patch] tuples.
 */
export function compareVersions(
  a: [number, number, number],
  b: [number, number, number],
): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Given the currently-installed Hermes Agent version (as a string or null
 * if no install is detected), return a compatibility classification.
 *
 * Callers in the renderer can display `result.message` directly; callers
 * in the main process should switch on `result.status` to decide whether
 * to proceed, warn, or block.
 */
export function checkCompatibility(
  installedVersion: string | null,
  manifest: RuntimeManifest = MANIFEST,
): CompatibilityResult {
  if (installedVersion === null || installedVersion.trim().length === 0) {
    return {
      status: "unknown",
      installedVersion,
      manifest,
      message:
        "Hermes Agent is not installed or its version could not be detected.",
    };
  }

  const installed = parseVersion(installedVersion);
  if (installed === null) {
    return {
      status: "unknown",
      installedVersion,
      manifest,
      message: `Hermes Agent version "${installedVersion}" is not in a recognized format. Assuming compatibility.`,
    };
  }

  const min = parseVersion(manifest.minimumHermesAgentVersion);
  const max = parseVersion(manifest.maximumTestedHermesAgentVersion);
  if (min === null || max === null) {
    // Manifest itself is malformed — return ok so we don't crash the
    // app, and let whoever wrote the manifest catch it via unit tests.
    return {
      status: "ok",
      installedVersion,
      manifest,
      message: `Running Hermes Agent ${installedVersion}.`,
    };
  }

  if (compareVersions(installed, min) < 0) {
    return {
      status: "too_old",
      installedVersion,
      manifest,
      message: `Hermes Agent ${installedVersion} is older than the minimum supported version (${manifest.minimumHermesAgentVersion}). Please update Hermes Agent.`,
    };
  }

  if (compareVersions(installed, max) > 0) {
    return {
      status: "too_new",
      installedVersion,
      manifest,
      message: `Hermes Agent ${installedVersion} is newer than the maximum tested version (${manifest.maximumTestedHermesAgentVersion}). Some features may behave unexpectedly.`,
    };
  }

  return {
    status: "ok",
    installedVersion,
    manifest,
    message: `Running Hermes Agent ${installedVersion}.`,
  };
}
