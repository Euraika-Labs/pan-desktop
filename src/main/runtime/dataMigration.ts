import { existsSync } from "fs";
import { cp, copyFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import type { DesktopPaths } from "./desktopPaths";
import type { PlatformAdapter } from "../platform/platformAdapter";
import { getRuntimePaths } from "./runtimePaths";

/**
 * One-time silent migration of desktop-owned files from legacy locations
 * to OS-standard paths.
 *
 * Called once at startup after desktopPaths is initialized. Copies
 * (never moves) files from legacy locations so the original stays as
 * a backup. Idempotent — safe to call on every launch.
 *
 * Does NOT migrate Hermes Agent data (state.db, profiles, config) —
 * that stays at runtime.hermesHome where the Python process writes it.
 */
export async function migrateDesktopData(
  desktop: DesktopPaths,
  adapter: PlatformAdapter,
): Promise<void> {
  const runtime = getRuntimePaths(adapter);
  const legacyHome = runtime.hermesHome;
  const homeDir = adapter.homeDir();

  const migrations: Array<{
    label: string;
    legacyPath: string;
    newPath: string;
    isDirectory: boolean;
  }> = [
    {
      label: "sessions.json",
      legacyPath: join(legacyHome, "desktop", "sessions.json"),
      newPath: join(desktop.userData, "sessions.json"),
      isDirectory: false,
    },
    {
      label: "claw3d settings",
      legacyPath: join(homeDir, ".openclaw", "claw3d"),
      newPath: join(desktop.userData, "claw3d"),
      isDirectory: true,
    },
  ];

  for (const { label, legacyPath, newPath, isDirectory } of migrations) {
    try {
      if (existsSync(newPath)) continue;
      if (!existsSync(legacyPath)) continue;

      await mkdir(dirname(newPath), { recursive: true });

      if (isDirectory) {
        await cp(legacyPath, newPath, { recursive: true });
      } else {
        await copyFile(legacyPath, newPath);
      }

      console.warn(
        `[dataMigration] Copied ${label}: ${legacyPath} → ${newPath}`,
      );
    } catch (err) {
      console.warn(
        `[dataMigration] Failed to migrate ${label}: ${(err as Error).message}`,
      );
    }
  }
}
