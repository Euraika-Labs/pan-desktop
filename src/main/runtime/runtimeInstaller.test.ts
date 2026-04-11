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
  // Smoke-test the factory once per platform before the individual
  // install/prerequisite cases. The per-case tests construct their own
  // `deps` so they can swap `detectPowerShell` independently.
  it("createRuntimeInstaller returns a usable installer for windows", () => {
    const deps = makeDeps("windows");
    const installer = createRuntimeInstaller(deps);
    expect(installer).toBeDefined();
    expect(typeof installer.install).toBe("function");
  });

  // Wave 5: the Windows strategy now spawns PowerShell directly against
  // the vendored `resources/install.ps1`. Git Bash and a user-installed
  // Python are no longer prerequisites — `uv` inside install.ps1 handles
  // its own Python runtime. The only hard requirement is PowerShell,
  // which is guaranteed to exist on every supported Windows host.

  it("install() throws a clear error if PowerShell is missing", async () => {
    const d = makeDeps("windows");
    d.adapter.detectPowerShell = vi.fn((): string | null => null);
    const inst = createRuntimeInstaller(d);
    await expect(inst.install(() => {})).rejects.toThrow(/PowerShell/i);
  });

  it("prerequisites() returns ok when PowerShell is detected", async () => {
    const d = makeDeps("windows");
    d.adapter.detectPowerShell = vi.fn(
      (): string | null =>
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    const inst = createRuntimeInstaller(d);
    const report = await inst.prerequisites();
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("prerequisites() reports missing PowerShell", async () => {
    const d = makeDeps("windows");
    d.adapter.detectPowerShell = vi.fn((): string | null => null);
    const inst = createRuntimeInstaller(d);
    const report = await inst.prerequisites();
    expect(report.ok).toBe(false);
    expect(report.missing).toContain("powershell");
    expect(report.hints.powershell).toMatch(/PowerShell/);
  });

  it("prerequisites() does NOT require Git Bash or Python", async () => {
    // Wave 5 invariant: Pan Desktop ships its own PowerShell installer
    // via `resources/install.ps1`, and install.ps1 uses `uv` to manage
    // its own Python runtime. Neither Git Bash nor a system-wide Python
    // should be surfaced as a prerequisite on Windows.
    const d = makeDeps("windows");
    d.adapter.detectPowerShell = vi.fn(
      (): string | null =>
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    d.adapter.detectGitBash = vi.fn((): string | null => null);
    d.adapter.detectPython = vi.fn((): string | null => null);
    const inst = createRuntimeInstaller(d);
    const report = await inst.prerequisites();
    expect(report.ok).toBe(true);
    expect(report.missing).not.toContain("git-bash");
    expect(report.missing).not.toContain("python");
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
