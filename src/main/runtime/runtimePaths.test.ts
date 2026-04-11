import { describe, it, expect } from "vitest";
import { getRuntimePaths } from "./runtimePaths";
import { createPlatformAdapter } from "../platform/platformAdapter";

describe("getRuntimePaths", () => {
  describe("unix (linux)", () => {
    const adapter = createPlatformAdapter({
      platform: "linux",
      homeDir: "/home/test",
    });
    const paths = getRuntimePaths(adapter);

    it("puts hermesHome under ~/.hermes", () => {
      expect(paths.hermesHome).toBe("/home/test/.hermes");
    });

    it("nests hermesRepo under hermesHome", () => {
      expect(paths.hermesRepo).toBe("/home/test/.hermes/hermes-agent");
    });

    it("resolves pythonExe to venv/bin/python (no .exe)", () => {
      expect(paths.pythonExe).toBe(
        "/home/test/.hermes/hermes-agent/venv/bin/python",
      );
    });

    it("returns a hermes CLI path when no filesystem candidates exist", () => {
      // On a test host where no Hermes Agent is installed, resolveHermesCli
      // falls through to the canonical expected location. Assert the shape,
      // not the exact string (the canonical path is platform-dependent).
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
        "/home/test/.hermes/profiles/work",
      );
    });

    it("envFile and configFile are inside hermesHome", () => {
      expect(paths.envFile).toBe("/home/test/.hermes/.env");
      expect(paths.configFile).toBe("/home/test/.hermes/config.yaml");
    });
  });

  describe("windows", () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;
    const adapter = createPlatformAdapter({
      platform: "windows",
      homeDir: "C:\\Users\\test",
    });

    it("uses %LOCALAPPDATA%\\hermes when LOCALAPPDATA is set", () => {
      // Set LOCALAPPDATA just for this assertion.
      process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
      try {
        const paths = getRuntimePaths(adapter);
        expect(paths.hermesHome).toContain("AppData");
        expect(paths.hermesHome).toContain("hermes");
      } finally {
        if (originalLocalAppData === undefined) {
          delete process.env.LOCALAPPDATA;
        } else {
          process.env.LOCALAPPDATA = originalLocalAppData;
        }
      }
    });

    it("resolves pythonExe to venv\\Scripts\\python.exe", () => {
      const paths = getRuntimePaths(adapter);
      // Windows venv uses Scripts\python.exe, not bin/python.
      expect(paths.pythonExe).toContain("Scripts");
      expect(paths.pythonExe).toContain("python.exe");
      expect(paths.pythonExe).not.toContain("bin/python");
    });

    it("hermesCli canonical path uses Scripts\\hermes.exe when nothing exists", () => {
      const paths = getRuntimePaths(adapter);
      // When no candidates exist on disk (test host), the resolver returns
      // the canonical Windows location so error messages point at the right
      // place.
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
      expect(paths.hermesHome).toBe("/Users/test/.hermes");
    });

    it("uses bin/python not Scripts\\python.exe", () => {
      expect(paths.pythonExe).toContain("/bin/python");
    });
  });
});
