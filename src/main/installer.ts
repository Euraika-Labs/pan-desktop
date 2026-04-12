import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getModelConfig } from "./config";
import { stripAnsi } from "./utils";
import {
  adapter,
  runtime,
  processRunner,
  buildHermesEnv,
  getRuntimeInstaller,
  getRuntimeUpdate,
  refreshRuntimeState,
} from "./runtime/instance";

/**
 * Wave 1 → 2 → 3 → 4 refactor (2026-04-11):
 *
 * This module used to be the choke point for the Unix-only assumptions in
 * Pan Desktop — hardcoded `~/.hermes`, `venv/bin/python`, `spawn("bash")`,
 * `curl|bash`, `.bashrc/.zshrc` sourcing, PATH joined with `:`.
 *
 * Waves 1–3 moved OS/runtime concerns into:
 *   - platformAdapter (OS detection, path separator, shell profiles, etc.)
 *   - runtimePaths (Hermes Agent paths, platform-aware venv layout)
 *   - processRunner (subprocess execution + tree-kill + findExecutable)
 *   - desktopPaths (Electron userData / logs)
 *
 * Wave 4 extracted the install/update/doctor STRATEGY layer into:
 *   - runtime/runtimeInstaller.ts (Unix + Windows strategies)
 *   - runtime/runtimeUpdate.ts (update service + version cache)
 *   - runtime/runtimeManifest.ts (compatibility contract)
 *
 * What's left in this file:
 *   - `checkInstallStatus()` — composite status (installed/configured/
 *     hasApiKey/verified) used by the Welcome IPC handler
 *   - `getInstallInstructions()` — platform-aware UX copy for the Welcome
 *     screen
 *   - `runInstall()` / `runHermesUpdate()` / `runHermesDoctor()` — thin
 *     facades that delegate to the Wave 4 services. Kept as named exports
 *     because the IPC handler surface in index.ts is stable.
 *   - `checkOpenClawExists()` / `runClawMigrate()` — OpenClaw migration
 *     helpers, unrelated to the core install/update strategy
 *   - Re-exports of `buildHermesEnv` and `getEnhancedPath` for the 5 files
 *     that still import them directly (migration to instance.ts imports is
 *     a cleanup task scheduled for M1.1).
 *
 * See docs/DECISIONS_M1.md §5 and docs/ARCHITECTURE_OVERVIEW.md §Invariants.
 */

// Re-export for backward compatibility with the 5 files still importing
// these names from "./installer". They can switch to "./runtime/instance"
// in a follow-up cleanup.
export { buildHermesEnv };

export interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

// Re-export Wave 4 types under the names the IPC layer has always used.
export type { InstallProgress } from "./runtime/runtimeInstaller";
export type { UpdateProgress } from "./runtime/runtimeUpdate";
import type { InstallProgress } from "./runtime/runtimeInstaller";
import type { UpdateProgress } from "./runtime/runtimeUpdate";

const CLI_COMMAND_TIMEOUT_MS = 15000;
const PROGRESS_DETAIL_MAX_LENGTH = 120;

/**
 * Install instructions returned to the renderer for display in the Welcome
 * screen. Renderer never authors these strings — it fetches them from the
 * main process so the install command lives in exactly one place
 * (this file).
 *
 * See docs/ARCHITECTURE_OVERVIEW.md §Invariants #5:
 * "No install/update command strings in src/renderer/".
 */
export interface InstallInstructions {
  /** Whether automatic install via Pan Desktop's installer button is supported. */
  supported: boolean;
  /** Human-readable heading to show in the Welcome UI. */
  heading: string;
  /** Prose explaining what the user should do. */
  body: string;
  /**
   * Shell command the user can run manually as a fallback. Undefined on
   * platforms where no single-command install is available (e.g. Windows).
   */
  manualCommand?: string;
}

/**
 * Return platform-appropriate install instructions for the renderer's
 * Welcome screen. Called via IPC — never import this from the renderer.
 */
export async function getInstallInstructions(): Promise<InstallInstructions> {
  if (adapter.platform === "windows") {
    // Wave 5: always supported on Windows. Pan Desktop ships a vendored
    // install.ps1 and runs it via PowerShell, which is guaranteed to be
    // present on every supported Windows version. There are no manual
    // prerequisites — `uv` handles its own Python runtime — so we do not
    // surface a manualCommand either.
    return {
      supported: true,
      heading: "Install Hermes Agent on Windows",
      body:
        "Pan Desktop will install Hermes Agent (~2 GB including a managed " +
        "Python runtime) in a few minutes. No prerequisites needed — the " +
        "installer downloads everything.",
    };
  }
  return {
    supported: true,
    heading: "Install Hermes Agent",
    body:
      "Pan Desktop can install Hermes Agent for you. If you prefer to run " +
      "the install script yourself in a terminal, copy the command below.",
    manualCommand:
      "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
  };
}

/**
 * getEnhancedPath returns the PATH env value that Hermes subprocesses
 * should inherit — includes the venv bin/Scripts dir and the platform
 * adapter's common user-install locations. Kept as a named export for
 * callers that still reach for it by name; new code should use
 * `buildHermesEnv()` which composes this automatically.
 */
export function getEnhancedPath(): string {
  const extras = [runtime.venvBinDir, ...adapter.systemPathExtras()];
  return adapter.buildEnhancedPath(extras);
}

export async function checkInstallStatus(): Promise<InstallStatus> {
  refreshRuntimeState();
  const installer = getRuntimeInstaller();
  const installed = installer.isInstalled();
  const configured = existsSync(runtime.envFile);
  let hasApiKey = false;
  let verified = false;

  if (installed) {
    try {
      const cmd = runtime.buildCliCmd();
      await processRunner.run(cmd.command, [...cmd.args, "--version"], {
        cwd: runtime.hermesRepo,
        env: buildHermesEnv(),
        timeoutMs: CLI_COMMAND_TIMEOUT_MS,
      });
      verified = true;
    } catch {
      verified = false;
    }
  }

  // Local/custom providers don't need an API key
  try {
    const modelConfig = getModelConfig();
    const localProviders = ["custom", "lmstudio", "ollama", "vllm", "llamacpp"];
    if (localProviders.includes(modelConfig.provider)) {
      hasApiKey = true;
    }
  } catch {
    /* ignore */
  }

  if (!hasApiKey && configured) {
    try {
      const content = readFileSync(runtime.envFile, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        const match = trimmed.match(
          /^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=(.+)$/,
        );
        if (
          match &&
          match[2].trim() &&
          !['""', "''", ""].includes(match[2].trim())
        ) {
          hasApiKey = true;
          break;
        }
      }
    } catch {
      /* ignore read errors */
    }
  }

  return { installed, configured, hasApiKey, verified };
}

/**
 * Return the currently-installed Hermes Agent version, or null if the
 * install isn't detected. Delegates to the runtime update service's
 * cached version.
 */
export async function getHermesVersion(): Promise<string | null> {
  refreshRuntimeState();
  return getRuntimeUpdate().getCurrentVersion();
}

/**
 * Force a re-fetch of the Hermes Agent version on the next getHermesVersion
 * call. IPC handler in index.ts calls this after the user clicks "refresh
 * version" in the Settings screen.
 */
export function clearVersionCache(): void {
  getRuntimeUpdate().clearVersionCache();
}

/**
 * Facade over runtimeInstaller.doctor(). Kept as a named export because
 * the IPC handler `run-hermes-doctor` has always imported it from here.
 */
export async function runHermesDoctor(): Promise<string> {
  return getRuntimeInstaller().doctor();
}

const OPENCLAW_DIR_NAMES = [".openclaw", ".clawdbot", ".moldbot"];

export function checkOpenClawExists(): {
  found: boolean;
  path: string | null;
} {
  const home = adapter.homeDir();
  for (const name of OPENCLAW_DIR_NAMES) {
    const dir = join(home, name);
    if (existsSync(dir)) {
      return { found: true, path: dir };
    }
  }
  return { found: false, path: null };
}

export async function runClawMigrate(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (!existsSync(runtime.pythonExe) || !existsSync(runtime.cliProbePath)) {
    throw new Error("Hermes is not installed.");
  }

  const openclaw = checkOpenClawExists();
  if (!openclaw.found) {
    throw new Error("No OpenClaw installation found.");
  }

  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Migrating from OpenClaw",
      detail: text.trim().slice(0, PROGRESS_DETAIL_MAX_LENGTH),
      log,
    });
  }

  emit(`Migrating from ${openclaw.path}...\n`);

  return new Promise((resolve, reject) => {
    const cmd = runtime.buildCliCmd();
    const proc = processRunner.spawnStreaming(
      cmd.command,
      [...cmd.args, "claw", "migrate", "--preset", "full"],
      {
        cwd: runtime.hermesRepo,
        env: buildHermesEnv({ TERM: "dumb" }),
        onStdout: (chunk) => emit(stripAnsi(chunk)),
        onStderr: (chunk) => emit(stripAnsi(chunk)),
      },
    );

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nMigration complete!\n");
        resolve();
      } else {
        reject(new Error(`Migration failed (exit code ${code}).`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run migration: ${err.message}`));
    });
  });
}

/**
 * Facade over runtimeUpdate.applyUpdate(). Kept as a named export for
 * the `run-hermes-update` IPC handler.
 */
export async function runHermesUpdate(
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  return getRuntimeUpdate().applyUpdate(onProgress);
}

/**
 * Facade over runtimeInstaller.install(). Kept as a named export for
 * the `start-install` IPC handler.
 */
export async function runInstall(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  await getRuntimeInstaller().install(onProgress);
  refreshRuntimeState();
}
