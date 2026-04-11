import { promises as fs } from "fs";
import { existsSync } from "fs";
import { join } from "path";
import { runtime, processRunner } from "./runtime/instance";
import { buildHermesEnv } from "./installer";

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

async function readProfileConfig(profilePath: string): Promise<{
  model: string;
  provider: string;
}> {
  const configFile = join(profilePath, "config.yaml");
  try {
    const content = await fs.readFile(configFile, "utf-8");
    const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m);
    const providerMatch = content.match(
      /^\s*provider:\s*["']?([^"'\n#]+)["']?/m,
    );
    return {
      model: modelMatch ? modelMatch[1].trim() : "",
      provider: providerMatch ? providerMatch[1].trim() : "auto",
    };
  } catch {
    return { model: "", provider: "" };
  }
}

async function countSkills(profilePath: string): Promise<number> {
  const skillsDir = join(profilePath, "skills");
  try {
    const dirs = await fs.readdir(skillsDir);
    let count = 0;
    for (const d of dirs) {
      const sub = join(skillsDir, d);
      const stat = await fs.stat(sub);
      if (stat.isDirectory()) {
        const inner = await fs.readdir(sub);
        for (const f of inner) {
          try {
            await fs.access(join(sub, f, "SKILL.md"));
            count++;
          } catch {
            // not a skill
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function isGatewayRunning(profilePath: string): Promise<boolean> {
  const pidFile = join(profilePath, "gateway.pid");
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (isNaN(pid)) return false;
    // Use processRunner.isProcessAlive instead of direct process.kill(pid, 0)
    // so this file can be removed from the ESLint no-restricted-syntax
    // exception list in eslint.config.mjs.
    return processRunner.isProcessAlive(pid);
  } catch {
    return false;
  }
}

async function getActiveProfileName(): Promise<string> {
  const activeFile = join(runtime.hermesHome, "active_profile");
  try {
    const name = await fs.readFile(activeFile, "utf-8");
    return name.trim() || "default";
  } catch {
    return "default";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const activeName = await getActiveProfileName();
  const profiles: ProfileInfo[] = [];

  const profilesRoot = runtime.profilesRoot;

  // Default profile is hermesHome itself
  const [
    defaultConfig,
    defaultHasEnv,
    defaultHasSoul,
    defaultSkills,
    defaultGw,
  ] = await Promise.all([
    readProfileConfig(runtime.hermesHome),
    fileExists(join(runtime.hermesHome, ".env")),
    fileExists(join(runtime.hermesHome, "SOUL.md")),
    countSkills(runtime.hermesHome),
    isGatewayRunning(runtime.hermesHome),
  ]);

  profiles.push({
    name: "default",
    path: runtime.hermesHome,
    isDefault: true,
    isActive: activeName === "default",
    model: defaultConfig.model,
    provider: defaultConfig.provider,
    hasEnv: defaultHasEnv,
    hasSoul: defaultHasSoul,
    skillCount: defaultSkills,
    gatewayRunning: defaultGw,
  });

  // Named profiles under <hermesHome>/profiles/
  if (existsSync(profilesRoot)) {
    try {
      const dirs = await fs.readdir(profilesRoot);
      const profilePromises = dirs.map(async (name) => {
        const profilePath = join(profilesRoot, name);
        const stat = await fs.stat(profilePath);
        if (!stat.isDirectory()) return null;

        const hasConfig = await fileExists(join(profilePath, "config.yaml"));
        const hasEnvFile = await fileExists(join(profilePath, ".env"));
        if (!hasConfig && !hasEnvFile) return null;

        const [config, hasSoul, skillCount, gwRunning] = await Promise.all([
          readProfileConfig(profilePath),
          fileExists(join(profilePath, "SOUL.md")),
          countSkills(profilePath),
          isGatewayRunning(profilePath),
        ]);

        return {
          name,
          path: profilePath,
          isDefault: false,
          isActive: activeName === name,
          model: config.model,
          provider: config.provider,
          hasEnv: hasEnvFile,
          hasSoul: hasSoul,
          skillCount,
          gatewayRunning: gwRunning,
        } as ProfileInfo;
      });

      const resolved = await Promise.all(profilePromises);
      for (const p of resolved) {
        if (p) profiles.push(p);
      }
    } catch {
      // ignore
    }
  }

  return profiles;
}

/**
 * Run a `hermes profile <command>` via processRunner.
 *
 * All three profile-management functions (createProfile, deleteProfile,
 * setActiveProfile) share the same spawn shape — this helper centralizes
 * it so subprocess and env-shaping concerns live in one place.
 */
async function runProfileCommand(
  args: string[],
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cmd = runtime.buildCliCmd();
    await processRunner.run(cmd.command, [...cmd.args, ...args], {
      cwd: runtime.hermesRepo,
      env: buildHermesEnv(),
      timeoutMs,
    });
    return { success: true };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const msg = (e.stderr ?? e.message ?? "").trim();
    return { success: false, error: msg };
  }
}

export async function createProfile(
  name: string,
  clone: boolean,
): Promise<{ success: boolean; error?: string }> {
  const args = clone
    ? ["profile", "create", name, "--clone"]
    : ["profile", "create", name];
  return runProfileCommand(args, 15000);
}

export async function deleteProfile(
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (name === "default") {
    return { success: false, error: "Cannot delete the default profile" };
  }
  return runProfileCommand(["profile", "delete", name, "--yes"], 15000);
}

export async function setActiveProfile(name: string): Promise<void> {
  // Fire-and-forget semantics preserved — we don't surface errors to the
  // caller here because the IPC handler treats this as a best-effort toggle.
  try {
    await runProfileCommand(["profile", "use", name], 10000);
  } catch {
    // ignore
  }
}
