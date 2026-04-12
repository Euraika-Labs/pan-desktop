/**
 * IPC Channel Wiring — Static Analysis Tests
 *
 * Reads the three source files as raw text and verifies that every channel
 * constant in channels.ts is consistently wired across main/index.ts and
 * preload/index.ts.  No Electron runtime is involved.
 *
 * Channel taxonomy
 * ────────────────
 * INVOKE channels   — bidirectional request/reply
 *   • main:    ipcMain.handle(CHANNEL, ...)
 *   • preload: ipcRenderer.invoke(CHANNEL, ...)
 *
 * PUSH channels     — main→renderer one-way push (no handler registered)
 *   • main:    event.sender.send(CHANNEL, ...) or webContents.send(CHANNEL, ...)
 *   • preload: ipcRenderer.on(CHANNEL, ...)
 *
 * Both kinds must be defined in channels.ts.  A channel used in only one
 * side of the bridge (orphaned or mis-wired) is flagged.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

// ── File paths ───────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");
const CHANNELS_FILE = join(ROOT, "src/shared/channels.ts");
const MAIN_FILE = join(ROOT, "src/main/index.ts");
const PRELOAD_FILE = join(ROOT, "src/preload/index.ts");

const channelsSrc = readFileSync(CHANNELS_FILE, "utf8");
const mainSrc = readFileSync(MAIN_FILE, "utf8");
const preloadSrc = readFileSync(PRELOAD_FILE, "utf8");

// ── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Extract every channel string value from channels.ts.
 * Matches lines of the form:
 *   export const SOME_NAME = "some-value" as const;
 * Returns a Map<constantName, channelValue>.
 */
function parseChannelConstants(src: string): Map<string, string> {
  const map = new Map<string, string>();
  // Matches: export const NAME = "value" as const;
  const re = /export\s+const\s+(\w+)\s*=\s*"([^"]+)"\s+as\s+const/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Extract channel strings registered with ipcMain.handle() in main/index.ts.
 * Handles both:
 *   ipcMain.handle(CHANNEL_CONST, ...)
 *   ipcMain.handle("literal-value", ...)
 * Returns a Set of channel values (resolved via the constants map).
 */
function parseMainHandles(
  src: string,
  constants: Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  // Match: ipcMain.handle(THING
  const re = /ipcMain\.handle\(\s*([^,)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const token = m[1].trim();
    if (token.startsWith('"') || token.startsWith("'")) {
      // Literal string
      set.add(token.replace(/['"]/g, ""));
    } else {
      // Constant reference — resolve via map
      const val = constants.get(token);
      if (val !== undefined) set.add(val);
      else set.add(`__UNRESOLVED__${token}`);
    }
  }
  return set;
}

/**
 * Extract channel strings used as push targets (main→renderer).
 * Looks for: event.sender.send(CHANNEL or webContents.send(CHANNEL
 */
function parseMainPushSends(
  src: string,
  constants: Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  // event.sender.send(CHANNEL  OR  webContents.send(CHANNEL
  const re = /(?:\.sender\.send|webContents\.send)\(\s*([^,)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const token = m[1].trim();
    if (token.startsWith('"') || token.startsWith("'")) {
      set.add(token.replace(/['"]/g, ""));
    } else {
      const val = constants.get(token);
      if (val !== undefined) set.add(val);
      else set.add(`__UNRESOLVED__${token}`);
    }
  }
  return set;
}

/**
 * Extract channel strings used with ipcRenderer.invoke() in preload/index.ts.
 */
function parsePreloadInvokes(
  src: string,
  constants: Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  const re = /ipcRenderer\.invoke\(\s*([^,)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const token = m[1].trim();
    if (token.startsWith('"') || token.startsWith("'")) {
      set.add(token.replace(/['"]/g, ""));
    } else {
      const val = constants.get(token);
      if (val !== undefined) set.add(val);
      else set.add(`__UNRESOLVED__${token}`);
    }
  }
  return set;
}

/**
 * Extract channel strings used with ipcRenderer.on() in preload/index.ts.
 * These correspond to push channels.
 */
function parsePreloadListeners(
  src: string,
  constants: Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  const re = /ipcRenderer\.on\(\s*([^,)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const token = m[1].trim();
    if (token.startsWith('"') || token.startsWith("'")) {
      set.add(token.replace(/['"]/g, ""));
    } else {
      const val = constants.get(token);
      if (val !== undefined) set.add(val);
      else set.add(`__UNRESOLVED__${token}`);
    }
  }
  return set;
}

// ── Build sets ───────────────────────────────────────────────────────────────

const constants = parseChannelConstants(channelsSrc);
const allChannelValues = new Set(constants.values());

const mainHandles = parseMainHandles(mainSrc, constants);
const mainPushSends = parseMainPushSends(mainSrc, constants);
const preloadInvokes = parsePreloadInvokes(preloadSrc, constants);
const preloadListeners = parsePreloadListeners(preloadSrc, constants);

// Every channel used anywhere in main or preload
const allUsedInMain = new Set([...mainHandles, ...mainPushSends]);
const allUsedInPreload = new Set([...preloadInvokes, ...preloadListeners]);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("IPC channel wiring (static analysis)", () => {
  // ── 1. Sanity: parsers found channels ──────────────────────────────────────

  it("channels.ts exports at least 80 channel constants", () => {
    expect(constants.size).toBeGreaterThanOrEqual(80);
  });

  it("main/index.ts registers at least 60 ipcMain.handle() calls", () => {
    expect(mainHandles.size).toBeGreaterThanOrEqual(60);
  });

  it("main/index.ts has at least 10 push send() calls", () => {
    expect(mainPushSends.size).toBeGreaterThanOrEqual(10);
  });

  it("preload/index.ts has at least 60 ipcRenderer.invoke() calls", () => {
    expect(preloadInvokes.size).toBeGreaterThanOrEqual(60);
  });

  it("preload/index.ts has at least 8 ipcRenderer.on() listeners", () => {
    expect(preloadListeners.size).toBeGreaterThanOrEqual(8);
  });

  // ── 2. No unresolved tokens ────────────────────────────────────────────────

  it("all ipcMain.handle() tokens resolve to known constants (no magic strings in main)", () => {
    const unresolved = [...mainHandles].filter((v) =>
      v.startsWith("__UNRESOLVED__"),
    );
    expect(unresolved).toEqual([]);
  });

  it("all push send() tokens resolve to known constants (no magic strings in main sends)", () => {
    const unresolved = [...mainPushSends].filter((v) =>
      v.startsWith("__UNRESOLVED__"),
    );
    expect(unresolved).toEqual([]);
  });

  it("all ipcRenderer.invoke() tokens resolve to known constants (no magic strings in preload)", () => {
    const unresolved = [...preloadInvokes].filter((v) =>
      v.startsWith("__UNRESOLVED__"),
    );
    expect(unresolved).toEqual([]);
  });

  it("all ipcRenderer.on() tokens resolve to known constants (no magic strings in preload listeners)", () => {
    const unresolved = [...preloadListeners].filter((v) =>
      v.startsWith("__UNRESOLVED__"),
    );
    expect(unresolved).toEqual([]);
  });

  // ── 3. Invoke channel consistency ─────────────────────────────────────────
  //
  //  Every channel that preload invokes must have a handler in main, and
  //  vice-versa (every main handler must be callable from preload).

  it("every ipcRenderer.invoke() channel has a matching ipcMain.handle() in main", () => {
    const missing = [...preloadInvokes].filter((ch) => !mainHandles.has(ch));
    expect(missing).toEqual([]);
  });

  it("every ipcMain.handle() channel has a matching ipcRenderer.invoke() in preload", () => {
    const missing = [...mainHandles].filter((ch) => !preloadInvokes.has(ch));
    expect(missing).toEqual([]);
  });

  // ── 4. Push channel consistency ────────────────────────────────────────────
  //
  //  Every channel that main pushes (send) must have an on() listener in
  //  preload, and vice-versa.

  it("every main push send() channel has a matching ipcRenderer.on() in preload", () => {
    const missing = [...mainPushSends].filter(
      (ch) => !preloadListeners.has(ch),
    );
    expect(missing).toEqual([]);
  });

  it("every preload ipcRenderer.on() listener has a matching main push send()", () => {
    const missing = [...preloadListeners].filter(
      (ch) => !mainPushSends.has(ch),
    );
    expect(missing).toEqual([]);
  });

  // ── 5. channels.ts coverage ───────────────────────────────────────────────
  //
  //  Every constant in channels.ts must appear somewhere in both main and
  //  preload (as either an invoke/handle or push/listen).

  it("no orphaned channels — every channel constant is used in main/index.ts", () => {
    const orphaned = [...allChannelValues].filter(
      (ch) => !allUsedInMain.has(ch),
    );
    expect(orphaned).toEqual([]);
  });

  it("no orphaned channels — every channel constant is used in preload/index.ts", () => {
    const orphaned = [...allChannelValues].filter(
      (ch) => !allUsedInPreload.has(ch),
    );
    expect(orphaned).toEqual([]);
  });

  // ── 6. No undeclared channels (magic strings used but not in channels.ts) ──

  it("no magic strings in main — every channel value used in main is declared in channels.ts", () => {
    const undeclared = [...allUsedInMain].filter(
      (ch) => !allChannelValues.has(ch),
    );
    expect(undeclared).toEqual([]);
  });

  it("no magic strings in preload — every channel value used in preload is declared in channels.ts", () => {
    const undeclared = [...allUsedInPreload].filter(
      (ch) => !allChannelValues.has(ch),
    );
    expect(undeclared).toEqual([]);
  });
});
