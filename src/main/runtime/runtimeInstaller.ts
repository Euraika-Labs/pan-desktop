import { existsSync } from "fs";
import type { PlatformAdapter } from "../platform/platformAdapter";
import type { ProcessRunner } from "../platform/processRunner";
import type { RuntimePaths } from "./runtimePaths";
import { stripAnsi } from "../utils";

/**
 * Wave 4: install strategy boundary.
 *
 * `installer.ts` used to have all of install/update/doctor hardcoded inline
 * with bash-specific assumptions. This module extracts install into a
 * strategy interface with a Unix implementation (the existing curl|bash
 * flow, now routed through processRunner) and a Windows stub that throws
 * a clear error directing users to the M1.1 path.
 *
 * The two strategies exist to keep the decision of WHICH installer to run
 * in one place (the factory at the bottom of this file) rather than
 * sprinkling `if (adapter.platform === "windows")` checks across feature
 * code. When Wave 5 lands a real Windows installer, only
 * WindowsInstallerStrategy needs to change — callers stay the same.
 *
 * See docs/ARCHITECTURE_OVERVIEW.md §Installer boundary and
 * docs/DECISIONS_M1.md §5.
 */

/**
 * Progress event emitted by install/repair. Matches the shape the
 * renderer's Install screen already consumes via IPC so existing UI
 * code doesn't need to change.
 */
export interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

/** Result of a prerequisite check — what the user needs to fix before install. */
export interface PrerequisiteReport {
  /** True when every required tool/condition is present. */
  ok: boolean;
  /** Human-readable names of missing prerequisites. Empty when `ok`. */
  missing: string[];
  /**
   * Hints for the user on how to satisfy each missing prerequisite.
   * Keyed by the same names that appear in `missing`.
   */
  hints: Record<string, string>;
}

/**
 * Strategy interface for installing Hermes Agent on the current platform.
 *
 * Every method is async and returns a well-defined shape — no mutation of
 * hidden state, no side effects outside the install/repair flows. Tests
 * mock this interface directly.
 */
export interface RuntimeInstaller {
  /**
   * Whether Hermes Agent is currently installed. This is a pure filesystem
   * check — no subprocess spawn. Used by UI code to decide between showing
   * the Welcome screen and the main workspace.
   */
  isInstalled(): boolean;

  /**
   * Run a preflight check for all prerequisites (git, bash, curl, python,
   * uv, Node, etc.) without actually installing anything. Returns what's
   * missing so the UI can show a specific error instead of a generic
   * "install failed".
   */
  prerequisites(): Promise<PrerequisiteReport>;

  /**
   * Install Hermes Agent. Emits progress events at each stage and resolves
   * when the install completes, or rejects with a structured error.
   */
  install(onProgress: (progress: InstallProgress) => void): Promise<void>;

  /**
   * Attempt to repair a damaged install — e.g. rerun the installer
   * without wiping user state. Default implementation delegates to
   * install() since the upstream installer is already idempotent.
   */
  repair(onProgress: (progress: InstallProgress) => void): Promise<void>;

  /**
   * Run `hermes doctor` and return the output as a plain string (with
   * ANSI escape codes stripped).
   */
  doctor(): Promise<string>;
}

/**
 * Dependency bundle a strategy needs. Injecting these instead of importing
 * the singletons lets unit tests construct a strategy with fake adapter /
 * runner / paths fixtures.
 */
export interface RuntimeInstallerDeps {
  adapter: PlatformAdapter;
  runtime: RuntimePaths;
  processRunner: ProcessRunner;
  /**
   * Environment object to pass to every subprocess. In production this is
   * `buildHermesEnv()` from installer.ts; tests can pass a narrower env.
   */
  buildEnv: (overrides?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

// ═══════════════════════════════════════════════════════════════════════════
// Unix install strategy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse the upstream installer's stdout to detect progress stages. Pattern
 * pulled forward from the pre-Wave-4 installer.ts so progress reporting
 * stays consistent across the refactor.
 */
const UNIX_INSTALL_STAGES: {
  pattern: RegExp;
  step: number;
  title: string;
}[] = [
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
 * The canonical upstream install command. Same string the pre-Wave-4 code
 * used; centralized here because the entire shell invocation lives in one
 * file now instead of being stitched together in installer.ts.
 */
const UNIX_INSTALL_CURL_BASH =
  "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup";

class UnixInstallerStrategy implements RuntimeInstaller {
  constructor(private readonly deps: RuntimeInstallerDeps) {}

  isInstalled(): boolean {
    return (
      existsSync(this.deps.runtime.pythonExe) &&
      existsSync(this.deps.runtime.hermesCli)
    );
  }

  async prerequisites(): Promise<PrerequisiteReport> {
    const missing: string[] = [];
    const hints: Record<string, string> = {};

    // Tools we need to actually run the upstream installer.
    const checks: { name: string; hint: string }[] = [
      {
        name: "bash",
        hint: "Install bash (usually preinstalled on Linux/macOS).",
      },
      {
        name: "curl",
        hint: "Install curl (available via apt/yum/brew).",
      },
      {
        name: "git",
        hint: "Install git (brew install git on macOS, apt install git on Debian).",
      },
    ];

    for (const { name, hint } of checks) {
      const found = await this.deps.processRunner.findExecutable(name);
      if (!found) {
        missing.push(name);
        hints[name] = hint;
      }
    }

    return { ok: missing.length === 0, missing, hints };
  }

  async install(
    onProgress: (progress: InstallProgress) => void,
  ): Promise<void> {
    const totalSteps = 7;
    let log = "";
    let currentStep = 1;
    let currentTitle = "Starting installation...";

    const emit = (text: string): void => {
      log += text;
      for (const marker of UNIX_INSTALL_STAGES) {
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
    };

    emit("Running official Hermes install script...\n");

    // Source the user's shell profile so we inherit their PATH (Electron
    // apps launched from Finder don't pick up terminal env). The shell
    // profile comes from the adapter's candidate list, so on Windows this
    // branch would be unreachable — we'd be in WindowsInstallerStrategy.
    const shellProfile = this.findShellProfile();
    const installCmd = [
      shellProfile ? `source "${shellProfile}" 2>/dev/null;` : "",
      UNIX_INSTALL_CURL_BASH,
    ].join(" ");

    await new Promise<void>((resolve, reject) => {
      const proc = this.deps.processRunner.spawnStreaming(
        "bash",
        ["-c", installCmd],
        {
          cwd: this.deps.adapter.homeDir(),
          env: this.deps.buildEnv({ TERM: "dumb" }),
          onStdout: (chunk) => emit(stripAnsi(chunk)),
          onStderr: (chunk) => emit(stripAnsi(chunk)),
        },
      );

      proc.on("close", (code) => {
        if (code === 0) {
          emit("\nInstallation complete!\n");
          resolve();
          return;
        }
        // The upstream script can exit non-zero for benign reasons
        // (e.g. `git stash pop` on an already-clean repo). If the result
        // looks like a successful install on disk, treat as success.
        if (
          existsSync(this.deps.runtime.pythonExe) &&
          existsSync(this.deps.runtime.hermesCli)
        ) {
          emit(
            "\nInstall script exited with warnings, but Hermes is installed successfully.\n",
          );
          resolve();
          return;
        }
        reject(
          new Error(
            `Installation failed (exit code ${code}). You can try installing via terminal instead.`,
          ),
        );
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start installer: ${err.message}`));
      });
    });
  }

  async repair(onProgress: (progress: InstallProgress) => void): Promise<void> {
    // The upstream installer is idempotent — running it again on an
    // existing install rebuilds the venv, pulls the repo, and keeps user
    // state intact. That's good enough for M1 "repair".
    return this.install(onProgress);
  }

  async doctor(): Promise<string> {
    if (!this.isInstalled()) {
      return "Hermes is not installed.";
    }
    try {
      const result = await this.deps.processRunner.run(
        this.deps.runtime.pythonExe,
        [this.deps.runtime.hermesCli, "doctor"],
        {
          cwd: this.deps.runtime.hermesRepo,
          env: this.deps.buildEnv(),
          timeoutMs: 30000,
        },
      );
      return stripAnsi(result.stdout);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      return stripAnsi(stderr) || "Doctor check failed.";
    }
  }

  /**
   * Walk the adapter's shell-profile candidate list and return the first
   * one that exists. On Windows this returns null because the adapter's
   * list is empty — but WindowsInstallerStrategy handles Windows so this
   * code path never runs there.
   */
  private findShellProfile(): string | null {
    for (const candidate of this.deps.adapter.shellProfileCandidates()) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Windows install strategy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Placeholder Windows strategy. For M1 we punt on native Windows install
 * and tell users to run the upstream bash installer via Git Bash or WSL,
 * then relaunch Pan Desktop to auto-detect the install. The strategy
 * exists so the factory can pick something for Windows without throwing
 * at module-load time — the errors surface when a user actually clicks
 * "install" in the UI, not at import.
 *
 * A real Windows installer (PowerShell-based or a bundled Python runtime
 * + venv prep) is tracked as Wave 5 / M1.1 in
 * docs/REFACTOR_ORDER_AND_WAVES.md.
 */
class WindowsInstallerStrategy implements RuntimeInstaller {
  constructor(private readonly deps: RuntimeInstallerDeps) {}

  isInstalled(): boolean {
    // If someone manually ran the upstream installer via Git Bash, Hermes
    // Agent may still be on disk at runtimePaths.pythonExe — we detect
    // that the same way UnixInstallerStrategy does. The *install()* method
    // is what's gated, not detection.
    return (
      existsSync(this.deps.runtime.pythonExe) &&
      existsSync(this.deps.runtime.hermesCli)
    );
  }

  async prerequisites(): Promise<PrerequisiteReport> {
    // For the "manual install via Git Bash" path, we still need git to be
    // on PATH. When the native installer lands in M1.1 this check grows
    // into a full prerequisite matrix (MSVC build tools, Python, node-gyp).
    const missing: string[] = [];
    const hints: Record<string, string> = {};
    const git = await this.deps.processRunner.findExecutable("git");
    if (!git) {
      missing.push("git");
      hints.git =
        "Install Git for Windows from https://gitforwindows.org/. The bundled Git Bash is also what Hermes Agent's installer needs.";
    }
    return { ok: missing.length === 0, missing, hints };
  }

  async install(
    onProgress: (progress: InstallProgress) => void,
  ): Promise<void> {
    // The progress callback is intentionally unused here — Windows install
    // throws immediately so there's nothing to stream. We accept and
    // ignore it so the signature matches RuntimeInstaller.install and
    // the factory can return this strategy without type acrobatics.
    void onProgress;
    throw new Error(
      "Native Windows install is not yet supported. " +
        "Please open Git Bash (from Git for Windows) or a WSL terminal and " +
        "run the upstream Hermes Agent installer there, then relaunch Pan " +
        "Desktop to auto-detect the install. A native Windows installer is " +
        "scheduled for the next milestone — see " +
        "docs/REFACTOR_ORDER_AND_WAVES.md Wave 5.",
    );
  }

  async repair(onProgress: (progress: InstallProgress) => void): Promise<void> {
    void onProgress;
    throw new Error(
      "Repair via Pan Desktop is not supported on Windows yet. " +
        "Please delete %LOCALAPPDATA%\\hermes\\hermes-agent (or wherever you " +
        "manually installed Hermes Agent) and run the upstream installer " +
        "again from Git Bash.",
    );
  }

  async doctor(): Promise<string> {
    if (!this.isInstalled()) {
      return (
        "Hermes is not installed. On Windows, install Hermes Agent via Git " +
        "Bash (from Git for Windows) and then relaunch Pan Desktop."
      );
    }
    try {
      const result = await this.deps.processRunner.run(
        this.deps.runtime.pythonExe,
        [this.deps.runtime.hermesCli, "doctor"],
        {
          cwd: this.deps.runtime.hermesRepo,
          env: this.deps.buildEnv(),
          timeoutMs: 30000,
        },
      );
      return stripAnsi(result.stdout);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      return stripAnsi(stderr) || "Doctor check failed.";
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construct the right RuntimeInstaller for the current platform.
 *
 * Consumers get an opaque RuntimeInstaller handle — they don't see the
 * Unix/Windows split. When a real Windows installer lands in Wave 5, this
 * factory is the single site that needs to know the new strategy exists.
 */
export function createRuntimeInstaller(
  deps: RuntimeInstallerDeps,
): RuntimeInstaller {
  if (deps.adapter.platform === "windows") {
    return new WindowsInstallerStrategy(deps);
  }
  return new UnixInstallerStrategy(deps);
}
