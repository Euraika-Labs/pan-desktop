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
      // Create a temp binary file and a mock adapter whose systemPathExtras
      // points at the temp directory. findExecutable should resolve it.
      const tempDir = mkdtempSync(join(tmpdir(), "pan-desktop-find-"));
      const binPath = join(tempDir, "mockbin");
      writeFileSync(binPath, "#!/bin/sh\nexit 0\n");
      chmodSync(binPath, 0o755);

      const mockAdapter = {
        ...createPlatformAdapter(),
        systemPathExtras: (): readonly string[] => [tempDir],
      };
      const mockRunner = createProcessRunner({ adapter: mockAdapter });

      const found = await mockRunner.findExecutable("mockbin");
      expect(found).toBe(binPath);
    });
  });

  describe("killTree()", () => {
    it("handles a pid that doesn't exist without throwing", async () => {
      // A very large pid that won't exist on any real system.
      // killTree should resolve cleanly (no process to kill).
      await expect(runner.killTree(99999999)).resolves.toBeUndefined();
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
