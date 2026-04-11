import {
  spawn,
  execFile,
  type ChildProcess,
  type SpawnOptions,
  type ExecFileOptions,
} from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import treeKill from "tree-kill";
import type { PlatformAdapter } from "./platformAdapter";

/**
 * Result of a one-shot process run. stdout and stderr are captured strings,
 * exit code may be null if the process was killed by a signal.
 */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Milliseconds before the process is killed. 0 or undefined = no timeout. */
  timeoutMs?: number;
  /** Maximum bytes of stdout/stderr to buffer. Default 10 MB. */
  maxBuffer?: number;
}

export interface SpawnStreamingOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called with each chunk of stdout as it arrives. */
  onStdout?: (chunk: string) => void;
  /** Called with each chunk of stderr as it arrives. */
  onStderr?: (chunk: string) => void;
}

export interface KillTreeOptions {
  /** Signal to send first. Default SIGTERM. */
  signal?: NodeJS.Signals;
  /** Grace period before escalating to force-kill. Default 5000ms. */
  graceMs?: number;
}

/**
 * The one and only subprocess boundary for the Pan Desktop main process.
 *
 * Feature code MUST NOT call `child_process.spawn` / `execFile` / `exec`
 * directly, and MUST NOT call `process.kill` or `proc.kill("SIGKILL")`
 * directly. All subprocess work goes through a ProcessRunner so:
 *
 *   1. Windows and POSIX have one consistent entry point
 *   2. tree-kill handles process tree termination correctly per-OS
 *      (POSIX process groups, Windows `taskkill /F /T`)
 *   3. Shell strings never reach a shell — every call is argv-based
 *   4. An adapter-injected PATH makes user-installed tools discoverable
 *
 * See docs/ARCHITECTURE_OVERVIEW.md §Process runner boundary.
 */
export interface ProcessRunner {
  /**
   * Run a command to completion, capture stdout/stderr, return RunResult.
   * Uses execFile under the hood — never spawns a shell. Arguments MUST be
   * provided as an array; there is no `shell: true` mode.
   */
  run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult>;

  /**
   * Spawn a streaming subprocess. Caller gets the handle back so they can
   * pipe events or call killTree on it later. Use this for long-running
   * processes like the Hermes gateway or Claw3D dev server.
   */
  spawnStreaming(
    command: string,
    args: readonly string[],
    options?: SpawnStreamingOptions,
  ): ChildProcess;

  /**
   * Resolve an executable name to an absolute path by searching the
   * adapter's systemPathExtras + the current PATH. Returns null if not
   * found. Cross-platform: handles Windows executable extensions.
   */
  findExecutable(name: string): Promise<string | null>;

  /**
   * Terminate a process and all of its descendants. On POSIX this uses
   * tree-kill which walks the process tree with `ps` + SIGTERM then SIGKILL.
   * On Windows it calls `taskkill /F /T /PID <pid>`. Both cases respect a
   * grace period before escalating to force kill.
   *
   * This is the ONLY approved way to terminate a process in Pan Desktop.
   * Direct `proc.kill(...)` / `process.kill(-pid, ...)` are banned by ESLint
   * rule (see eslint.config.mjs).
   */
  killTree(
    processOrPid: ChildProcess | number,
    options?: KillTreeOptions,
  ): Promise<void>;
}

export interface CreateProcessRunnerOptions {
  adapter: PlatformAdapter;
}

/**
 * Construct a ProcessRunner backed by the given PlatformAdapter.
 *
 * All methods are closures over the adapter so tests can inject a mock
 * adapter with a specific platform + PATH and exercise cross-platform
 * behavior on a single host.
 */
export function createProcessRunner(
  options: CreateProcessRunnerOptions,
): ProcessRunner {
  const { adapter } = options;

  const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
  const DEFAULT_KILL_GRACE_MS = 5000;

  const run = (
    command: string,
    args: readonly string[],
    opts: RunOptions = {},
  ): Promise<RunResult> => {
    return new Promise((resolve, reject) => {
      const execOpts: ExecFileOptions = {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        // Never `shell: true`. No interpolation through a shell.
        shell: false,
        windowsHide: true,
      };

      execFile(command, [...args], execOpts, (err, stdout, stderr) => {
        const stdoutStr =
          typeof stdout === "string" ? stdout : stdout.toString("utf8");
        const stderrStr =
          typeof stderr === "string" ? stderr : stderr.toString("utf8");

        if (err) {
          // execFile sets .code and .signal on the error. Surface them as a
          // structured result for the error case too, then reject with a
          // helpful message.
          const exitCode =
            typeof (err as NodeJS.ErrnoException).code === "number"
              ? ((err as NodeJS.ErrnoException).code as unknown as number)
              : null;
          const signal = (err as { signal?: NodeJS.Signals }).signal ?? null;
          const rejectError = new Error(
            `ProcessRunner.run(${command}) failed: ${err.message}`,
          );
          (rejectError as Error & { stdout?: string; stderr?: string }).stdout =
            stdoutStr;
          (rejectError as Error & { stdout?: string; stderr?: string }).stderr =
            stderrStr;
          (rejectError as Error & { exitCode?: number | null }).exitCode =
            exitCode;
          (rejectError as Error & { signal?: NodeJS.Signals | null }).signal =
            signal;
          reject(rejectError);
          return;
        }

        resolve({
          stdout: stdoutStr,
          stderr: stderrStr,
          exitCode: 0,
          signal: null,
        });
      });
    });
  };

  const spawnStreaming = (
    command: string,
    args: readonly string[],
    opts: SpawnStreamingOptions = {},
  ): ChildProcess => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // `detached: false` (the default). We deliberately DO NOT promote
      // children to their own process group on POSIX because:
      //   1. tree-kill walks the process tree via `ps` / `taskkill /T`
      //      and does not need the child to be a group leader
      //   2. a detached child does NOT receive SIGTERM/SIGINT when its
      //      parent (the Electron main process) exits naturally, which
      //      leaks the Hermes gateway and Claw3D dev server every time
      //      the user closes the app
      //   3. Windows `detached: true` has different semantics (console
      //      detach) and is equally unwanted here
    };
    // Prevent the unused adapter variable from triggering a lint warning
    // in the meantime — we keep adapter in the signature because future
    // tweaks (per-platform env transforms) will need it.
    void adapter;

    const child = spawn(command, [...args], spawnOpts);

    if (opts.onStdout) {
      child.stdout?.on("data", (chunk: Buffer) => {
        opts.onStdout!(chunk.toString("utf8"));
      });
    }
    if (opts.onStderr) {
      child.stderr?.on("data", (chunk: Buffer) => {
        opts.onStderr!(chunk.toString("utf8"));
      });
    }

    return child;
  };

  const findExecutable = async (name: string): Promise<string | null> => {
    // Build the full candidate directory list: extras first, then PATH.
    // PATH comes from the adapter (not process.env directly) so tests
    // that inject an envPath fixture exercise the cross-platform logic
    // without mutating the real environment. Fixes HIGH review finding #1.
    const dirs = [
      ...adapter.systemPathExtras(),
      ...adapter.pathEntries(),
    ].filter((d) => d.length > 0);

    // Build the candidate filename list. On Windows we try every script
    // extension; on Unix we just try the bare name (it either has the bit
    // set or it doesn't).
    const nameCandidates = adapter.scriptExtensionCandidates.map((ext) =>
      ext.length === 0 ? name : `${name}${ext}`,
    );

    for (const dir of dirs) {
      for (const candidate of nameCandidates) {
        const full = join(dir, candidate);
        if (existsSync(full)) {
          return full;
        }
      }
    }

    return null;
  };

  const killTree = (
    processOrPid: ChildProcess | number,
    opts: KillTreeOptions = {},
  ): Promise<void> => {
    const pid =
      typeof processOrPid === "number" ? processOrPid : processOrPid.pid;

    if (pid === undefined || pid === null) {
      // Nothing to kill. Happens for already-exited children.
      return Promise.resolve();
    }

    const signal = opts.signal ?? "SIGTERM";
    const graceMs = opts.graceMs ?? DEFAULT_KILL_GRACE_MS;

    return new Promise((resolve) => {
      // Track whether we've resolved yet so the escalation timer can't
      // double-resolve.
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      // Schedule force-kill as a backstop. If the graceful signal succeeds,
      // we clearTimeout it; if the graceful signal errors with "process
      // doesn't exist", we short-circuit and settle immediately rather
      // than waiting out the grace period.
      const forceTimer = setTimeout(() => {
        treeKill(pid, "SIGKILL", () => settle());
      }, graceMs);
      // Don't block Node from exiting on the timer.
      forceTimer.unref();

      treeKill(pid, signal, (err?: Error) => {
        if (!err) {
          clearTimeout(forceTimer);
          settle();
          return;
        }
        // Recognise "process already gone" and short-circuit. The exact
        // message/code varies by OS and tool: ESRCH on POSIX, "No running
        // instance" / 128 on Windows taskkill, "kill ESRCH" from Node.
        // When the target doesn't exist, there's nothing to escalate to —
        // settle immediately instead of waiting out graceMs.
        const msg = (err?.message ?? "").toLowerCase();
        const alreadyGone =
          msg.includes("esrch") ||
          msg.includes("no such process") ||
          msg.includes("not found") ||
          msg.includes("no running instance");
        if (alreadyGone) {
          clearTimeout(forceTimer);
          settle();
          return;
        }
        // Other errors (permission denied, etc.): let the force timer
        // escalate. If SIGKILL also fails, we still settle so the caller
        // isn't hung forever.
      });
    });
  };

  return {
    run,
    spawnStreaming,
    findExecutable,
    killTree,
  };
}
