import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { INSTALL_PS1_SHA256 } from "../generated/installPs1Hash";
import { join } from "path";
import { app } from "electron";
import type { PlatformAdapter } from "../platform/platformAdapter";
import type { ProcessRunner } from "../platform/processRunner";
import type { RuntimePaths } from "./runtimePaths";
import { stripAnsi } from "../utils";
import {
  applyOverlays,
  type OverlayResult,
} from "../services/overlayApplicator";

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
      existsSync(this.deps.runtime.cliProbePath)
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
          existsSync(this.deps.runtime.cliProbePath)
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
      const cmd = this.deps.runtime.buildCliCmd();
      const result = await this.deps.processRunner.run(
        cmd.command,
        [...cmd.args, "doctor"],
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
 * Wave 5 Windows install strategy: native PowerShell, no Git Bash required.
 *
 * Pan Desktop ships the upstream Hermes Agent PowerShell installer as a
 * vendored resource at `resources/install.ps1` (see the header comment in
 * that file for the source commit SHA and supply-chain rationale). At
 * install time this strategy:
 *
 *   1. Resolves the PowerShell host — prefers pwsh.exe (7+), falls back to
 *      powershell.exe (5.1), with a System32 last-resort path. Detection
 *      lives in `platformAdapter.detectPowerShell()`.
 *   2. Resolves the vendored script path — `process.resourcesPath/install.ps1`
 *      in packaged builds, `<repoRoot>/resources/install.ps1` in dev, via
 *      `app.isPackaged`.
 *   3. Spawns PowerShell with `-NoProfile -ExecutionPolicy Bypass -File
 *      <script> -HermesHome <hermesHome> -InstallDir <hermesRepo>`. The
 *      script uses `uv` to manage its own Python toolchain, so we no longer
 *      need Python or Git Bash as Pan Desktop prerequisites.
 *   4. Streams stdout/stderr through `processRunner.spawnStreaming` to the
 *      Install screen, matching the Unix strategy's callback shape.
 *
 * This replaces the previous Wave 4 cop-out that spawned Git Bash to run
 * the upstream `install.sh`. That approach was structurally broken because
 * upstream's install.sh hard-exits on MINGW/MSYS with a redirect to
 * install.ps1 anyway — the Git Bash dependency never bought us anything.
 */
class WindowsInstallerStrategy implements RuntimeInstaller {
  constructor(private readonly deps: RuntimeInstallerDeps) {}

  isInstalled(): boolean {
    return (
      existsSync(this.deps.runtime.pythonExe) &&
      existsSync(this.deps.runtime.cliProbePath)
    );
  }

  async prerequisites(): Promise<PrerequisiteReport> {
    const missing: string[] = [];
    const hints: Record<string, string> = {};

    // PowerShell is always present on every supported Windows version —
    // System32 ships powershell.exe — so this should never fail on a real
    // host. The defensive check exists to produce a clear error rather
    // than a silent ENOENT if someone runs us on a Nano Server / locked
    // down kiosk image with no PowerShell at all.
    const pwsh = this.deps.adapter.detectPowerShell();
    if (!pwsh) {
      missing.push("powershell");
      hints.powershell =
        "Pan Desktop could not locate PowerShell (pwsh.exe or powershell.exe) on this machine. Every supported Windows version ships PowerShell 5.1 in System32 — if it is truly missing, reinstall Windows Management Framework or the relevant feature package.";
    }

    // Note: we do NOT require Git Bash or a user-installed Python here.
    // The vendored install.ps1 uses `uv` to provision its own Python
    // runtime and clones the repo via `git` which uv itself bootstraps
    // when missing. Keep the adapter's detectGitBash/detectPython APIs
    // wired (runtime code may still want them) but don't gate install
    // on either.

    return { ok: missing.length === 0, missing, hints };
  }

  async install(
    onProgress: (progress: InstallProgress) => void,
  ): Promise<void> {
    const pwsh = this.deps.adapter.detectPowerShell();
    if (!pwsh) {
      throw new Error(
        "PowerShell was not found on this system. Pan Desktop requires pwsh.exe or powershell.exe to install Hermes Agent. Reinstall Windows Management Framework (WMF 5.1+) or PowerShell 7 from https://aka.ms/pwsh and try again.",
      );
    }

    // Resolve the vendored install.ps1. In packaged builds electron-builder
    // copies the file to `process.resourcesPath/install.ps1` via the
    // `extraResources` entry in electron-builder.yml. In dev, the file
    // lives at `<repoRoot>/resources/install.ps1` and `app.getAppPath()`
    // points at the repo root.
    const scriptPath = app.isPackaged
      ? join(process.resourcesPath, "install.ps1")
      : join(app.getAppPath(), "resources", "install.ps1");

    if (!existsSync(scriptPath)) {
      throw new Error(
        `install.ps1 not found at ${scriptPath} — Pan Desktop build is corrupt. Reinstall the app from the original setup.exe and try again.`,
      );
    }

    // M1.1-#005: SHA256 integrity check before spawning PowerShell.
    //
    // `INSTALL_PS1_SHA256` is a build-time constant generated by
    // `build/generateInstallPs1Hash.js` from the contents of
    // `resources/install.ps1` during the prebuild step. It's embedded
    // inside `app.asar` so tampering the script ALONE is not enough —
    // an attacker would need to also rewrite the asar, which trips
    // Electron's asar integrity fuse (when enabled).
    //
    // Skip the check in dev mode (`!app.isPackaged`) so developers can
    // edit `resources/install.ps1` without re-running the prebuild
    // script on every dev iteration.
    if (app.isPackaged) {
      const actual = createHash("sha256")
        .update(readFileSync(scriptPath))
        .digest("hex");
      if (actual !== INSTALL_PS1_SHA256) {
        throw new Error(
          `install.ps1 integrity check failed — Pan Desktop build is corrupt ` +
            `or has been tampered with.\n` +
            `  Expected SHA256: ${INSTALL_PS1_SHA256}\n` +
            `  Actual SHA256:   ${actual}\n` +
            `Reinstall Pan Desktop from the original setup.exe and do not ` +
            `click Install until the hash matches.`,
        );
      }
    }

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

    emit("Running vendored Hermes install.ps1 via PowerShell...\n");

    // Environment for the PowerShell child. We keep the adapter's
    // systemPathExtras on PATH so `uv`, `git`, etc. installed to the
    // user's Scoop/cargo/pipx dirs are reachable; the installer will
    // fall back to downloading uv if nothing is on PATH.
    const env = this.deps.buildEnv({
      TERM: "dumb",
    });

    // Resolve the pinned upstream commit SHA from the overlay manifest.
    // install.ps1 accepts `-Ref <sha>` to check out that specific commit
    // after clone, which guarantees the installed Python tree matches
    // the `upstreamSha256` values in the manifest. Without this pin,
    // every overlay would hit `drift-skipped` because install.ps1
    // defaults to the `main` branch head.
    //
    // If the manifest is missing or malformed, we pass empty ref (which
    // install.ps1 treats as "use default branch") — the overlays will
    // then drift-skip, but the install itself still succeeds.
    const overlayDirForManifest = app.isPackaged
      ? join(process.resourcesPath, "overlays")
      : join(app.getAppPath(), "resources", "overlays");
    const pinnedRef = this.readPinnedRef(overlayDirForManifest);
    if (pinnedRef) {
      emit(
        `Pinning upstream Hermes Agent to commit ${pinnedRef.slice(0, 12)}\n`,
      );
    }

    // install.ps1 accepts -HermesHome, -InstallDir, and -Ref. Pan Desktop
    // pins all three to the runtimePaths-resolved locations + the
    // manifest-declared upstream commit so the install lands exactly
    // where runtimePaths expects it and the overlay hashes match.
    const args = [
      "-NoProfile",
      "-NoLogo",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-HermesHome",
      this.deps.runtime.hermesHome,
      "-InstallDir",
      this.deps.runtime.hermesRepo,
      ...(pinnedRef ? ["-Ref", pinnedRef] : []),
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = this.deps.processRunner.spawnStreaming(pwsh, args, {
        cwd: this.deps.adapter.homeDir(),
        env,
        onStdout: (chunk) => emit(stripAnsi(chunk)),
        onStderr: (chunk) => emit(stripAnsi(chunk)),
      });

      proc.on("close", (code) => {
        if (code === 0) {
          emit("\nInstallation complete!\n");
          resolve();
          return;
        }
        if (this.looksInstalledOnDisk()) {
          emit(
            "\nInstall script exited with warnings, but Hermes is installed successfully.\n",
          );
          resolve();
          return;
        }
        reject(
          new Error(
            `Installation failed (exit code ${code}). Check the log above for the failing step — common causes: offline network, antivirus blocking uv download, or a locked %LOCALAPPDATA%\\hermes directory from a previous install.`,
          ),
        );
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start installer: ${err.message}`));
      });
    });

    // M1.1-#008 / #009: apply Pan Desktop overlays on top of the freshly
    // installed Hermes tree. These patch the four Python files that still
    // have Unix-only assumptions upstream missed (fcntl, AF_UNIX, /tmp).
    // Best effort: individual overlay failures do NOT fail the install —
    // the app still works without the patches on Windows for everything
    // except the code-exec sandbox + memory tool, and a diagnostic is
    // written to {hermesHome}/pan-desktop-overlays.json either way.
    await this.applyOverlaysBestEffort(emit);
  }

  /**
   * Best-effort read of `hermesAgentPinnedSha` from the overlay manifest.
   * Returns empty string if the manifest is missing, malformed, or the
   * field is absent — in that case install.ps1 falls back to its default
   * branch and overlays will drift-skip gracefully. We never throw from
   * here because the install succeeds even without a pin.
   */
  private readPinnedRef(overlayDir: string): string {
    try {
      const manifestPath = join(overlayDir, "manifest.json");
      if (!existsSync(manifestPath)) return "";
      const raw = readFileSync(manifestPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "hermesAgentPinnedSha" in parsed &&
        typeof (parsed as { hermesAgentPinnedSha: unknown })
          .hermesAgentPinnedSha === "string"
      ) {
        return (parsed as { hermesAgentPinnedSha: string })
          .hermesAgentPinnedSha;
      }
      return "";
    } catch {
      return "";
    }
  }

  /**
   * Apply the post-install overlay bundle defined by `resources/overlays/
   * manifest.json`. Wrapped in its own method so the install() branch
   * above stays readable and the tests can exercise it in isolation if
   * we ever need them to.
   */
  private async applyOverlaysBestEffort(
    emit: (text: string) => void,
  ): Promise<void> {
    try {
      const overlayDir = app.isPackaged
        ? join(process.resourcesPath, "overlays")
        : join(app.getAppPath(), "resources", "overlays");

      const results = await applyOverlays({
        hermesInstallDir: this.deps.runtime.hermesRepo,
        overlayResourceDir: overlayDir,
        stateDir: this.deps.runtime.hermesHome,
        onProgress: (msg) => emit(`[overlay] ${msg}\n`),
      });

      const summary = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});
      emit(`[overlay] summary: ${JSON.stringify(summary)}\n`);

      // If ANY overlay errored, mention it loudly in the log so a user
      // reading the Install progress sees it — but don't throw.
      const errored = results.filter(
        (r: OverlayResult) => r.status === "error",
      );
      if (errored.length > 0) {
        emit(
          `[overlay] WARNING: ${errored.length} overlay(s) errored. See pan-desktop-overlays.json for details.\n`,
        );
      }
    } catch (err) {
      emit(
        `[overlay] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      // Intentionally do NOT rethrow — install succeeded; overlays are a
      // best-effort improvement and we'd rather leave the user with a
      // working-but-unpatched install than a half-broken failed install.
    }
  }

  async repair(onProgress: (progress: InstallProgress) => void): Promise<void> {
    return this.install(onProgress);
  }

  async doctor(): Promise<string> {
    if (!this.isInstalled()) {
      return "Hermes is not installed. Click the Install button on Pan Desktop's Welcome screen to install Hermes Agent.";
    }
    try {
      const cmd = this.deps.runtime.buildCliCmd();
      const result = await this.deps.processRunner.run(
        cmd.command,
        [...cmd.args, "doctor"],
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

  private looksInstalledOnDisk(): boolean {
    const canonicalPython = this.deps.runtime.pythonExe;
    const legacyPython = join(
      this.deps.adapter.homeDir(),
      ".hermes",
      "hermes-agent",
      "venv",
      "Scripts",
      "python.exe",
    );
    return existsSync(canonicalPython) || existsSync(legacyPython);
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
