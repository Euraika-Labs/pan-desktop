import { join, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { runtime } from "./runtime/instance";

/**
 * Strip ANSI escape codes from terminal output.
 * Used by hermes.ts, claw3d.ts, and installer.ts when processing
 * child process output for display in the renderer.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B\(B|\r/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

/**
 * Resolve the home directory for a given profile.
 *
 * 'default' or undefined maps to Hermes home itself; named profiles live
 * under `<hermesHome>/profiles/<name>`. The exact filesystem location of
 * hermes home is owned by runtimePaths and differs per OS (`~/.hermes` on
 * Unix, `%LOCALAPPDATA%\hermes` on Windows).
 *
 * This function is what profile/memory/tool/soul services call to locate
 * their per-profile files. It delegates to the shared runtime singleton
 * so the "profile is a subdirectory" invariant lives in exactly one place.
 */
export function profileHome(profile?: string): string {
  return runtime.profileHome(profile);
}

/**
 * Escape special regex characters in a string so it can be
 * safely interpolated into a RegExp constructor.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Write a file, creating parent directories if they don't exist.
 * Prevents ENOENT crashes when hermes home has been deleted or doesn't
 * exist yet.
 */
export function safeWriteFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

// Re-export join so existing call sites that imported `join` from "path"
// via a shared util don't need to change. Removed in a follow-up PR if
// unused.
export { join };
