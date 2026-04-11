import { existsSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { createConnection } from "net";
import {
  adapter,
  runtime,
  processRunner,
  getDesktop,
} from "./runtime/instance";
import type { ChildProcess } from "./platform/processRunner";
import { buildHermesEnv } from "./installer";
import { stripAnsi, safeWriteFile } from "./utils";

const HERMES_OFFICE_REPO = "https://github.com/fathah/hermes-office";
const HERMES_OFFICE_DIR = join(runtime.hermesHome, "hermes-office");
const DEV_PID_FILE = join(runtime.hermesHome, "claw3d-dev.pid");
const ADAPTER_PID_FILE = join(runtime.hermesHome, "claw3d-adapter.pid");
const PORT_FILE = join(runtime.hermesHome, "claw3d-port");
const WS_URL_FILE = join(runtime.hermesHome, "claw3d-ws-url");
const DEFAULT_PORT = 3000;
const DEFAULT_WS_URL = "ws://localhost:18789";

/**
 * Where Claw3D stores its own onboarding settings. In Wave 1 we moved this
 * off the hardcoded `~/.openclaw/claw3d` (which was the pre-rebrand path)
 * onto desktopPaths.claw3dSettings, which resolves to
 * `%APPDATA%\Pan Desktop\claw3d` on Windows (or equivalents on macOS/Linux)
 * with a legacy fallback for users still on the old location.
 */
function claw3dSettingsDir(): string {
  return getDesktop().claw3dSettings;
}

let devServerProcess: ChildProcess | null = null;
let adapterProcess: ChildProcess | null = null;
let devServerLogs = "";
let adapterLogs = "";
let devServerError = "";
let adapterError = "";

function getSavedPort(): number {
  try {
    const port = parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10);
    return isNaN(port) ? DEFAULT_PORT : port;
  } catch {
    return DEFAULT_PORT;
  }
}

export function setClaw3dPort(port: number): void {
  safeWriteFile(PORT_FILE, String(port));
  // Re-write .env with updated port
  writeClaw3dSettings();
}

export function getClaw3dPort(): number {
  return getSavedPort();
}

function getSavedWsUrl(): string {
  try {
    const url = readFileSync(WS_URL_FILE, "utf-8").trim();
    return url || DEFAULT_WS_URL;
  } catch {
    return DEFAULT_WS_URL;
  }
}

export function setClaw3dWsUrl(url: string): void {
  safeWriteFile(WS_URL_FILE, url);
  // Also update the settings.json so Claw3D picks it up
  writeClaw3dSettings(url);
}

export function getClaw3dWsUrl(): string {
  return getSavedWsUrl();
}

/**
 * Write Claw3D settings to desktopPaths.claw3dSettings/settings.json
 * and .env in the claw3d directory so onboarding is skipped.
 */
function writeClaw3dSettings(wsUrl?: string): void {
  const url = wsUrl || getSavedWsUrl();

  try {
    const settingsDir = claw3dSettingsDir();
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");

    // Preserve existing settings if present
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      /* fresh */
    }

    const settings = {
      ...existing,
      adapter: "hermes",
      url,
      token: "",
    };
    safeWriteFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    /* non-fatal */
  }

  // Write .env in claw3d directory
  try {
    if (existsSync(HERMES_OFFICE_DIR)) {
      const envPath = join(HERMES_OFFICE_DIR, ".env");
      const port = getSavedPort();
      const envContent = [
        "# Auto-configured by Pan Desktop",
        `PORT=${port}`,
        `HOST=127.0.0.1`,
        `NEXT_PUBLIC_GATEWAY_URL=${url}`,
        `CLAW3D_GATEWAY_URL=${url}`,
        `CLAW3D_GATEWAY_TOKEN=`,
        `HERMES_ADAPTER_PORT=18789`,
        `HERMES_MODEL=hermes`,
        `HERMES_AGENT_NAME=Hermes`,
        "",
      ].join("\n");
      safeWriteFile(envPath, envContent);
    }
  } catch {
    /* non-fatal */
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(300); // 300ms is plenty for localhost
    socket.on("connect", () => {
      socket.destroy();
      resolve(true); // port is in use
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false); // port is free
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export interface Claw3dStatus {
  cloned: boolean;
  installed: boolean;
  devServerRunning: boolean;
  adapterRunning: boolean;
  running: boolean; // true when both dev + adapter are up
  port: number;
  portInUse: boolean;
  wsUrl: string;
  error: string; // last error from either process
}

export interface Claw3dSetupProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

function readPid(file: string): number | null {
  try {
    const pid = parseInt(readFileSync(file, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(file: string, pid: number): void {
  safeWriteFile(file, String(pid));
}

function cleanupPid(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function isDevServerRunning(): boolean {
  if (devServerProcess && !devServerProcess.killed) return true;
  const pid = readPid(DEV_PID_FILE);
  if (pid && processRunner.isProcessAlive(pid)) return true;
  cleanupPid(DEV_PID_FILE);
  return false;
}

function isAdapterRunning(): boolean {
  if (adapterProcess && !adapterProcess.killed) return true;
  const pid = readPid(ADAPTER_PID_FILE);
  if (pid && processRunner.isProcessAlive(pid)) return true;
  cleanupPid(ADAPTER_PID_FILE);
  return false;
}

export async function getClaw3dStatus(): Promise<Claw3dStatus> {
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));
  const installed = existsSync(join(HERMES_OFFICE_DIR, "node_modules"));
  const port = getSavedPort();
  const devRunning = isDevServerRunning();
  // Only check port conflict when dev server is NOT running
  const portInUse = devRunning ? false : await checkPort(port);
  const adapterUp = isAdapterRunning();
  const error = devServerError || adapterError;
  return {
    cloned,
    installed,
    devServerRunning: devRunning,
    adapterRunning: adapterUp,
    running: devRunning && adapterUp,
    port,
    portInUse,
    wsUrl: getSavedWsUrl(),
    error,
  };
}

let _cachedNpmPath: string | null = null;

/**
 * Resolve the npm binary via processRunner.findExecutable, which handles
 * Windows `npm.cmd`/`.bat` extensions, the adapter's systemPathExtras,
 * and the current PATH uniformly across platforms. No shell, no
 * `which/where` string. Caches the result for the process lifetime.
 */
async function findNpm(): Promise<string> {
  if (_cachedNpmPath) return _cachedNpmPath;
  const found = await processRunner.findExecutable("npm");
  _cachedNpmPath = found ?? "npm";
  return _cachedNpmPath;
}

export async function setupClaw3d(
  onProgress: (progress: Claw3dSetupProgress) => void,
): Promise<void> {
  const totalSteps = 2;
  let log = "";

  function emit(step: number, title: string, text: string): void {
    log += text;
    onProgress({
      step,
      totalSteps,
      title,
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  const env = buildHermesEnv({ TERM: "dumb" });

  // Step 1: Clone (or pull if already cloned)
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));

  if (!cloned) {
    emit(1, "Cloning Claw3D repository...", "Cloning from GitHub...\n");
    await new Promise<void>((resolve, reject) => {
      const proc = processRunner.spawnStreaming(
        "git",
        ["clone", HERMES_OFFICE_REPO, HERMES_OFFICE_DIR],
        {
          cwd: adapter.homeDir(),
          env,
          onStdout: (text) =>
            emit(1, "Cloning Claw3D repository...", stripAnsi(text)),
          onStderr: (text) =>
            emit(1, "Cloning Claw3D repository...", stripAnsi(text)),
        },
      );

      proc.on("close", (code) => {
        if (code === 0) {
          emit(1, "Cloning Claw3D repository...", "Clone complete.\n");
          resolve();
        } else {
          reject(new Error(`git clone failed (exit code ${code})`));
        }
      });
      proc.on("error", (err) =>
        reject(new Error(`Failed to run git: ${err.message}`)),
      );
    });
  } else {
    emit(
      1,
      "Claw3D already cloned",
      "Repository already exists, pulling latest...\n",
    );
    await new Promise<void>((resolve) => {
      const proc = processRunner.spawnStreaming("git", ["pull", "--ff-only"], {
        cwd: HERMES_OFFICE_DIR,
        env,
        onStdout: (text) => emit(1, "Updating Claw3D...", stripAnsi(text)),
        onStderr: (text) => emit(1, "Updating Claw3D...", stripAnsi(text)),
      });

      proc.on("close", () => resolve());
      // non-fatal: pull failures shouldn't block setup
      proc.on("error", () => resolve());
    });
  }

  // Step 2: npm install
  emit(2, "Installing dependencies...", "Running npm install...\n");
  const npm = await findNpm();

  await new Promise<void>((resolve, reject) => {
    const proc = processRunner.spawnStreaming(npm, ["install"], {
      cwd: HERMES_OFFICE_DIR,
      env,
      onStdout: (text) =>
        emit(2, "Installing dependencies...", stripAnsi(text)),
      onStderr: (text) =>
        emit(2, "Installing dependencies...", stripAnsi(text)),
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit(
          2,
          "Installing dependencies...",
          "Dependencies installed successfully.\n",
        );
        resolve();
      } else {
        reject(new Error(`npm install failed (exit code ${code})`));
      }
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to run npm: ${err.message}`)),
    );
  });

  // Write config files so Claw3D skips onboarding
  writeClaw3dSettings();
}

export async function startDevServer(): Promise<boolean> {
  if (isDevServerRunning()) return true;
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) return false;

  devServerError = "";
  devServerLogs = "";
  const port = getSavedPort();
  const npm = await findNpm();

  const proc = processRunner.spawnStreaming(npm, ["run", "dev"], {
    cwd: HERMES_OFFICE_DIR,
    env: buildHermesEnv({ TERM: "dumb", PORT: String(port) }),
    // Detached because the Claw3D dev server is long-lived and should
    // survive desktop-app restarts. killTree cleans it up on explicit stop.
    detached: true,
    onStdout: (text) => {
      devServerLogs += stripAnsi(text);
      if (devServerLogs.length > 2000)
        devServerLogs = devServerLogs.slice(-2000);
    },
    onStderr: (raw) => {
      const text = stripAnsi(raw);
      devServerLogs += text;
      if (devServerLogs.length > 2000)
        devServerLogs = devServerLogs.slice(-2000);
      if (
        /error|EADDRINUSE|ENOENT|failed|fatal/i.test(text) &&
        !/warning/i.test(text)
      ) {
        devServerError = text.trim().slice(0, 300);
      }
    },
  });

  devServerProcess = proc;
  if (proc.pid) writePid(DEV_PID_FILE, proc.pid);

  proc.on("close", (code) => {
    if (code && code !== 0 && !devServerError) {
      devServerError = `Dev server exited with code ${code}. Check if port ${port} is available.`;
    }
    devServerProcess = null;
    cleanupPid(DEV_PID_FILE);
  });

  proc.unref();
  return true;
}

export async function stopDevServer(): Promise<void> {
  if (devServerProcess) {
    await processRunner
      .killTree(devServerProcess, { graceMs: 3000 })
      .catch(() => {
        /* already gone */
      });
    devServerProcess = null;
  }

  const pid = readPid(DEV_PID_FILE);
  if (pid) {
    await processRunner.killTree(pid, { graceMs: 3000 }).catch(() => {
      /* already gone */
    });
  }
  cleanupPid(DEV_PID_FILE);
}

export async function startAdapter(): Promise<boolean> {
  if (isAdapterRunning()) return true;
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) return false;

  adapterError = "";
  adapterLogs = "";
  const npm = await findNpm();

  const proc = processRunner.spawnStreaming(npm, ["run", "hermes-adapter"], {
    cwd: HERMES_OFFICE_DIR,
    env: buildHermesEnv({ TERM: "dumb" }),
    detached: true,
    onStdout: (text) => {
      adapterLogs += stripAnsi(text);
      if (adapterLogs.length > 2000) adapterLogs = adapterLogs.slice(-2000);
    },
    onStderr: (raw) => {
      const text = stripAnsi(raw);
      adapterLogs += text;
      if (adapterLogs.length > 2000) adapterLogs = adapterLogs.slice(-2000);
      if (
        /error|EADDRINUSE|ENOENT|failed|fatal/i.test(text) &&
        !/warning/i.test(text)
      ) {
        adapterError = text.trim().slice(0, 300);
      }
    },
  });

  adapterProcess = proc;
  if (proc.pid) writePid(ADAPTER_PID_FILE, proc.pid);

  proc.on("error", (err) => {
    // Fires when spawn itself fails (ENOENT, EINVAL on Windows .cmd
    // without shell:true, permission errors, etc). Without this
    // handler, the 'close' event still fires but reports a naked
    // "exited with code 1" with no log capture because stdio was
    // never wired up. Populate adapterError with the real reason so
    // the UI can surface it instead of the generic "code 1".
    adapterError = `Failed to start Hermes adapter: ${err.message}`;
    adapterLogs += `[SPAWN ERROR] ${err.message}\n`;
  });

  proc.on("close", (code) => {
    if (code && code !== 0 && !adapterError) {
      adapterError = `Hermes adapter exited with code ${code}`;
    }
    adapterProcess = null;
    cleanupPid(ADAPTER_PID_FILE);
  });

  proc.unref();
  return true;
}

export async function stopAdapter(): Promise<void> {
  if (adapterProcess) {
    await processRunner
      .killTree(adapterProcess, { graceMs: 3000 })
      .catch(() => {
        /* already gone */
      });
    adapterProcess = null;
  }

  const pid = readPid(ADAPTER_PID_FILE);
  if (pid) {
    await processRunner.killTree(pid, { graceMs: 3000 }).catch(() => {
      /* already gone */
    });
  }
  cleanupPid(ADAPTER_PID_FILE);
}

export async function startAll(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) {
    return {
      success: false,
      error: "Claw3D is not installed. Please install it first.",
    };
  }

  const port = getSavedPort();

  // Start dev server
  const devOk = await startDevServer();
  if (!devOk) {
    return {
      success: false,
      error: `Failed to start dev server on port ${port}`,
    };
  }

  // Start adapter
  const adapterOk = await startAdapter();
  if (!adapterOk) {
    return { success: false, error: "Failed to start Hermes adapter" };
  }

  return { success: true };
}

export async function stopAll(): Promise<void> {
  await stopDevServer();
  await stopAdapter();
  devServerError = "";
  adapterError = "";
}

export function getClaw3dLogs(): string {
  return [
    devServerLogs ? `=== Dev Server ===\n${devServerLogs}` : "",
    adapterLogs ? `=== Adapter ===\n${adapterLogs}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
