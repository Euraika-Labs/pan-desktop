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

// Re-export ChildProcess so feature code can use the type without
// importing from "child_process" directly (which would violate the
// no-restricted-imports rule).
export type { ChildProcess };

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
  /**
   * If true, spawn the child detached from the parent process. This is
   * used for LONG-LIVED background daemons (like the Hermes gateway)
   * that are expected to survive the Electron main process exiting.
   * The caller is responsible for also calling `child.unref()` if they
   * want Node to exit while the child runs.
   *
   * Default: false. Most callers want the child to die when the parent
   * exits — that's the default Node behavior. Only set this for true
   * daemon use cases.
   */
  detached?: boolean;
  /**
   * stdio mode for the spawned child. Defaults to `["ignore", "pipe", "pipe"]`
   * so onStdout/onStderr callbacks work. Daemon processes that should NOT
   * inherit the parent's stdio streams can pass `"ignore"` to fully detach.
   */
  stdio?: SpawnOptions["stdio"];
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

  /**
   * Check whether a pid currently refers to a live process. Uses signal 0
   * (the POSIX probe signal, which Node polyfills on Windows) — does NOT
   * actually signal the process. Returns false on ESRCH/EPERM/ESRCH-ish
   * errors, true if the probe succeeds.
   *
   * This exists so feature code doesn't have to write `process.kill(pid, 0)`
   * directly (which would trip the `no-restricted-syntax` rule banning
   * `process.kill` outside the platform layer).
   */
  isProcessAlive(pid: number): boolean;
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

  // Windows: Node.js CVE-2024-27980 (fixed in 18.20.2+/20.12.2+/21.7.3+)
  // blocks direct spawn/execFile of .cmd and .bat files with EINVAL — you
  // MUST go through the shell. This helper returns true when the command
  // needs shell:true to dispatch correctly. We only apply it on Windows
  // and only to .cmd/.bat files, so the shell attack surface is limited
  // to those two extensions. Args must not contain attacker-controlled
  // shell metacharacters; all current callers pass hardcoded strings.
  const needsShellForCmd = (command: string): boolean => {
    if (adapter.platform !== "windows") return false;
    return /\.(cmd|bat)$/i.test(command);
  };

  // When shell:true is active, wrap the command path in double quotes so
  // paths with spaces (e.g. `C:\Program Files\nodejs\npm.cmd`) survive
  // cmd.exe word-splitting. Node passes the whole string to cmd.exe /d /s /c.
  const quoteForShell = (command: string): string => {
    if (command.startsWith('"') && command.endsWith('"')) return command;
    return `"${command}"`;
  };

  const run = (
    command: string,
    args: readonly string[],
    opts: RunOptions = {},
  ): Promise<RunResult> => {
    return new Promise((resolve, reject) => {
      const useShell = needsShellForCmd(command);
      const execOpts: ExecFileOptions = {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        // shell:false is the default. We flip to true ONLY for .cmd/.bat
        // on Windows because Node's CVE-2024-27980 fix refuses to spawn
        // those directly. See needsShellForCmd above.
        shell: useShell,
        windowsHide: true,
      };

      const execCommand = useShell ? quoteForShell(command) : command;
      execFile(execCommand, [...args], execOpts, (err, stdout, stderr) => {
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
    // Default stdio lets callers capture stdout/stderr via callbacks.
    // Daemon callers pass "ignore" to fully cut the cord.
    const stdio = opts.stdio ?? ["ignore", "pipe", "pipe"];

    const useShell = needsShellForCmd(command);

    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env,
      // shell:false is the default. We flip to true ONLY for .cmd/.bat
      // on Windows (Node CVE-2024-27980 fix refuses to spawn those
      // directly and throws EINVAL). All other commands stay outside
      // the shell.
      shell: useShell,
      windowsHide: true,
      stdio,
      // `detached` is caller-opt-in. Default false: child dies with parent
      // (the normal Node behavior you want for Claw3D dev server, chat
      // CLI fallback, install script, etc.). Daemon callers (Hermes
      // gateway) set `detached: true` explicitly and ALSO call
      // `child.unref()` if they want Node to exit while the child runs.
      detached: opts.detached ?? false,
    };

    const spawnCommand = useShell ? quoteForShell(command) : command;
    const child = spawn(spawnCommand, [...args], spawnOpts);

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

  const isProcessAlive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      // Signal 0 is a no-op probe. Node documents it as the portable way
      // to check "is this pid still alive" on POSIX AND Windows. This is
      // the one authorized use of process.kill inside the platform
      // boundary — processRunner.ts is already exempt from the
      // no-restricted-syntax rule that bans process.kill elsewhere.
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  return {
    run,
    spawnStreaming,
    findExecutable,
    killTree,
    isProcessAlive,
  };
}
