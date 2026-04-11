import { describe, it, expect, vi } from "vitest";
import { createPlatformAdapter } from "../platform/platformAdapter";
import {
  createRuntimeInstaller,
  type RuntimeInstallerDeps,
} from "./runtimeInstaller";
import { getRuntimePaths } from "./runtimePaths";

/*
 * runtimeInstaller tests use a fixture-injected ProcessRunner so they
 * don't actually spawn bash or curl. We verify:
 *   - the factory picks the right strategy per platform
 *   - WindowsInstallerStrategy.install throws a clear error (for M1)
 *   - prerequisites() reports missing tools via the mock findExecutable
 *   - isInstalled() reflects the filesystem state of pythonExe + hermesCli
 *   - doctor() routes through processRunner.run
 */

function makeMockProcessRunner(
  overrides: Partial<ReturnType<typeof makeBaseRunner>> = {},
): ReturnType<typeof makeBaseRunner> {
  return { ...makeBaseRunner(), ...overrides };
}

function makeBaseRunner(): {
  run: ReturnType<typeof vi.fn>;
  spawnStreaming: ReturnType<typeof vi.fn>;
  findExecutable: ReturnType<typeof vi.fn>;
  killTree: ReturnType<typeof vi.fn>;
  isProcessAlive: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
    })),
    spawnStreaming: vi.fn(() => {
      throw new Error("spawnStreaming must be mocked per-test when used");
    }),
    findExecutable: vi.fn(async () => "/usr/bin/mock"),
    killTree: vi.fn(async () => undefined),
    isProcessAlive: vi.fn(() => false),
  };
}

function makeDeps(
  platform: "linux" | "macos" | "windows",
  runnerOverrides: Partial<ReturnType<typeof makeBaseRunner>> = {},
): RuntimeInstallerDeps {
  const adapter = createPlatformAdapter({
    platform,
    homeDir: platform === "windows" ? "C:\\Users\\test" : "/home/test",
  });
  const runtime = getRuntimePaths(adapter);
  const processRunner = makeMockProcessRunner(runnerOverrides);
  return {
    adapter,
    runtime,
    // Vitest types and the ProcessRunner interface don't perfectly align
    // (our mock returns a slimmed shape) — cast through unknown once so
    // the deps object satisfies the interface for the tests' purposes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processRunner: processRunner as any,
    buildEnv: (overrides) => ({
      PATH: "/usr/bin",
      HOME: "/home/test",
      ...overrides,
    }),
  };
}

describe("createRuntimeInstaller factory", () => {
  it("picks UnixInstallerStrategy on linux", () => {
    const deps = makeDeps("linux");
    const installer = createRuntimeInstaller(deps);
    // Unix strategy advertises prerequisites for bash/curl/git.
    // We don't expose the class names, so just verify the behaviour:
    // install() on linux should NOT throw the Windows sentinel error.
    expect(installer).toBeDefined();
    // prerequisites() should call findExecutable for bash, curl, git.
    // We'll verify this in a dedicated test below.
  });

  it("picks UnixInstallerStrategy on macos", () => {
    const deps = makeDeps("macos");
    expect(() => createRuntimeInstaller(deps)).not.toThrow();
  });

  it("picks WindowsInstallerStrategy on windows", () => {
    const deps = makeDeps("windows");
    expect(() => createRuntimeInstaller(deps)).not.toThrow();
  });
});

describe("UnixInstallerStrategy.prerequisites", () => {
  it("reports no missing prerequisites when all tools are found", async () => {
    const deps = makeDeps("linux", {
      findExecutable: vi.fn(async () => "/usr/bin/mock"),
    });
    const installer = createRuntimeInstaller(deps);
    const report = await installer.prerequisites();
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("reports missing bash / curl / git when findExecutable returns null", async () => {
    const deps = makeDeps("linux", {
      findExecutable: vi.fn(async () => null),
    });
    const installer = createRuntimeInstaller(deps);
    const report = await installer.prerequisites();
    expect(report.ok).toBe(false);
    expect(report.missing).toContain("bash");
    expect(report.missing).toContain("curl");
    expect(report.missing).toContain("git");
    expect(report.hints.git).toBeTruthy();
  });

  it("reports only the tools that are actually missing", async () => {
    // Return null for curl specifically, found for everything else.
    const deps = makeDeps("linux", {
      findExecutable: vi.fn(async (name: string) =>
        name === "curl" ? null : "/usr/bin/" + name,
      ),
    });
    const installer = createRuntimeInstaller(deps);
    const report = await installer.prerequisites();
    expect(report.missing).toEqual(["curl"]);
    expect(report.ok).toBe(false);
  });
});

describe("WindowsInstallerStrategy", () => {
  const deps = makeDeps("windows");
  const installer = createRuntimeInstaller(deps);

  it("install() throws a clear error directing users to Git Bash / WSL", async () => {
    await expect(installer.install(() => {})).rejects.toThrow(/Git Bash|WSL/i);
  });

  it("repair() throws a clear error", async () => {
    await expect(installer.repair(() => {})).rejects.toThrow(/Windows|repair/i);
  });

  it("prerequisites() checks for git and returns ok when found", async () => {
    const depsWithGit = makeDeps("windows", {
      findExecutable: vi.fn(async () => "C:\\Program Files\\Git\\bin\\git.exe"),
    });
    const installerWithGit = createRuntimeInstaller(depsWithGit);
    const report = await installerWithGit.prerequisites();
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("prerequisites() reports git as missing when not found", async () => {
    const depsNoGit = makeDeps("windows", {
      findExecutable: vi.fn(async () => null),
    });
    const installerNoGit = createRuntimeInstaller(depsNoGit);
    const report = await installerNoGit.prerequisites();
    expect(report.ok).toBe(false);
    expect(report.missing).toContain("git");
    expect(report.hints.git).toMatch(/Git for Windows/);
  });
});

describe("isInstalled()", () => {
  it("returns false when no python binary is on disk", () => {
    // Real adapter + runtime, on a test host with no ~/.hermes install
    const deps = makeDeps("linux");
    const installer = createRuntimeInstaller(deps);
    expect(installer.isInstalled()).toBe(false);
  });
});

describe("doctor()", () => {
  it("returns a placeholder message when Hermes is not installed", async () => {
    const deps = makeDeps("linux");
    const installer = createRuntimeInstaller(deps);
    const result = await installer.doctor();
    expect(result).toMatch(/not installed/i);
  });
});
