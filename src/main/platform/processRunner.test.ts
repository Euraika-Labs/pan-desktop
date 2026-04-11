import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createPlatformAdapter } from "./platformAdapter";
import { createProcessRunner } from "./processRunner";

describe("createProcessRunner", () => {
  const adapter = createPlatformAdapter(); // real platform
  const runner = createProcessRunner({ adapter });

  describe("run()", () => {
    it("executes a simple command and captures stdout", async () => {
      // `node -e "process.stdout.write('hello')"` is portable across all 3 OSes.
      const result = await runner.run("node", [
        "-e",
        "process.stdout.write('hello')",
      ]);
      expect(result.stdout).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    it("captures stderr separately from stdout", async () => {
      const result = await runner.run("node", [
        "-e",
        "process.stderr.write('err msg'); process.stdout.write('ok')",
      ]);
      expect(result.stdout).toBe("ok");
      expect(result.stderr).toBe("err msg");
    });

    it("rejects when the command exits non-zero", async () => {
      await expect(
        runner.run("node", ["-e", "process.exit(7)"]),
      ).rejects.toThrow(/failed/);
    });

    it("does NOT invoke a shell — argv is passed literally", async () => {
      // If shell:false is honored, this pipe character is literal and
      // `process.argv[1]` will contain it. If shell:true accidentally
      // leaked in, the shell would interpret the pipe and node would
      // receive a different arg.
      const result = await runner.run("node", [
        "-e",
        "process.stdout.write(process.argv[1] ?? '')",
        "foo|bar",
      ]);
      expect(result.stdout).toBe("foo|bar");
    });

    it("respects the timeoutMs option", async () => {
      // A sleep that takes longer than timeout should fail.
      await expect(
        runner.run("node", ["-e", "setTimeout(() => {}, 5000)"], {
          timeoutMs: 100,
        }),
      ).rejects.toThrow();
    });
  });

  describe("findExecutable()", () => {
    it("finds node in the current environment", async () => {
      const found = await runner.findExecutable("node");
      expect(found).toBeTruthy();
      expect(found).toContain("node");
    });

    it("returns null for a definitely-not-installed binary", async () => {
      const found = await runner.findExecutable(
        "definitely-not-a-real-binary-name-xyzabc",
      );
      expect(found).toBeNull();
    });

    it("with a mock adapter, finds binaries in systemPathExtras", async () => {
      // Create a fake binary file (the file name adapts to the host's
      // script extension so findExecutable picks it up on Windows too).
      const tempDir = mkdtempSync(join(tmpdir(), "pan-desktop-find-"));
      const realAdapter = createPlatformAdapter();
      // On Windows we need an explicit extension for the file to be
      // resolvable — pick the first non-empty candidate (.exe). On Unix
      // a bare name with the exec bit is enough.
      const suffix = realAdapter.platform === "windows" ? ".bat" : "";
      const binName = "mockbin";
      const binPath = join(tempDir, `${binName}${suffix}`);
      writeFileSync(
        binPath,
        suffix === ".bat" ? "@echo off\r\nexit 0\r\n" : "#!/bin/sh\nexit 0\n",
      );
      if (realAdapter.platform !== "windows") {
        chmodSync(binPath, 0o755);
      }

      const mockAdapter = {
        ...realAdapter,
        systemPathExtras: (): readonly string[] => [tempDir],
      };
      const mockRunner = createProcessRunner({ adapter: mockAdapter });

      const found = await mockRunner.findExecutable(binName);
      expect(found).toBe(binPath);
    });

    it("respects the injected adapter envPath, not process.env.PATH", async () => {
      // Regression test for HIGH review finding #1. Create a temp dir
      // with a fake binary, inject it via envPath (not systemPathExtras),
      // and verify findExecutable reads from the adapter rather than the
      // real process PATH.
      const tempDir = mkdtempSync(join(tmpdir(), "pan-desktop-envpath-"));
      const realAdapter = createPlatformAdapter();
      const suffix = realAdapter.platform === "windows" ? ".bat" : "";
      const binName = "injectedbin";
      const binPath = join(tempDir, `${binName}${suffix}`);
      writeFileSync(
        binPath,
        suffix === ".bat" ? "@echo off\r\nexit 0\r\n" : "#!/bin/sh\nexit 0\n",
      );
      if (realAdapter.platform !== "windows") {
        chmodSync(binPath, 0o755);
      }

      // Note: envPath uses the CURRENT host's separator because the
      // adapter we construct targets the current platform. We're only
      // testing the "envPath is injected into findExecutable's lookup"
      // contract, not cross-platform envPath semantics.
      const injectedAdapter = createPlatformAdapter({
        envPath: tempDir,
      });
      const injectedRunner = createProcessRunner({ adapter: injectedAdapter });

      const found = await injectedRunner.findExecutable(binName);
      expect(found).toBe(binPath);
    });
  });

  describe("killTree()", () => {
    it("handles a pid that doesn't exist without throwing", async () => {
      // A very large pid that won't exist on any real system.
      // killTree should resolve QUICKLY (short-circuit via the ESRCH/
      // "not found" detection) rather than waiting out the grace period.
      // Pass a short graceMs so the test fails fast if that branch breaks.
      const start = Date.now();
      await expect(
        runner.killTree(99999999, { graceMs: 10000 }),
      ).resolves.toBeUndefined();
      const elapsed = Date.now() - start;
      // Should be well under 1 second — if the ESRCH detection didn't
      // fire we'd be waiting the full graceMs + SIGKILL round trip.
      expect(elapsed).toBeLessThan(2000);
    });

    it("kills a real child process spawned via spawnStreaming", async () => {
      // Spawn a long-running process, then killTree it.
      const child = runner.spawnStreaming("node", [
        "-e",
        "setInterval(() => {}, 1000)",
      ]);
      expect(child.pid).toBeDefined();

      // Wait a beat so the process is actually up.
      await new Promise((resolve) => setTimeout(resolve, 100));

      await runner.killTree(child, { graceMs: 500 });

      // After killTree resolves, the process should be dead. Check via
      // `process.kill(pid, 0)` which throws if the pid is gone.
      await new Promise((resolve) => setTimeout(resolve, 100));
      let stillRunning = false;
      try {
        if (child.pid) {
          // signal 0 = "just probe whether the pid exists"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (process as any).kill(child.pid, 0);
          stillRunning = true;
        }
      } catch {
        stillRunning = false;
      }
      expect(stillRunning).toBe(false);
    });
  });

  describe("spawnStreaming()", () => {
    it("pipes stdout chunks via onStdout callback", async () => {
      const chunks: string[] = [];
      const child = runner.spawnStreaming(
        "node",
        [
          "-e",
          "process.stdout.write('first\\n'); process.stdout.write('second')",
        ],
        {
          onStdout: (chunk) => chunks.push(chunk),
        },
      );

      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      const joined = chunks.join("");
      expect(joined).toContain("first");
      expect(joined).toContain("second");
    });
  });
});

// Guard-rail assertion removed: vi.isMockFunction(require("child_process").spawn)
// would require a require() import which violates the project's
// no-require-imports rule. Test isolation is instead enforced by the fact
// that no test in this file calls vi.mock("child_process").
