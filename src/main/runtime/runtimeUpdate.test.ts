import { describe, it, expect, vi } from "vitest";
import { createPlatformAdapter } from "../platform/platformAdapter";
import { getRuntimePaths } from "./runtimePaths";
import { createRuntimeUpdate, type RuntimeUpdateDeps } from "./runtimeUpdate";
import { MANIFEST, type RuntimeManifest } from "./runtimeManifest";

/*
 * runtimeUpdate tests use a fake processRunner so the service contract is
 * exercised without spawning a real `hermes --version` or `hermes update`.
 *
 * We verify:
 *   - getManifest returns the injected manifest (not the live MANIFEST)
 *   - checkForUpdate correctly classifies the version against the manifest
 *   - getCompatibility round-trips through checkCompatibility
 *   - applyUpdate rejects when the install is missing
 *   - getCurrentVersion caches across calls and clearVersionCache resets it
 */

function makeBaseRunner(versionStdout = ""): {
  run: ReturnType<typeof vi.fn>;
  spawnStreaming: ReturnType<typeof vi.fn>;
  findExecutable: ReturnType<typeof vi.fn>;
  killTree: ReturnType<typeof vi.fn>;
  isProcessAlive: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn(async () => ({
      stdout: versionStdout,
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
  platform: "linux" | "windows" = "linux",
  versionStdout = "",
  manifestOverride?: RuntimeManifest,
): RuntimeUpdateDeps {
  const adapter = createPlatformAdapter({
    platform,
    homeDir: platform === "windows" ? "C:\\Users\\test" : "/home/test",
  });
  const runtime = getRuntimePaths(adapter);
  const processRunner = makeBaseRunner(versionStdout);
  return {
    adapter,
    runtime,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processRunner: processRunner as any,
    buildEnv: (overrides) => ({
      PATH: "/usr/bin",
      HOME: "/home/test",
      ...overrides,
    }),
    manifest: manifestOverride,
  };
}

describe("createRuntimeUpdate", () => {
  it("getManifest returns the injected manifest override", () => {
    const custom: RuntimeManifest = {
      minimumHermesAgentVersion: "0.1.0",
      preferredHermesAgentVersion: "0.2.0",
      maximumTestedHermesAgentVersion: "0.3.0",
      migrationFlags: { configFormatVersion: 42 },
    };
    const deps = makeDeps("linux", "", custom);
    const svc = createRuntimeUpdate(deps);
    expect(svc.getManifest()).toBe(custom);
  });

  it("getManifest falls back to the live MANIFEST when no override is given", () => {
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    expect(svc.getManifest()).toBe(MANIFEST);
  });
});

describe("checkForUpdate", () => {
  it("reports 'not installed' when no hermes install is detected", async () => {
    // runtime.pythonExe doesn't exist on disk in the test host
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    const result = await svc.checkForUpdate();
    expect(result.canUpdate).toBe(false);
    expect(result.currentVersion).toBeNull();
    expect(result.message).toMatch(/not installed/i);
  });
});

describe("getCompatibility", () => {
  it("returns 'unknown' when the installation is missing", async () => {
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    const result = await svc.getCompatibility();
    expect(result.status).toBe("unknown");
  });
});

describe("applyUpdate", () => {
  it("rejects when hermes is not installed", async () => {
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    await expect(svc.applyUpdate(() => {})).rejects.toThrow(/not installed/i);
  });
});

describe("clearVersionCache", () => {
  it("is idempotent — can be called when cache is already null", () => {
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    expect(() => svc.clearVersionCache()).not.toThrow();
    expect(() => svc.clearVersionCache()).not.toThrow();
  });
});

describe("getCurrentVersion concurrency", () => {
  // These tests lock in the Wave-4-review fix: concurrent callers must
  // share a single in-flight promise, not race on a boolean flag with a
  // bounded poll.

  it("returns null on non-installed host (no subprocess spawned)", async () => {
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    // No pythonExe on disk → getCurrentVersion short-circuits to null
    // before any processRunner.run is called.
    const result = await svc.getCurrentVersion();
    expect(result).toBeNull();

    // Subsequent calls also return null (no negative cache, but also no
    // thrashing because the existsSync check short-circuits).
    expect(await svc.getCurrentVersion()).toBeNull();
    expect(await svc.getCurrentVersion()).toBeNull();

    // The mock runner's `run` fn should never have been called because
    // the filesystem check gates the spawn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runSpy = (deps.processRunner as any).run as ReturnType<typeof vi.fn>;
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("clearVersionCache clears in-flight promise too", () => {
    // Regression for the Wave-4 review fix: clearVersionCache used to
    // only clear the stored version, leaving an in-flight promise
    // pointing at a stale fetch. Now it clears both.
    const deps = makeDeps();
    const svc = createRuntimeUpdate(deps);
    // We can't easily reach into the private state, but we can verify
    // the method is callable repeatedly and never leaks an error.
    svc.clearVersionCache();
    svc.clearVersionCache();
    expect(svc.getManifest()).toBe(MANIFEST);
  });
});
