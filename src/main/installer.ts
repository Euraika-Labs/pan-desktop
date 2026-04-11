import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getModelConfig } from "./config";
import { stripAnsi } from "./utils";
import { adapter, runtime, processRunner } from "./runtime/instance";

/**
 * Wave 1 + 2 refactor (2026-04-11):
 *
 * This module used to be the choke point for the Unix-only assumptions in
 * Pan Desktop — hardcoded `~/.hermes`, `venv/bin/python`, `spawn("bash")`,
 * `curl|bash`, `.bashrc/.zshrc` sourcing, PATH joined with `:`.
 *
 * As of Wave 1, all of those concerns are delegated to:
 *   - platformAdapter (OS detection, path separator, executable extensions,
 *     PATH shaping, shell profile candidates)
 *   - runtimePaths (Hermes Agent paths, platform-aware venv layout, CLI
 *     extension resolution)
 *   - processRunner (subprocess execution, tree-kill termination,
 *     findExecutable, no shell strings anywhere)
 *
 * As of Wave 2, every importer (config, profiles, memory, tools, soul,
 * cronjobs, session-cache, sessions, skills, hermes, claw3d) has been
 * migrated to call the `runtime` singleton directly rather than importing
 * HERMES_HOME / HERMES_PYTHON / etc. from this module. The re-exports
 * that existed during Wave 1 have been DELETED — any file still trying
 * to `import { HERMES_PYTHON } from "./installer"` will fail compilation,
 * which is the enforcement mechanism that keeps Wave 1 invariants from
 * regressing.
 *
 * See docs/DECISIONS_M1.md §5 and docs/ARCHITECTURE_OVERVIEW.md §Invariants.
 */

export interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

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
export function getInstallInstructions(): InstallInstructions {
  if (adapter.platform === "windows") {
    // Deliberately no manualCommand. The upstream installer is bash-only
    // and won't run under cmd.exe or PowerShell without WSL/Git Bash, so
    // serving it as a copy-paste would mislead users. A real Windows
    // installer lands in Wave 4 via runtimeInstaller.ts.
    // Fixes HIGH review finding #3.
    return {
      supported: false,
      heading: "Install Hermes Agent on Windows",
      body:
        "Native Windows install is scheduled for Wave 4. Until then, " +
        "open a Git Bash shell (from Git for Windows) or WSL terminal, " +
        "run the upstream Hermes Agent installer there, then re-launch " +
        "Pan Desktop to auto-detect the install. Pan Desktop will handle " +
        "chat, profiles, memory and skills normally once Hermes Agent " +
        "is on disk.",
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
 * Build the PATH env value for spawning Hermes subprocesses, including the
 * Hermes venv's bin/Scripts directory and the platform's common user-install
 * locations.
 *
 * This used to hardcode Unix paths (`/usr/local/bin`, `/opt/homebrew/bin`)
 * and join with `:`. It now delegates to platformAdapter.buildEnhancedPath
 * which does the correct thing per-OS.
 */
export function getEnhancedPath(): string {
  // Venv bin/Scripts dir — platform-aware via runtimePaths + adapter.
  const venvBinDir =
    adapter.platform === "windows"
      ? `${runtime.venvDir}\\Scripts`
      : `${runtime.venvDir}/bin`;
  const extras = [venvBinDir, ...adapter.systemPathExtras()];
  return adapter.buildEnhancedPath(extras);
}

/**
 * Environment object used by every Hermes subprocess spawn. Exported for
 * use by files that still manage their own spawn calls pending Wave 2
 * migration (profiles.ts, skills.ts, hermes.ts, cronjobs.ts).
 */
export function buildHermesEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: adapter.homeDir(),
    HERMES_HOME: runtime.hermesHome,
    ...overrides,
  };
}

export async function checkInstallStatus(): Promise<InstallStatus> {
  const installed =
    existsSync(runtime.pythonExe) && existsSync(runtime.hermesCli);
  const configured = existsSync(runtime.envFile);
  let hasApiKey = false;
  let verified = false;

  if (installed) {
    // Route through processRunner.run so every subprocess call in this
    // file goes through the one and only subprocess boundary. The IPC
    // handler at src/main/index.ts already awaits the result — there was
    // never a sync constraint, only a misread of ipcMain.handle's shape.
    try {
      await processRunner.run(
        runtime.pythonExe,
        [runtime.hermesCli, "--version"],
        {
          cwd: runtime.hermesRepo,
          env: buildHermesEnv(),
          timeoutMs: 15000,
        },
      );
      verified = true;
    } catch {
      verified = false;
    }
  }

  // Local/custom providers don't need an API key
  try {
    const mc = getModelConfig();
    const localProviders = ["custom", "lmstudio", "ollama", "vllm", "llamacpp"];
    if (localProviders.includes(mc.provider)) {
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

// Cached version to avoid re-running the Python process
let _cachedVersion: string | null = null;
let _versionFetching = false;

export async function getHermesVersion(): Promise<string | null> {
  if (_cachedVersion !== null) return _cachedVersion;
  if (!existsSync(runtime.pythonExe) || !existsSync(runtime.hermesCli)) {
    return null;
  }
  if (_versionFetching) {
    // Wait for in-flight fetch
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!_versionFetching) {
          clearInterval(check);
          resolve(_cachedVersion);
        }
      }, 100);
    });
  }
  _versionFetching = true;
  try {
    const result = await processRunner.run(
      runtime.pythonExe,
      [runtime.hermesCli, "--version"],
      {
        cwd: runtime.hermesRepo,
        env: buildHermesEnv(),
        timeoutMs: 15000,
      },
    );
    _cachedVersion = result.stdout.trim();
    return _cachedVersion;
  } catch {
    return null;
  } finally {
    _versionFetching = false;
  }
}

export function clearVersionCache(): void {
  _cachedVersion = null;
}

export async function runHermesDoctor(): Promise<string> {
  if (!existsSync(runtime.pythonExe) || !existsSync(runtime.hermesCli)) {
    return "Hermes is not installed.";
  }
  try {
    const result = await processRunner.run(
      runtime.pythonExe,
      [runtime.hermesCli, "doctor"],
      {
        cwd: runtime.hermesRepo,
        env: buildHermesEnv(),
        timeoutMs: 30000,
      },
    );
    return stripAnsi(result.stdout);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    return stripAnsi(stderr) || "Doctor check failed.";
  }
}

const OPENCLAW_DIR_NAMES = [".openclaw", ".clawdbot", ".moldbot"];

export function checkOpenClawExists(): {
  found: boolean;
  path: string | null;
} {
  const home = adapter.homeDir();
  for (const name of OPENCLAW_DIR_NAMES) {
    // Use path.join so Windows gets backslash separators. Fixes HIGH
    // review finding #2 (path-join regression from the initial refactor).
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
  if (!existsSync(runtime.pythonExe) || !existsSync(runtime.hermesCli)) {
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
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit(`Migrating from ${openclaw.path}...\n`);

  return new Promise((resolve, reject) => {
    const proc = processRunner.spawnStreaming(
      runtime.pythonExe,
      [runtime.hermesCli, "claw", "migrate", "--preset", "full"],
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

export async function runHermesUpdate(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (!existsSync(runtime.pythonExe) || !existsSync(runtime.hermesCli)) {
    throw new Error("Hermes is not installed. Please install it first.");
  }

  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Updating Hermes Agent",
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Running hermes update...\n");

  return new Promise((resolve, reject) => {
    const proc = processRunner.spawnStreaming(
      runtime.pythonExe,
      [runtime.hermesCli, "update"],
      {
        cwd: runtime.hermesRepo,
        env: buildHermesEnv({ TERM: "dumb" }),
        onStdout: (chunk) => emit(stripAnsi(chunk)),
        onStderr: (chunk) => emit(stripAnsi(chunk)),
      },
    );

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nUpdate complete!\n");
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

/**
 * Locate the user's shell profile file (for sourcing their PATH during
 * the install flow). Returns the first existing candidate from the adapter,
 * or null on Windows (where adapter returns an empty candidate list).
 */
function getShellProfile(): string | null {
  for (const p of adapter.shellProfileCandidates()) {
    if (existsSync(p)) return p;
  }
  return null;
}

// Parse install.sh output to detect progress stages
const STAGE_MARKERS: { pattern: RegExp; step: number; title: string }[] = [
  {
    pattern: /Checking for (git|uv|python)/i,
    step: 1,
    title: "Checking prerequisites",
  },
  {
    pattern: /Installing uv|uv found/i,
    step: 2,
    title: "Setting up package manager",
  },
  {
    pattern: /Installing Python|Python .* found/i,
    step: 3,
    title: "Setting up Python",
  },
  {
    pattern: /Cloning|cloning|Updating.*repository|Repository/i,
    step: 4,
    title: "Downloading Hermes Agent",
  },
  {
    pattern: /Creating virtual|virtual environment|venv/i,
    step: 5,
    title: "Creating Python environment",
  },
  {
    pattern: /pip install|Installing.*packages|dependencies/i,
    step: 6,
    title: "Installing dependencies",
  },
  {
    pattern: /Configuration|config|Setup complete|Installation complete/i,
    step: 7,
    title: "Finishing setup",
  },
];

/**
 * Run the Hermes Agent install script.
 *
 * For M1 this still uses the upstream bash-based installer
 * (`curl | bash`). On Windows this path is not yet viable — the bash
 * installer is Unix-only, and a native Windows installer strategy is
 * deferred to Wave 4 (runtimeInstaller.ts) per docs/DECISIONS_M1.md §2.
 * Calling runInstall on Windows currently rejects with a clear message.
 */
export async function runInstall(
  onProgress: (progress: InstallProgress) => void,
): Promise<void> {
  if (adapter.platform === "windows") {
    throw new Error(
      "Native Windows install is not yet supported. Please install Hermes " +
        "Agent manually (e.g. via Git Bash or WSL) and re-launch Pan Desktop. " +
        "A native Windows installer is scheduled for Wave 4 — see " +
        "docs/REFACTOR_ORDER_AND_WAVES.md.",
    );
  }

  const totalSteps = 7;
  let log = "";
  let currentStep = 1;
  let currentTitle = "Starting installation...";

  function emit(text: string): void {
    log += text;
    for (const marker of STAGE_MARKERS) {
      if (marker.pattern.test(text)) {
        if (marker.step >= currentStep) {
          currentStep = marker.step;
          currentTitle = marker.title;
        }
        break;
      }
    }
    onProgress({
      step: currentStep,
      totalSteps,
      title: currentTitle,
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Running official Hermes install script...\n");

  return new Promise((resolve, reject) => {
    // Source the user's shell profile to get the same PATH as their terminal,
    // then run the official install script. Electron apps launched from Finder
    // don't inherit the terminal environment.
    const shellProfile = getShellProfile();
    const installCmd = [
      shellProfile ? `source "${shellProfile}" 2>/dev/null;` : "",
      "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup",
    ].join(" ");

    const proc = processRunner.spawnStreaming("bash", ["-c", installCmd], {
      cwd: adapter.homeDir(),
      env: buildHermesEnv({ TERM: "dumb" }),
      onStdout: (chunk) => emit(stripAnsi(chunk)),
      onStderr: (chunk) => emit(stripAnsi(chunk)),
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nInstallation complete!\n");
        resolve();
      } else {
        // The install script can exit non-zero due to benign issues
        // (e.g. git stash pop failure on already-clean repo).
        // If Hermes is actually installed and working, treat as success.
        if (existsSync(runtime.pythonExe) && existsSync(runtime.hermesCli)) {
          emit(
            "\nInstall script exited with warnings, but Hermes is installed successfully.\n",
          );
          resolve();
        } else {
          reject(
            new Error(
              `Installation failed (exit code ${code}). You can try installing via terminal instead.`,
            ),
          );
        }
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start installer: ${err.message}`));
    });
  });
}
