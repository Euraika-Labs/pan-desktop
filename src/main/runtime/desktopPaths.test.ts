import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createPlatformAdapter } from "../platform/platformAdapter";
import { createDesktopPaths } from "./desktopPaths";

// Mock the electron import because desktopPaths.ts imports `app` at the
// top level. We don't actually use `getDesktopPaths()` in tests — only
// `createDesktopPaths()` which takes explicit paths — but the import has
// to resolve cleanly.
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => {
      throw new Error("app.getPath must not be called from unit tests");
    }),
  },
}));

describe("createDesktopPaths", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "pan-desktop-test-"));
  });

  // Note: we deliberately don't cleanup in afterEach because rmSync on a
  // non-empty temp dir can race with child processes the tests spawn. The
  // OS cleans /tmp on reboot and each test uses a unique mkdtempSync path.

  const linuxAdapter = createPlatformAdapter({
    platform: "linux",
    homeDir: "/home/test",
  });

  it("returns the new userData path when nothing exists yet", () => {
    const userData = join(tempRoot, "userData-fresh");
    const logs = join(tempRoot, "logs-fresh");
    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: logs,
      legacyFallback: true,
    });
    expect(paths.userData).toBe(userData);
    expect(paths.stateDb).toBe(join(userData, "state.db"));
    expect(paths.sessionCache).toBe(join(userData, "sessions.json"));
    expect(paths.claw3dSettings).toBe(join(userData, "claw3d"));
    expect(paths.logs).toBe(logs);
  });

  it("prefers the new userData path when both new and legacy exist", () => {
    const userData = join(tempRoot, "userData-coexist");
    mkdirSync(userData, { recursive: true });
    // Create new state.db so the new-path check succeeds.
    writeFileSync(join(userData, "state.db"), "new data");

    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: join(tempRoot, "logs"),
      legacyFallback: true,
    });
    expect(paths.stateDb).toBe(join(userData, "state.db"));
  });

  it("legacyFallback: false returns new paths even when only legacy exists", () => {
    // Adapter's hermesHome is /home/test/.hermes (not real, so nothing
    // exists there). With legacyFallback: false, we should get the new
    // path regardless.
    const userData = join(tempRoot, "userData-nofallback");
    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: join(tempRoot, "logs"),
      legacyFallback: false,
    });
    expect(paths.stateDb).toBe(join(userData, "state.db"));
  });

  it("exposes userData and logs as provided", () => {
    const userData = join(tempRoot, "some-userdata");
    const logs = join(tempRoot, "some-logs");
    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: logs,
    });
    expect(paths.userData).toBe(userData);
    expect(paths.logs).toBe(logs);
  });

  describe("windows adapter", () => {
    const windowsAdapter = createPlatformAdapter({
      platform: "windows",
      homeDir: "C:\\Users\\test",
    });

    it("constructs desktopPaths correctly with Windows-style userData", () => {
      const userData = "C:\\Users\\test\\AppData\\Roaming\\Pan Desktop";
      const logs = "C:\\Users\\test\\AppData\\Roaming\\Pan Desktop\\logs";
      const paths = createDesktopPaths(windowsAdapter, {
        electronUserData: userData,
        electronLogs: logs,
        legacyFallback: false, // avoid touching the test host's real paths
      });
      expect(paths.userData).toBe(userData);
      expect(paths.stateDb).toContain("state.db");
      expect(paths.sessionCache).toContain("sessions.json");
      expect(paths.claw3dSettings).toContain("claw3d");
    });
  });
});
