/**
 * Unit tests for src/main/profiles.ts
 *
 * Strategy: mock the `./runtime/instance` module (runtime + processRunner)
 * and `./installer` (buildHermesEnv) so no real filesystem or subprocess
 * access happens. A small set of listProfiles() tests use real tmpdir
 * fixtures for the parts that hit `fs` directly (existsSync / readdir /
 * stat / readFile), because mocking the entire `fs` module in vitest is
 * verbose and fragile — real tmpdir gives us the same confidence.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Module mocks must be declared before any import that pulls the mocked
//    module transitively.  vi.mock() is hoisted by Vitest automatically.

vi.mock("./runtime/instance", () => ({
  runtime: {
    hermesHome: "/fake/hermes-home",
    profilesRoot: "/fake/hermes-home/profiles",
    hermesRepo: "/fake/hermes-repo",
    buildCliCmd: vi.fn(() => ({ command: "hermes", args: [] })),
  },
  processRunner: {
    run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0, signal: null })),
    isProcessAlive: vi.fn(() => false),
  },
}));

vi.mock("./installer", () => ({
  buildHermesEnv: vi.fn(() => ({})),
}));

// Import the subjects AFTER mocks are declared
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "./profiles";
import { runtime, processRunner } from "./runtime/instance";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal on-disk Hermes home that listProfiles() can walk.
 * Returns the root temp directory; caller must clean up.
 */
function makeHermesHome(): {
  root: string;
  profilesRoot: string;
} {
  const root = mkdtempSync(join(tmpdir(), "pan-profiles-test-"));
  const profilesRoot = join(root, "profiles");
  mkdirSync(profilesRoot, { recursive: true });
  return { root, profilesRoot };
}

function writeConfig(dir: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.yaml"), content);
}

// ─────────────────────────────────────────────────────────────────────────────
// listProfiles()
// ─────────────────────────────────────────────────────────────────────────────

describe("listProfiles()", () => {
  let tempRoot: string;
  let profilesRoot: string;

  beforeEach(() => {
    ({ root: tempRoot, profilesRoot } = makeHermesHome());

    // Point the mocked runtime at our temp directory
    (runtime as unknown as Record<string, unknown>).hermesHome = tempRoot;
    (runtime as unknown as Record<string, unknown>).profilesRoot = profilesRoot;
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("always includes the 'default' profile (hermesHome itself)", async () => {
    const profiles = await listProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(1);
    const def = profiles.find((p) => p.name === "default");
    expect(def).toBeDefined();
    expect(def?.isDefault).toBe(true);
    expect(def?.path).toBe(tempRoot);
  });

  it("default profile isActive when no active_profile file exists", async () => {
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.isActive).toBe(true);
  });

  it("default profile isActive = false when active_profile names a different profile", async () => {
    writeFileSync(join(tempRoot, "active_profile"), "work");
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.isActive).toBe(false);
  });

  it("reads model + provider from config.yaml in hermesHome", async () => {
    writeConfig(tempRoot, "models:\n  default: claude-3-5-sonnet\nprovider: anthropic\n");
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.model).toBe("claude-3-5-sonnet");
    expect(def.provider).toBe("anthropic");
  });

  it("model/provider are empty strings when config.yaml is absent", async () => {
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.model).toBe("");
    // provider falls back to "" when readProfileConfig catches
    // (the file doesn't exist so it returns { model: "", provider: "" })
    expect(def.provider).toBe("");
  });

  it("hasEnv = true when .env file exists in hermesHome", async () => {
    writeFileSync(join(tempRoot, ".env"), "ANTHROPIC_API_KEY=sk-test\n");
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.hasEnv).toBe(true);
  });

  it("hasEnv = false when .env file is absent", async () => {
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.hasEnv).toBe(false);
  });

  it("hasSoul = true when SOUL.md exists in hermesHome", async () => {
    writeFileSync(join(tempRoot, "SOUL.md"), "# Soul\n");
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.hasSoul).toBe(true);
  });

  it("returns only the default profile when profiles/ dir is empty", async () => {
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
  });

  it("skips profile dirs that have neither config.yaml nor .env", async () => {
    // Create a bare directory — no config.yaml, no .env
    mkdirSync(join(profilesRoot, "bare-dir"), { recursive: true });
    const profiles = await listProfiles();
    expect(profiles.every((p) => p.name !== "bare-dir")).toBe(true);
  });

  it("includes named profiles that have config.yaml", async () => {
    const workDir = join(profilesRoot, "work");
    writeConfig(workDir, "models:\n  default: claude-opus-4\nprovider: anthropic\n");
    const profiles = await listProfiles();
    const work = profiles.find((p) => p.name === "work");
    expect(work).toBeDefined();
    expect(work?.isDefault).toBe(false);
    expect(work?.path).toBe(workDir);
    expect(work?.model).toBe("claude-opus-4");
  });

  it("includes named profiles that have only .env (no config.yaml)", async () => {
    const devDir = join(profilesRoot, "dev");
    mkdirSync(devDir, { recursive: true });
    writeFileSync(join(devDir, ".env"), "ANTHROPIC_API_KEY=sk-dev\n");
    const profiles = await listProfiles();
    const dev = profiles.find((p) => p.name === "dev");
    expect(dev).toBeDefined();
    expect(dev?.hasEnv).toBe(true);
  });

  it("marks the correct named profile as active", async () => {
    writeFileSync(join(tempRoot, "active_profile"), "work\n");
    const workDir = join(profilesRoot, "work");
    writeConfig(workDir, "");
    const profiles = await listProfiles();
    const work = profiles.find((p) => p.name === "work")!;
    expect(work.isActive).toBe(true);
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.isActive).toBe(false);
  });

  it("handles missing profilesRoot gracefully (returns only default)", async () => {
    // Point profilesRoot at a path that does not exist
    (runtime as unknown as Record<string, unknown>).profilesRoot = join(
      tempRoot,
      "nonexistent-profiles",
    );
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("default");
  });

  it("skillCount reflects nested SKILL.md files", async () => {
    // Layout: hermesHome/skills/<vendor>/<skillName>/SKILL.md
    const skillsDir = join(tempRoot, "skills", "anthropic", "my-skill");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), "# Skill\n");
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.skillCount).toBe(1);
  });

  it("gatewayRunning = false when no gateway.pid file exists", async () => {
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.name === "default")!;
    expect(def.gatewayRunning).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createProfile()
// ─────────────────────────────────────────────────────────────────────────────

describe("createProfile()", () => {
  const mockRun = processRunner.run as MockedFunction<typeof processRunner.run>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, signal: null });
  });

  it("calls processRunner.run with 'profile create <name>' args", async () => {
    const result = await createProfile("work", false);
    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledOnce();
    const [, args] = mockRun.mock.calls[0];
    expect(args).toContain("profile");
    expect(args).toContain("create");
    expect(args).toContain("work");
    expect(args).not.toContain("--clone");
  });

  it("appends --clone flag when clone=true", async () => {
    await createProfile("work-clone", true);
    const [, args] = mockRun.mock.calls[0];
    expect(args).toContain("--clone");
  });

  it("returns success=false with error message when processRunner throws", async () => {
    mockRun.mockRejectedValueOnce({ stderr: "profile already exists", message: "" });
    const result = await createProfile("dupe", false);
    expect(result.success).toBe(false);
    expect(result.error).toContain("profile already exists");
  });

  it("returns success=false using message when stderr is absent", async () => {
    mockRun.mockRejectedValueOnce(new Error("spawn failed"));
    const result = await createProfile("bad", false);
    expect(result.success).toBe(false);
    expect(result.error).toContain("spawn failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteProfile()
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteProfile()", () => {
  const mockRun = processRunner.run as MockedFunction<typeof processRunner.run>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, signal: null });
  });

  it("cannot delete the default profile", async () => {
    const result = await deleteProfile("default");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot delete the default profile/i);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("calls processRunner.run with 'profile delete <name> --yes'", async () => {
    const result = await deleteProfile("work");
    expect(result.success).toBe(true);
    const [, args] = mockRun.mock.calls[0];
    expect(args).toContain("profile");
    expect(args).toContain("delete");
    expect(args).toContain("work");
    expect(args).toContain("--yes");
  });

  it("returns success=false with error when subprocess fails", async () => {
    mockRun.mockRejectedValueOnce({ stderr: "profile not found", message: "" });
    const result = await deleteProfile("ghost");
    expect(result.success).toBe(false);
    expect(result.error).toContain("profile not found");
  });

  it("treats the 'Default' (capital D) profile the same as a normal named profile", async () => {
    // Only the exact string "default" (lowercase) is protected
    const result = await deleteProfile("Default");
    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setActiveProfile()
// ─────────────────────────────────────────────────────────────────────────────

describe("setActiveProfile()", () => {
  const mockRun = processRunner.run as MockedFunction<typeof processRunner.run>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, signal: null });
  });

  it("calls processRunner.run with 'profile use <name>'", async () => {
    await setActiveProfile("work");
    expect(mockRun).toHaveBeenCalledOnce();
    const [, args] = mockRun.mock.calls[0];
    expect(args).toContain("profile");
    expect(args).toContain("use");
    expect(args).toContain("work");
  });

  it("does not throw when processRunner rejects (fire-and-forget semantics)", async () => {
    mockRun.mockRejectedValueOnce(new Error("subprocess exploded"));
    await expect(setActiveProfile("broken")).resolves.toBeUndefined();
  });

  it("does not throw when switching to 'default'", async () => {
    await expect(setActiveProfile("default")).resolves.toBeUndefined();
    const [, args] = mockRun.mock.calls[0];
    expect(args).toContain("default");
  });
});
