import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { join } from "path";
import { getRuntimePaths } from "./runtimePaths";
import { createPlatformAdapter } from "../platform/platformAdapter";

/*
 * These tests exercise runtimePaths with fixture adapters. To make the
 * assertions OS-independent, we compare against `join(...)` outputs
 * rather than literal string paths — `join` on Windows produces `\`
 * separators and on POSIX produces `/`, so the expected values land in
 * the correct shape for whichever runner executes them.
 *
 * The adapter still gets an explicit `platform: "linux" | "windows" |
 * "macos"` override so the runtimePaths LOGIC (venv/Scripts vs venv/bin,
 * %LOCALAPPDATA% vs ~/.hermes) exercises every branch regardless of host.
 */

describe("getRuntimePaths", () => {
  describe("unix (linux)", () => {
    const adapter = createPlatformAdapter({
      platform: "linux",
      homeDir: "/home/test",
    });
    const paths = getRuntimePaths(adapter);

    it("puts hermesHome under ~/.hermes", () => {
      // Linux adapter forces ~/.hermes regardless of host. On Windows CI
      // the literal `/home/test/.hermes` still works because `join` of
      // a string starting with `/` leaves the separator alone.
      expect(paths.hermesHome).toBe(join("/home/test", ".hermes"));
    });

    it("nests hermesRepo under hermesHome", () => {
      expect(paths.hermesRepo).toBe(
        join("/home/test", ".hermes", "hermes-agent"),
      );
    });

    it("resolves pythonExe to venv/bin/python (no .exe)", () => {
      expect(paths.pythonExe).toBe(
        join("/home/test", ".hermes", "hermes-agent", "venv", "bin", "python"),
      );
    });

    it("returns a hermes CLI path when no filesystem candidates exist", () => {
      // On a test host where no Hermes Agent is installed, resolveHermesCli
      // falls through to the canonical expected location. Assert the shape,
      // not the exact string.
      expect(paths.hermesCli).toMatch(/hermes$|hermes\.exe$/);
    });

    it("profileHome('default') returns hermesHome", () => {
      expect(paths.profileHome("default")).toBe(paths.hermesHome);
    });

    it("profileHome(undefined) returns hermesHome", () => {
      expect(paths.profileHome()).toBe(paths.hermesHome);
    });

    it("profileHome('work') returns a profiles subdirectory", () => {
      expect(paths.profileHome("work")).toBe(
        join("/home/test", ".hermes", "profiles", "work"),
      );
    });

    it("envFile and configFile are inside hermesHome", () => {
      expect(paths.envFile).toBe(join("/home/test", ".hermes", ".env"));
      expect(paths.configFile).toBe(
        join("/home/test", ".hermes", "config.yaml"),
      );
    });
  });

  describe("windows", () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;

    beforeEach(() => {
      // Deterministically set LOCALAPPDATA for every Windows-adapter test.
      // Restored once after the whole windows suite completes.
      process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
    });

    afterAll(() => {
      if (originalLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = originalLocalAppData;
      }
    });

    const adapter = createPlatformAdapter({
      platform: "windows",
      homeDir: "C:\\Users\\test",
    });

    it("uses %LOCALAPPDATA%\\hermes when LOCALAPPDATA is set", () => {
      const paths = getRuntimePaths(adapter);
      expect(paths.hermesHome).toContain("AppData");
      expect(paths.hermesHome).toContain("hermes");
    });

    it("resolves pythonExe to venv\\Scripts\\python.exe", () => {
      const paths = getRuntimePaths(adapter);
      // Windows venv uses Scripts\python.exe, not bin/python.
      expect(paths.pythonExe).toContain("Scripts");
      expect(paths.pythonExe).toContain("python.exe");
      // Node's `join` on Windows produces "\" but source input was "bin"
      // — "bin/python" would only appear if we took the unix branch by
      // mistake. Check both separators.
      expect(paths.pythonExe).not.toContain("bin/python");
      expect(paths.pythonExe).not.toContain("bin\\python");
    });

    it("hermesCli canonical path uses Scripts\\hermes.exe when nothing exists", () => {
      const paths = getRuntimePaths(adapter);
      expect(paths.hermesCli).toContain("Scripts");
      expect(paths.hermesCli.endsWith("hermes.exe")).toBe(true);
    });
  });

  describe("macos", () => {
    const adapter = createPlatformAdapter({
      platform: "macos",
      homeDir: "/Users/test",
    });
    const paths = getRuntimePaths(adapter);

    it("puts hermesHome under ~/.hermes (same as linux, NOT Library)", () => {
      // Hermes Agent upstream convention is ~/.hermes on both macOS and
      // Linux. Only Windows diverges. Pan Desktop follows the upstream
      // convention for the AGENT's home (desktopPaths handles the shell's
      // own storage separately).
      expect(paths.hermesHome).toBe(join("/Users/test", ".hermes"));
    });

    it("uses bin/python not Scripts\\python.exe", () => {
      // The unix branch produces "bin/python" — on Windows CI that shows
      // up as "bin/python" verbatim because the adapter's `platform:
      // "macos"` override doesn't flip to Windows-style path shaping.
      // We assert containment rather than exact match to avoid separator
      // headaches.
      expect(paths.pythonExe).toContain("bin");
      expect(paths.pythonExe.endsWith("python")).toBe(true);
      expect(paths.pythonExe).not.toContain("Scripts");
    });
  });
});
