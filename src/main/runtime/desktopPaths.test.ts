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

  const linuxAdapter = createPlatformAdapter({
    platform: "linux",
    homeDir: "/home/test",
  });

  it("returns new userData paths when nothing exists yet", () => {
    const userData = join(tempRoot, "userData-fresh");
    const logs = join(tempRoot, "logs-fresh");
    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: logs,
      legacyFallback: true,
    });
    expect(paths.userData).toBe(userData);
    expect(paths.sessionCache).toBe(join(userData, "sessions.json"));
    expect(paths.claw3dSettings).toBe(join(userData, "claw3d"));
    expect(paths.logs).toBe(logs);
  });

  it("does NOT expose state.db — that's Hermes Agent data under runtimePaths", () => {
    const userData = join(tempRoot, "userData-agent-separation");
    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: join(tempRoot, "logs"),
      legacyFallback: false,
    });
    // DesktopPaths used to have a stateDb field pointing at
    // `userData/state.db`, but Hermes Agent (the Python process) is the
    // only writer for state.db and it writes to HERMES_HOME. Exposing a
    // desktop-owned stateDb caused confusion; it was removed in Wave 2.
    // Session/message reads should go through `runtime.hermesHome` directly.
    expect(paths).not.toHaveProperty("stateDb");
  });

  it("prefers the new sessionCache path when both new and legacy exist", () => {
    const userData = join(tempRoot, "userData-coexist");
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, "sessions.json"), "[]");

    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: join(tempRoot, "logs"),
      legacyFallback: true,
    });
    expect(paths.sessionCache).toBe(join(userData, "sessions.json"));
  });

  it("legacyFallback: false returns new paths even when only legacy exists", () => {
    const userData = join(tempRoot, "userData-nofallback");
    const paths = createDesktopPaths(linuxAdapter, {
      electronUserData: userData,
      electronLogs: join(tempRoot, "logs"),
      legacyFallback: false,
    });
    expect(paths.sessionCache).toBe(join(userData, "sessions.json"));
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
        legacyFallback: false,
      });
      expect(paths.userData).toBe(userData);
      expect(paths.sessionCache).toContain("sessions.json");
      expect(paths.claw3dSettings).toContain("claw3d");
    });
  });
});
