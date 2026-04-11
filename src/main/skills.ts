import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { runtime, processRunner } from "./runtime/instance";
import { buildHermesEnv } from "./installer";
import { profileHome } from "./utils";

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

/**
 * Parse SKILL.md frontmatter (YAML between --- markers) for name/description.
 */
function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const result = { name: "", description: "" };

  // Check for YAML frontmatter
  if (!content.startsWith("---")) {
    // Fall back to first heading and first paragraph
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch) result.name = headingMatch[1].trim();
    const paraMatch = content.match(/^(?!#)(?!---).+/m);
    if (paraMatch) result.description = paraMatch[0].trim().slice(0, 120);
    return result;
  }

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return result;

  const frontmatter = content.slice(3, endIdx);

  const nameMatch = frontmatter.match(/^\s*name:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (nameMatch) result.name = nameMatch[1].trim();

  const descMatch = frontmatter.match(
    /^\s*description:\s*["']?([^"'\n]+)["']?\s*$/m,
  );
  if (descMatch) result.description = descMatch[1].trim();

  return result;
}

/**
 * Walk the skills directory to find all installed skills.
 * Structure: skills/<category>/<skill-name>/SKILL.md
 */
export function listInstalledSkills(profile?: string): InstalledSkill[] {
  const skillsDir = join(profileHome(profile), "skills");
  if (!existsSync(skillsDir)) return [];

  const skills: InstalledSkill[] = [];

  try {
    const categories = readdirSync(skillsDir);

    for (const category of categories) {
      const categoryPath = join(skillsDir, category);
      if (!statSync(categoryPath).isDirectory()) continue;

      const entries = readdirSync(categoryPath);
      for (const entry of entries) {
        const entryPath = join(categoryPath, entry);
        if (!statSync(entryPath).isDirectory()) continue;

        const skillFile = join(entryPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
          const meta = parseSkillFrontmatter(content);

          skills.push({
            name: meta.name || entry,
            category,
            description: meta.description || "",
            path: entryPath,
          });
        } catch {
          skills.push({
            name: entry,
            category,
            description: "",
            path: entryPath,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return skills.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

/**
 * Get the full content of a SKILL.md for the detail view.
 */
export function getSkillContent(skillPath: string): string {
  const skillFile = join(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) return "";

  try {
    return readFileSync(skillFile, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Run a `hermes skills <cmd>` via processRunner. Shared by searchSkills,
 * installSkill, uninstallSkill.
 */
async function runSkillsCommand(
  args: string[],
  timeoutMs: number,
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const result = await processRunner.run(
      runtime.pythonExe,
      [runtime.hermesCli, ...args],
      {
        cwd: runtime.hermesRepo,
        env: buildHermesEnv(),
        timeoutMs,
      },
    );
    return { success: true, output: result.stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: e.stdout ?? "",
      error: (e.stderr ?? e.message ?? "").trim(),
    };
  }
}

/**
 * Search the skill registry via the hermes CLI.
 */
export async function searchSkills(
  query: string,
): Promise<SkillSearchResult[]> {
  const result = await runSkillsCommand(
    ["skills", "browse", "--query", query, "--json"],
    30000,
  );
  if (!result.success) return [];

  const text = result.output.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((r: Record<string, string>) => ({
        name: r.name || "",
        description: r.description || "",
        category: r.category || "",
        source: r.source || "",
        installed: false,
      }));
    }
  } catch {
    // If JSON parsing fails, the CLI may not support --json flag
  }

  return [];
}

/**
 * List bundled skills from the hermes-agent repo.
 */
export function listBundledSkills(): SkillSearchResult[] {
  const bundledDir = join(runtime.hermesRepo, "skills");
  if (!existsSync(bundledDir)) return [];

  const skills: SkillSearchResult[] = [];

  try {
    const categories = readdirSync(bundledDir);

    for (const category of categories) {
      const catPath = join(bundledDir, category);
      if (!statSync(catPath).isDirectory()) continue;

      const entries = readdirSync(catPath);
      for (const entry of entries) {
        const entryPath = join(catPath, entry);
        if (!statSync(entryPath).isDirectory()) continue;

        const skillFile = join(entryPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
          const meta = parseSkillFrontmatter(content);

          skills.push({
            name: meta.name || entry,
            description: meta.description || "",
            category,
            source: "bundled",
            installed: false,
          });
        } catch {
          skills.push({
            name: entry,
            description: "",
            category,
            source: "bundled",
            installed: false,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return skills.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

export async function installSkill(
  identifier: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const args: string[] = [];
  if (profile && profile !== "default") {
    args.push("-p", profile);
  }
  args.push("skills", "install", identifier, "--yes");
  const result = await runSkillsCommand(args, 60000);
  return { success: result.success, error: result.error };
}

export async function uninstallSkill(
  name: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const args: string[] = [];
  if (profile && profile !== "default") {
    args.push("-p", profile);
  }
  args.push("skills", "uninstall", name, "--yes");
  const result = await runSkillsCommand(args, 30000);
  return { success: result.success, error: result.error };
}
