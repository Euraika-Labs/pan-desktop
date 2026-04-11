import { describe, it, expect } from "vitest";
import { createPlatformAdapter } from "./platformAdapter";

describe("createPlatformAdapter", () => {
  describe("windows overrides", () => {
    const adapter = createPlatformAdapter({
      platform: "windows",
      homeDir: "C:\\Users\\test",
      envPath: "C:\\Windows\\system32;C:\\Users\\test\\bin",
    });

    it("reports windows platform", () => {
      expect(adapter.platform).toBe("windows");
    });

    it("uses semicolon as PATH separator", () => {
      expect(adapter.pathSeparator).toBe(";");
    });

    it("has .exe as the executable extension", () => {
      expect(adapter.executableExtension).toBe(".exe");
    });

    it("offers a full set of script extension candidates in order", () => {
      expect([...adapter.scriptExtensionCandidates]).toEqual([
        "",
        ".exe",
        ".cmd",
        ".bat",
      ]);
    });

    it("returns an empty shell profile candidate list on Windows", () => {
      // Windows has no .bashrc-style user shell profile file that maps to
      // environment variables the way Unix does. The installer code uses
      // this signal to skip shell profile sourcing entirely on Windows.
      expect(adapter.shellProfileCandidates()).toEqual([]);
    });

    it("includes Windows-style user bin directories in systemPathExtras", () => {
      const extras = adapter.systemPathExtras();
      // Should contain .cargo\bin and .local\bin somewhere under the
      // user profile. Don't assert order — the adapter may reorganize.
      const joined = extras.join(" ");
      expect(joined).toContain(".cargo");
      expect(joined).toContain(".local");
    });

    it("buildEnhancedPath joins with semicolons and preserves order", () => {
      const result = adapter.buildEnhancedPath(["C:\\extra1", "C:\\extra2"]);
      expect(result).toBe(
        "C:\\extra1;C:\\extra2;C:\\Windows\\system32;C:\\Users\\test\\bin",
      );
    });

    it("buildEnhancedPath drops empty segments", () => {
      const result = adapter.buildEnhancedPath(["", "C:\\good", ""]);
      expect(result).toBe(
        "C:\\good;C:\\Windows\\system32;C:\\Users\\test\\bin",
      );
    });
  });

  describe("unix (linux) overrides", () => {
    const adapter = createPlatformAdapter({
      platform: "linux",
      homeDir: "/home/test",
      envPath: "/usr/bin:/bin",
    });

    it("reports linux platform", () => {
      expect(adapter.platform).toBe("linux");
    });

    it("uses colon as PATH separator", () => {
      expect(adapter.pathSeparator).toBe(":");
    });

    it("has empty executable extension", () => {
      expect(adapter.executableExtension).toBe("");
    });

    it("only tries bare names when resolving script candidates", () => {
      expect([...adapter.scriptExtensionCandidates]).toEqual([""]);
    });

    it("includes .bashrc family in shell profile candidates in preference order", () => {
      const candidates = [...adapter.shellProfileCandidates()];
      // .zshrc is first because many modern Unix setups default to zsh.
      expect(candidates[0]).toBe("/home/test/.zshrc");
      expect(candidates).toContain("/home/test/.bashrc");
      expect(candidates).toContain("/home/test/.bash_profile");
      expect(candidates).toContain("/home/test/.profile");
    });

    it("includes /usr/local/bin in systemPathExtras", () => {
      expect([...adapter.systemPathExtras()]).toContain("/usr/local/bin");
    });

    it("does NOT include homebrew paths on linux", () => {
      expect([...adapter.systemPathExtras()]).not.toContain(
        "/opt/homebrew/bin",
      );
    });

    it("buildEnhancedPath joins with colons", () => {
      const result = adapter.buildEnhancedPath(["/opt/extra"]);
      expect(result).toBe("/opt/extra:/usr/bin:/bin");
    });
  });

  describe("macos overrides", () => {
    const adapter = createPlatformAdapter({
      platform: "macos",
      homeDir: "/Users/test",
      envPath: "/usr/bin:/bin",
    });

    it("reports macos platform", () => {
      expect(adapter.platform).toBe("macos");
    });

    it("includes homebrew paths in systemPathExtras", () => {
      const extras = [...adapter.systemPathExtras()];
      expect(extras).toContain("/opt/homebrew/bin");
      expect(extras).toContain("/opt/homebrew/sbin");
    });
  });

  describe("detection fallback", () => {
    it("creates an adapter with real platform when no override is given", () => {
      const adapter = createPlatformAdapter();
      expect(["windows", "macos", "linux"]).toContain(adapter.platform);
      expect(adapter.homeDir()).toBeTruthy();
    });
  });
});
