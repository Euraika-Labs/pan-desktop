import { existsSync } from "fs";
import type { PlatformAdapter } from "../platform/platformAdapter";
import type { ProcessRunner } from "../platform/processRunner";
import type { RuntimePaths } from "./runtimePaths";
import {
  checkCompatibility,
  MANIFEST,
  type CompatibilityResult,
  type RuntimeManifest,
} from "./runtimeManifest";
import { stripAnsi } from "../utils";

/**
 * Wave 4: Hermes Agent runtime update service.
 *
 * Pan Desktop has TWO independent update paths per
 * docs/RUNTIME_UPDATE_STRATEGY.md:
 *
 *   1. The Electron shell itself, updated via electron-updater (already
 *      wired up in src/main/index.ts)
 *   2. The Hermes Agent runtime, updated via this service by running
 *      `hermes update` and streaming progress into the UI
 *
 * This module owns path #2. It's intentionally separate from
 * runtimeInstaller so the two lifecycles stay decoupled — a user can
 * update the runtime without re-running the install flow, and vice versa.
 *
 * Version compatibility is checked against runtimeManifest.ts. The UI
 * uses `getCompatibility()` at startup to decide whether to show a
 * "your Hermes Agent is outdated" banner or a "your Hermes Agent is
 * ahead of Pan Desktop" caveat.
 */

export interface UpdateProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

export interface UpdateCheckResult {
  /** Whether the installed runtime CAN be updated via `hermes update`. */
  canUpdate: boolean;
  /** Current installed version (null if not installed or unknown). */
  currentVersion: string | null;
  /** Compatibility classification for the current version. */
  compatibility: CompatibilityResult;
  /** Human-readable status for display. */
  message: string;
}

/**
 * The update service contract. Feature code (index.ts IPC handlers,
 * settings screen) depends on this interface, not on the concrete
 * implementation below. Tests mock it directly.
 */
export interface RuntimeUpdate {
  /**
   * Fetch the currently-installed Hermes Agent version by shelling out
   * to `hermes --version`. Result is cached per-process; call
   * `clearVersionCache()` to force a re-fetch (e.g. after an update
   * completes).
   */
  getCurrentVersion(): Promise<string | null>;

  /**
   * Clear the cached version. Call this after a successful update.
   */
  clearVersionCache(): void;

  /**
   * Check whether the runtime is in a state that can be updated, and
   * classify the current version against the compatibility manifest.
   * This does NOT hit the network — it only inspects the local install.
   */
  checkForUpdate(): Promise<UpdateCheckResult>;

  /**
   * Run `hermes update` and stream progress events to the caller. The
   * promise resolves when the update completes successfully and rejects
   * with a structured error otherwise.
   */
  applyUpdate(onProgress: (progress: UpdateProgress) => void): Promise<void>;

  /**
   * Return the compatibility result for the currently-installed runtime.
   * Convenience wrapper around `getCurrentVersion()` + `checkCompatibility()`.
   */
  getCompatibility(): Promise<CompatibilityResult>;

  /** The static manifest this Pan Desktop release was built against. */
  getManifest(): RuntimeManifest;
}

export interface RuntimeUpdateDeps {
  adapter: PlatformAdapter;
  runtime: RuntimePaths;
  processRunner: ProcessRunner;
  buildEnv: (overrides?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  /** Optional manifest override for tests. */
  manifest?: RuntimeManifest;
}

class RuntimeUpdateService implements RuntimeUpdate {
  private cachedVersion: string | null = null;
  private cachedVersionFetching = false;
  private readonly manifest: RuntimeManifest;

  constructor(private readonly deps: RuntimeUpdateDeps) {
    this.manifest = deps.manifest ?? MANIFEST;
  }

  async getCurrentVersion(): Promise<string | null> {
    if (this.cachedVersion !== null) return this.cachedVersion;
    if (
      !existsSync(this.deps.runtime.pythonExe) ||
      !existsSync(this.deps.runtime.hermesCli)
    ) {
      return null;
    }

    // Guard against concurrent callers racing on the same fetch.
    if (this.cachedVersionFetching) {
      // Poll the cache every 100ms up to 20 times (= 2s). This is the
      // same pattern the pre-Wave-4 installer.ts used; reused here so
      // behavior stays identical after the refactor.
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!this.cachedVersionFetching) break;
      }
      return this.cachedVersion;
    }

    this.cachedVersionFetching = true;
    try {
      const result = await this.deps.processRunner.run(
        this.deps.runtime.pythonExe,
        [this.deps.runtime.hermesCli, "--version"],
        {
          cwd: this.deps.runtime.hermesRepo,
          env: this.deps.buildEnv(),
          timeoutMs: 15000,
        },
      );
      this.cachedVersion = result.stdout.trim();
      return this.cachedVersion;
    } catch {
      return null;
    } finally {
      this.cachedVersionFetching = false;
    }
  }

  clearVersionCache(): void {
    this.cachedVersion = null;
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    const currentVersion = await this.getCurrentVersion();
    const compatibility = checkCompatibility(currentVersion, this.manifest);
    const canUpdate = currentVersion !== null; // can only update an existing install

    let message: string;
    if (!canUpdate) {
      message = "Hermes Agent is not installed — install it first.";
    } else if (compatibility.status === "too_old") {
      message = `Update available — ${compatibility.message}`;
    } else if (compatibility.status === "too_new") {
      message = compatibility.message;
    } else {
      message = `Hermes Agent ${currentVersion} is up to date.`;
    }

    return {
      canUpdate,
      currentVersion,
      compatibility,
      message,
    };
  }

  async applyUpdate(
    onProgress: (progress: UpdateProgress) => void,
  ): Promise<void> {
    if (
      !existsSync(this.deps.runtime.pythonExe) ||
      !existsSync(this.deps.runtime.hermesCli)
    ) {
      throw new Error("Hermes is not installed. Please install it first.");
    }

    let log = "";
    const emit = (text: string): void => {
      log += text;
      onProgress({
        step: 1,
        totalSteps: 1,
        title: "Updating Hermes Agent",
        detail: text.trim().slice(0, 120),
        log,
      });
    };

    emit("Running hermes update...\n");

    await new Promise<void>((resolve, reject) => {
      const proc = this.deps.processRunner.spawnStreaming(
        this.deps.runtime.pythonExe,
        [this.deps.runtime.hermesCli, "update"],
        {
          cwd: this.deps.runtime.hermesRepo,
          env: this.deps.buildEnv({ TERM: "dumb" }),
          onStdout: (chunk) => emit(stripAnsi(chunk)),
          onStderr: (chunk) => emit(stripAnsi(chunk)),
        },
      );

      proc.on("close", (code) => {
        if (code === 0) {
          emit("\nUpdate complete!\n");
          // Cached version is stale now — next call re-fetches.
          this.clearVersionCache();
          resolve();
        } else {
          reject(new Error(`Update failed (exit code ${code}).`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to run update: ${err.message}`));
      });
    });
  }

  async getCompatibility(): Promise<CompatibilityResult> {
    const current = await this.getCurrentVersion();
    return checkCompatibility(current, this.manifest);
  }

  getManifest(): RuntimeManifest {
    return this.manifest;
  }
}

/**
 * Factory — callers use this instead of instantiating the class directly
 * so the class can stay un-exported. Matches the pattern established by
 * runtimeInstaller, processRunner, platformAdapter.
 */
export function createRuntimeUpdate(deps: RuntimeUpdateDeps): RuntimeUpdate {
  return new RuntimeUpdateService(deps);
}
