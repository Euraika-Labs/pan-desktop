/**
 * Unit tests for src/main/skills.ts
 *
 * Strategy:
 *   - vi.mock("fs") to control the virtual filesystem seen by skills.ts
 *   - vi.mock("../src/main/runtime/instance") to inject a fake runtime
 *     and a mock processRunner without spawning real processes
 *   - vi.mock("../src/main/installer") to stub buildHermesEnv
 *   - vi.mock("../src/main/utils") to stub profileHome
 *
 * Path notes: skills.ts uses `join` from Node's "path" module directly,
 * so paths are OS-native (backslashes on Windows). All path construction
 * in this test file goes through real `path.join` so the mock keys match
 * exactly what skills.ts will look up.
 */
import { join } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  };
});

// vi.mock factories are hoisted to the top of the file by Vitest's transform,
// so they cannot reference module-level variables declared with const/let.
// All path constants used inside factories must be inline literals or
// computed via require() — here we use require("path").join so the
// Windows-vs-Unix separator is handled at factory evaluation time.

vi.mock("../src/main/runtime/instance", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  const home = join("C:", "hermes");
  const repo = join("C:", "hermes", "repo");
  return {
    runtime: {
      hermesHome: home,
      hermesRepo: repo,
      profileHome: (p?: string) =>
        p && p !== "default" ? join("C:", "hermes", "profiles", p) : home,
      buildCliCmd: () => ({ command: "hermes", args: [] }),
    },
    processRunner: {
      run: vi.fn(),
    },
  };
});

vi.mock("../src/main/installer", () => ({
  buildHermesEnv: vi.fn(() => ({ PATH: "/usr/bin", HOME: "/home/test" })),
}));

// profileHome in utils.ts must return the same base dir as runtime.profileHome.
vi.mock("../src/main/utils", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  return {
    profileHome: vi.fn((p?: string) =>
      p && p !== "default"
        ? join("C:", "hermes", "profiles", p)
        : join("C:", "hermes"),
    ),
    safeWriteFile: vi.fn(),
    join: (...args: string[]) => join(...args),
  };
});

// Compute base paths AFTER mocks are declared (these are used in test bodies,
// not in vi.mock factories, so hoisting is not an issue).
const HERMES_HOME = join("C:", "hermes");
const HERMES_REPO = join("C:", "hermes", "repo");

// ── Imports ──────────────────────────────────────────────────────────────────
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "../src/main/skills";
import { processRunner } from "../src/main/runtime/instance";

// ── Typed mock helpers ────────────────────────────────────────────────────────
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as ReturnType<typeof vi.fn>;
const mockRun = processRunner.run as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock stat that reports isDirectory() = isDirValue */
function fakeStat(isDir: boolean) {
  return { isDirectory: () => isDir };
}

/**
 * Configure mocks so that <baseDir>/skills/<category>/<skill>/SKILL.md
 * hierarchy is visible. Uses real path.join so Windows backslash paths match.
 *
 * skillsMap: { [category]: { [skillName]: SKILL.md content | null } }
 *   null → SKILL.md does not exist for that skill entry
 */
function setupSkillsFs(
  baseDir: string,
  skillsMap: Record<string, Record<string, string | null>>,
): void {
  const categories = Object.keys(skillsMap);
  const skillsDir = join(baseDir, "skills");

  mockExistsSync.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path === skillsDir) return true;
    for (const cat of categories) {
      for (const skill of Object.keys(skillsMap[cat])) {
        const skillMd = join(skillsDir, cat, skill, "SKILL.md");
        if (path === skillMd) return skillsMap[cat][skill] !== null;
      }
    }
    return false;
  });

  mockReaddirSync.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path === skillsDir) return categories;
    for (const cat of categories) {
      const catPath = join(skillsDir, cat);
      if (path === catPath) return Object.keys(skillsMap[cat]);
    }
    return [];
  });

  mockStatSync.mockImplementation((p: unknown) => {
    const path = String(p);
    for (const cat of categories) {
      const catPath = join(skillsDir, cat);
      if (path === catPath) return fakeStat(true);
      for (const skill of Object.keys(skillsMap[cat])) {
        const skillPath = join(skillsDir, cat, skill);
        if (path === skillPath) return fakeStat(true);
      }
    }
    return fakeStat(false);
  });

  mockReadFileSync.mockImplementation((p: unknown) => {
    const path = String(p);
    for (const cat of categories) {
      for (const skill of Object.keys(skillsMap[cat])) {
        const skillMd = join(skillsDir, cat, skill, "SKILL.md");
        if (path === skillMd) {
          const content = skillsMap[cat][skill];
          if (content === null) throw new Error("ENOENT");
          return content;
        }
      }
    }
    throw new Error(`ENOENT: ${path}`);
  });
}

// ── listInstalledSkills ───────────────────────────────────────────────────────
describe("listInstalledSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when skills directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const result = listInstalledSkills();

    expect(result).toEqual([]);
  });

  it("discovers skills using the <category>/<skill>/SKILL.md hierarchy", () => {
    setupSkillsFs(HERMES_HOME, {
      productivity: {
        "task-manager": `---
name: Task Manager
description: Manage tasks efficiently
---
# Task Manager
`,
      },
    });

    const result = listInstalledSkills();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Task Manager");
    expect(result[0].category).toBe("productivity");
    expect(result[0].description).toBe("Manage tasks efficiently");
    expect(result[0].path).toContain("task-manager");
  });

  it("discovers multiple categories and skills", () => {
    setupSkillsFs(HERMES_HOME, {
      dev: {
        "code-review": `---
name: Code Review
description: Review code
---
`,
        linting: `---
name: Linting
description: Lint code
---
`,
      },
      writing: {
        "blog-posts": `---
name: Blog Post Writer
description: Write blog posts
---
`,
      },
    });

    const result = listInstalledSkills();

    expect(result).toHaveLength(3);
    // Results are sorted by category then name
    expect(result[0].category).toBe("dev");
    expect(result[2].category).toBe("writing");
  });

  it("falls back to the directory name when name is absent from frontmatter", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "my-tool": `---
description: A handy tool
---
`,
      },
    });

    const result = listInstalledSkills();

    expect(result[0].name).toBe("my-tool");
    expect(result[0].description).toBe("A handy tool");
  });

  it("falls back to directory name and empty description when SKILL.md read throws", () => {
    const skillsDir = join(HERMES_HOME, "skills");
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === skillsDir) return true;
      if (path === join(skillsDir, "tools", "broken", "SKILL.md")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === skillsDir) return ["tools"];
      if (path === join(skillsDir, "tools")) return ["broken"];
      return [];
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === join(skillsDir, "tools")) return fakeStat(true);
      if (path === join(skillsDir, "tools", "broken")) return fakeStat(true);
      return fakeStat(false);
    });
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EPERM: permission denied");
    });

    const result = listInstalledSkills();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("broken");
    expect(result[0].description).toBe("");
  });

  it("skips entries that are not directories inside a category", () => {
    const skillsDir = join(HERMES_HOME, "skills");
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === skillsDir) return true;
      if (path === join(skillsDir, "tools", "real-skill", "SKILL.md"))
        return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === skillsDir) return ["tools"];
      if (path === join(skillsDir, "tools")) return ["README.md", "real-skill"];
      return [];
    });
    mockStatSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === join(skillsDir, "tools")) return fakeStat(true);
      if (path === join(skillsDir, "tools", "README.md")) return fakeStat(false); // file, not dir
      if (path === join(skillsDir, "tools", "real-skill")) return fakeStat(true);
      return fakeStat(false);
    });
    mockReadFileSync.mockReturnValue(`---
name: Real Skill
description: It works
---
`);

    const result = listInstalledSkills();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Real Skill");
  });

  it("skips skill entries that have no SKILL.md", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "has-skill": `---
name: Has Skill
description: Present
---
`,
        "no-skill": null,
      },
    });

    const result = listInstalledSkills();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Has Skill");
  });

  it("uses a named profile's skills directory when profile is given", () => {
    const profileHome = join("C:", "hermes", "profiles", "myprofile");
    const profileSkillsDir = join(profileHome, "skills");
    mockExistsSync.mockImplementation((p: unknown) =>
      String(p) === profileSkillsDir ? true : false,
    );
    mockReaddirSync.mockReturnValue([]);

    const result = listInstalledSkills("myprofile");

    // No skills returned for empty dir — just confirm no crash
    expect(result).toEqual([]);
  });

  it("returns skills sorted by category then name", () => {
    setupSkillsFs(HERMES_HOME, {
      zzz: {
        beta: `---
name: Beta
description: B
---
`,
        alpha: `---
name: Alpha
description: A
---
`,
      },
      aaa: {
        omega: `---
name: Omega
description: O
---
`,
      },
    });

    const result = listInstalledSkills();

    expect(result[0].category).toBe("aaa");
    expect(result[1].category).toBe("zzz");
    expect(result[1].name).toBe("Alpha");
    expect(result[2].name).toBe("Beta");
  });
});

// ── YAML frontmatter parsing (via listInstalledSkills) ────────────────────────
describe("SKILL.md YAML frontmatter parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses name and description from quoted frontmatter values", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "my-skill": `---
name: "Quoted Name"
description: "Quoted description here"
---
`,
      },
    });

    const result = listInstalledSkills();

    expect(result[0].name).toBe("Quoted Name");
    expect(result[0].description).toBe("Quoted description here");
  });

  it("parses name and description from single-quoted frontmatter values", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "my-skill": `---
name: 'Single Quoted'
description: 'Single quoted desc'
---
`,
      },
    });

    const result = listInstalledSkills();

    expect(result[0].name).toBe("Single Quoted");
    expect(result[0].description).toBe("Single quoted desc");
  });

  it("falls back to first heading when no frontmatter is present", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "heading-skill": `# My Heading Skill

This is the first paragraph description.
`,
      },
    });

    const result = listInstalledSkills();

    expect(result[0].name).toBe("My Heading Skill");
    expect(result[0].description).toBe(
      "This is the first paragraph description.",
    );
  });

  it("returns directory name when content has no heading and no frontmatter", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "bare-skill": `just some text without heading
`,
      },
    });

    const result = listInstalledSkills();

    // No heading, no frontmatter name → falls back to directory name
    expect(result[0].name).toBe("bare-skill");
  });

  it("handles malformed frontmatter (missing closing ---) gracefully", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        malformed: `---
name: Broken
description: No closing marker
`,
      },
    });

    const result = listInstalledSkills();

    // parseSkillFrontmatter returns empty strings when endIdx === -1
    // so the fallback is the directory name
    expect(result[0].name).toBe("malformed");
  });

  it("handles completely empty SKILL.md gracefully", () => {
    setupSkillsFs(HERMES_HOME, {
      tools: {
        empty: "",
      },
    });

    const result = listInstalledSkills();

    expect(result[0].name).toBe("empty");
    expect(result[0].description).toBe("");
  });

  it("truncates description to max 120 characters when parsing heading fallback", () => {
    const longDesc = "x".repeat(200);
    setupSkillsFs(HERMES_HOME, {
      tools: {
        "long-desc": `# Title\n\n${longDesc}\n`,
      },
    });

    const result = listInstalledSkills();

    expect(result[0].description.length).toBeLessThanOrEqual(120);
  });
});

// ── listBundledSkills ─────────────────────────────────────────────────────────
describe("listBundledSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when hermes repo skills directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const result = listBundledSkills();

    expect(result).toEqual([]);
  });

  it("lists skills from the hermes repo bundled skills directory", () => {
    setupSkillsFs(HERMES_REPO, {
      productivity: {
        "pomodoro-timer": `---
name: Pomodoro Timer
description: Focus technique timer
---
`,
      },
    });

    const result = listBundledSkills();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Pomodoro Timer");
    expect(result[0].source).toBe("bundled");
    expect(result[0].installed).toBe(false);
    expect(result[0].category).toBe("productivity");
  });

  it("always sets installed=false on bundled skills", () => {
    setupSkillsFs(HERMES_REPO, {
      tools: {
        "some-tool": `---
name: Some Tool
description: A tool
---
`,
      },
    });

    const result = listBundledSkills();

    expect(result[0].installed).toBe(false);
  });

  it("falls back to directory name when frontmatter name is absent", () => {
    setupSkillsFs(HERMES_REPO, {
      tools: {
        "unnamed-tool": `---
description: A tool without a name
---
`,
      },
    });

    const result = listBundledSkills();

    expect(result[0].name).toBe("unnamed-tool");
  });

  it("returns skills sorted by category then name", () => {
    setupSkillsFs(HERMES_REPO, {
      b: {
        second: `---\nname: Second\ndescription: D\n---\n`,
        first: `---\nname: First\ndescription: D\n---\n`,
      },
      a: {
        zeta: `---\nname: Zeta\ndescription: D\n---\n`,
      },
    });

    const result = listBundledSkills();

    expect(result[0].category).toBe("a");
    expect(result[1].category).toBe("b");
    expect(result[1].name).toBe("First");
    expect(result[2].name).toBe("Second");
  });
});

// ── getSkillContent ───────────────────────────────────────────────────────────
describe("getSkillContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full content of SKILL.md when it exists", () => {
    const content = `---
name: My Skill
---
# Full content here
`;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);

    const skillPath = join(HERMES_HOME, "skills", "tools", "my-skill");
    const result = getSkillContent(skillPath);

    expect(result).toBe(content);
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("SKILL.md"),
      "utf-8",
    );
  });

  it("returns empty string when SKILL.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const skillPath = join(HERMES_HOME, "skills", "tools", "my-skill");
    const result = getSkillContent(skillPath);

    expect(result).toBe("");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns empty string when readFileSync throws", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EPERM");
    });

    const skillPath = join(HERMES_HOME, "skills", "tools", "my-skill");
    const result = getSkillContent(skillPath);

    expect(result).toBe("");
  });
});

// ── installSkill ──────────────────────────────────────────────────────────────
describe("installSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the hermes CLI with 'skills install <id> --yes'", async () => {
    mockRun.mockResolvedValue({
      stdout: "Installed successfully",
      stderr: "",
      exitCode: 0,
    });

    const result = await installSkill("my-org/my-skill");

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const [, args] = mockRun.mock.calls[0];
    const argStr = (args as string[]).join(" ");
    expect(argStr).toContain("skills");
    expect(argStr).toContain("install");
    expect(argStr).toContain("my-org/my-skill");
    expect(argStr).toContain("--yes");
  });

  it("includes -p <profile> args for non-default profiles", async () => {
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await installSkill("my-skill", "dev-profile");

    const [, args] = mockRun.mock.calls[0];
    const argStr = (args as string[]).join(" ");
    expect(argStr).toContain("-p");
    expect(argStr).toContain("dev-profile");
  });

  it("does NOT include -p for the default profile", async () => {
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await installSkill("my-skill", "default");

    const [, args] = mockRun.mock.calls[0];
    const argStr = (args as string[]).join(" ");
    expect(argStr).not.toContain("-p");
    expect(argStr).not.toContain("default");
  });

  it("returns success=false and error message when CLI throws with stderr", async () => {
    mockRun.mockRejectedValue({
      stdout: "",
      stderr: "Skill not found in registry",
      message: "Command failed",
    });

    const result = await installSkill("nonexistent-skill");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Skill not found in registry");
  });

  it("falls back to message when CLI throws with no stderr property", async () => {
    // runSkillsCommand: `(e.stderr ?? e.message ?? "").trim()`
    // When `stderr` is undefined (not present), `??` falls through to `message`.
    mockRun.mockRejectedValue({
      stdout: "",
      message: "Network timeout",
      // Note: no `stderr` property at all — undefined, not ""
    });

    const result = await installSkill("some-skill");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
  });
});

// ── uninstallSkill ────────────────────────────────────────────────────────────
describe("uninstallSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the hermes CLI with 'skills uninstall <name> --yes'", async () => {
    mockRun.mockResolvedValue({ stdout: "Uninstalled", stderr: "", exitCode: 0 });

    const result = await uninstallSkill("task-manager");

    expect(result.success).toBe(true);

    const [, args] = mockRun.mock.calls[0];
    const argStr = (args as string[]).join(" ");
    expect(argStr).toContain("skills");
    expect(argStr).toContain("uninstall");
    expect(argStr).toContain("task-manager");
    expect(argStr).toContain("--yes");
  });

  it("includes -p <profile> args for non-default profiles", async () => {
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await uninstallSkill("task-manager", "work-profile");

    const [, args] = mockRun.mock.calls[0];
    const argStr = (args as string[]).join(" ");
    expect(argStr).toContain("-p");
    expect(argStr).toContain("work-profile");
  });

  it("does NOT include -p for the default profile", async () => {
    mockRun.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await uninstallSkill("task-manager", "default");

    const [, args] = mockRun.mock.calls[0];
    const argStr = (args as string[]).join(" ");
    expect(argStr).not.toContain("-p");
  });

  it("returns success=false with error when CLI throws", async () => {
    mockRun.mockRejectedValue({
      stdout: "",
      stderr: "Skill is not installed",
      message: "failed",
    });

    const result = await uninstallSkill("not-installed");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Skill is not installed");
  });
});
