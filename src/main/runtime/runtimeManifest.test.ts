import { describe, it, expect } from "vitest";
import {
  checkCompatibility,
  compareVersions,
  MANIFEST,
  parseVersion,
  type RuntimeManifest,
} from "./runtimeManifest";

describe("parseVersion", () => {
  it("parses plain semver strings", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.0.1")).toEqual([0, 0, 1]);
    expect(parseVersion("10.20.30")).toEqual([10, 20, 30]);
  });

  it("tolerates a leading 'v'", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
  });

  it("ignores pre-release and build metadata", () => {
    expect(parseVersion("1.2.3-rc.1")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3+sha.abc")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3-beta.2+build.456")).toEqual([1, 2, 3]);
  });

  it("returns null for non-semver strings", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("abc.def.ghi")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseVersion("  1.2.3  ")).toEqual([1, 2, 3]);
    expect(parseVersion("\n1.2.3\n")).toEqual([1, 2, 3]);
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareVersions([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("returns -1 when the first is lower", () => {
    expect(compareVersions([1, 2, 3], [1, 2, 4])).toBe(-1);
    expect(compareVersions([1, 2, 3], [1, 3, 0])).toBe(-1);
    expect(compareVersions([1, 2, 3], [2, 0, 0])).toBe(-1);
  });

  it("returns 1 when the first is higher", () => {
    expect(compareVersions([1, 2, 4], [1, 2, 3])).toBe(1);
    expect(compareVersions([1, 3, 0], [1, 2, 99])).toBe(1);
    expect(compareVersions([2, 0, 0], [1, 99, 99])).toBe(1);
  });
});

describe("checkCompatibility", () => {
  const manifest: RuntimeManifest = {
    minimumHermesAgentVersion: "0.7.0",
    preferredHermesAgentVersion: "0.8.0",
    maximumTestedHermesAgentVersion: "0.9.0",
    migrationFlags: { configFormatVersion: 1 },
  };

  it("reports ok for a version inside the tested range", () => {
    const result = checkCompatibility("0.8.0", manifest);
    expect(result.status).toBe("ok");
    expect(result.installedVersion).toBe("0.8.0");
  });

  it("reports ok for the exact minimum version", () => {
    expect(checkCompatibility("0.7.0", manifest).status).toBe("ok");
  });

  it("reports ok for the exact maximum version", () => {
    expect(checkCompatibility("0.9.0", manifest).status).toBe("ok");
  });

  it("reports too_old for versions below the minimum", () => {
    const result = checkCompatibility("0.6.9", manifest);
    expect(result.status).toBe("too_old");
    expect(result.message).toMatch(/older than the minimum/);
  });

  it("reports too_new for versions above the tested maximum", () => {
    const result = checkCompatibility("0.10.0", manifest);
    expect(result.status).toBe("too_new");
    expect(result.message).toMatch(/newer than the maximum tested/);
  });

  it("reports unknown for null input", () => {
    const result = checkCompatibility(null, manifest);
    expect(result.status).toBe("unknown");
    expect(result.installedVersion).toBeNull();
  });

  it("reports unknown for empty string", () => {
    expect(checkCompatibility("", manifest).status).toBe("unknown");
    expect(checkCompatibility("   ", manifest).status).toBe("unknown");
  });

  it("reports unknown for unparseable version strings", () => {
    const result = checkCompatibility("not-a-version", manifest);
    expect(result.status).toBe("unknown");
    // still surfaces the raw input in the message for debugging
    expect(result.message).toContain("not-a-version");
  });

  it("tolerates 'v' prefix", () => {
    expect(checkCompatibility("v0.8.0", manifest).status).toBe("ok");
  });

  it("tolerates pre-release suffix", () => {
    // pre-release 0.8.0-rc.1 maps to [0, 8, 0] which is in-range
    expect(checkCompatibility("0.8.0-rc.1", manifest).status).toBe("ok");
  });

  it("returns the manifest in the result for callers that need it", () => {
    const result = checkCompatibility("0.8.0", manifest);
    expect(result.manifest).toBe(manifest);
  });

  it("uses the live MANIFEST when no override is passed", () => {
    const result = checkCompatibility("0.8.0");
    expect(result.manifest).toBe(MANIFEST);
  });

  describe("edge cases", () => {
    it("handles major version jump (from 0.x to 1.x)", () => {
      const result = checkCompatibility("1.0.0", manifest);
      expect(result.status).toBe("too_new");
    });

    it("handles ancient versions (0.0.1)", () => {
      const result = checkCompatibility("0.0.1", manifest);
      expect(result.status).toBe("too_old");
    });

    it("malformed manifest falls through to ok without crashing", () => {
      const broken: RuntimeManifest = {
        minimumHermesAgentVersion: "not-a-version",
        preferredHermesAgentVersion: "also-broken",
        maximumTestedHermesAgentVersion: "still-broken",
        migrationFlags: { configFormatVersion: 1 },
      };
      const result = checkCompatibility("0.8.0", broken);
      expect(result.status).toBe("ok");
    });
  });
});
