/**
 * Unit tests for src/main/config.ts
 *
 * All filesystem access is mocked via vi.mock so no real disk I/O occurs.
 * The runtime singleton is mocked to provide a deterministic hermesHome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted constants — accessible inside vi.mock() factories ─────────────────
const { FAKE_HERMES_HOME } = vi.hoisted(() => {
  const FAKE_HERMES_HOME = "/fake/hermes";
  return { FAKE_HERMES_HOME };
});

// ── Mock: runtime singleton ───────────────────────────────────────────────────
vi.mock("./runtime/instance", () => ({
  runtime: {
    hermesHome: "/fake/hermes",
    profileHome: (profile?: string): string => {
      if (!profile || profile === "default") return "/fake/hermes";
      return `/fake/hermes/profiles/${profile}`;
    },
  },
}));

// ── Mock: utils module ────────────────────────────────────────────────────────
vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    profileHome: (profile?: string): string => {
      if (!profile || profile === "default") return "/fake/hermes";
      return `/fake/hermes/profiles/${profile}`;
    },
    safeWriteFile: vi.fn(),
    escapeRegex: actual.escapeRegex,
  };
});

// ── Mock: fs module ───────────────────────────────────────────────────────────
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// ── Imports (after mocks are registered) ─────────────────────────────────────
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { safeWriteFile } from "./utils";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getModelConfig,
  setModelConfig,
  getHermesHome,
  getCredentialPool,
  setCredentialPool,
  getPlatformEnabled,
  setPlatformEnabled,
} from "./config";

// ── Typed mock helpers ────────────────────────────────────────────────────────
const mockExistsSync = vi.mocked(existsSync);
// readFileSync can return string or Buffer depending on overload;
// cast to a simple string-returning mock for our tests.
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockSafeWriteFile = vi.mocked(safeWriteFile);

// ── Reset mocks between tests ─────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── readEnv() ─────────────────────────────────────────────────────────────────

describe("readEnv()", () => {
  it("returns empty object when .env file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = readEnv("missing-profile-1");
    expect(result).toEqual({});
    expect(mockExistsSync).toHaveBeenCalledWith(
      join(FAKE_HERMES_HOME, "profiles", "missing-profile-1", ".env"),
    );
  });

  it("parses simple KEY=value pairs", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("FOO=bar\nBAZ=qux\n");
    const result = readEnv("parse-simple-2");
    expect(result).toMatchObject({ FOO: "bar", BAZ: "qux" });
  });

  it("strips double-quoted values", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('KEY="hello world"\n');
    const result = readEnv("quoted-double-2");
    expect(result.KEY).toBe("hello world");
  });

  it("strips single-quoted values", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("KEY='hello world'\n");
    const result = readEnv("quoted-single-2");
    expect(result.KEY).toBe("hello world");
  });

  it("ignores comment lines starting with #", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# This is a comment\nFOO=bar\n");
    const result = readEnv("comments-2");
    expect(result).not.toHaveProperty("# This is a comment");
    expect(result.FOO).toBe("bar");
  });

  it("ignores lines without an equals sign", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("NOT_A_PAIR\nFOO=bar\n");
    const result = readEnv("no-equals-2");
    expect(result).not.toHaveProperty("NOT_A_PAIR");
    expect(result.FOO).toBe("bar");
  });

  it("ignores keys with empty values", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("EMPTY=\nFOO=bar\n");
    const result = readEnv("empty-val-2");
    expect(result).not.toHaveProperty("EMPTY");
    expect(result.FOO).toBe("bar");
  });

  it("handles value with = signs (uses first = as delimiter)", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("URL=https://example.com?a=1&b=2\n");
    const result = readEnv("equals-in-val-2");
    expect(result.URL).toBe("https://example.com?a=1&b=2");
  });

  it("reads default profile when no profile arg provided", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("FOO=default\n");
    const result = readEnv();
    expect(mockExistsSync).toHaveBeenCalledWith(join(FAKE_HERMES_HOME, ".env"));
    expect(result.FOO).toBe("default");
  });

  it("returns cached result on second call with the same profile", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("CACHED=yes\n");
    const r1 = readEnv("cache-profile-2");
    const r2 = readEnv("cache-profile-2");
    // readFileSync should only be called once due to TTL cache
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2); // same reference from cache
  });
});

// ── setEnvValue() ─────────────────────────────────────────────────────────────

describe("setEnvValue()", () => {
  it("creates a new file with key=value when .env does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    setEnvValue("NEW_KEY", "new_value", "set-env-p1");
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      expect.stringContaining(".env"),
      "NEW_KEY=new_value\n",
    );
  });

  it("appends key=value when key is not found in existing file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("FOO=bar\n");
    setEnvValue("NEW_KEY", "new_val", "set-env-p2");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("FOO=bar");
    expect(content).toContain("NEW_KEY=new_val");
  });

  it("updates an existing key in place", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("FOO=old_value\nBAR=baz\n");
    setEnvValue("FOO", "new_value", "set-env-p3");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("FOO=new_value");
    expect(content).not.toContain("FOO=old_value");
    expect(content).toContain("BAR=baz");
  });

  it("updates a commented-out key", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("#FOO=commented\nBAR=baz\n");
    setEnvValue("FOO", "uncommented", "set-env-p4");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("FOO=uncommented");
  });

  it("writes to the default profile path when no profile given", () => {
    mockExistsSync.mockReturnValue(false);
    setEnvValue("X", "y");
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      join(FAKE_HERMES_HOME, ".env"),
      "X=y\n",
    );
  });
});

// ── getConfigValue() ──────────────────────────────────────────────────────────

describe("getConfigValue()", () => {
  it("returns null when config.yaml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getConfigValue("some_key")).toBeNull();
  });

  it("returns the value for a matching key", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("provider: openai\n");
    expect(getConfigValue("provider")).toBe("openai");
  });

  it("returns a quoted value without the quotes", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('provider: "openai"\n');
    expect(getConfigValue("provider")).toBe("openai");
  });

  it("returns null when key does not exist in config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("other_key: value\n");
    expect(getConfigValue("missing_key")).toBeNull();
  });

  it("reads from a named profile's config.yaml", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("streaming: true\n");
    getConfigValue("streaming", "work");
    expect(mockExistsSync).toHaveBeenCalledWith(
      join(FAKE_HERMES_HOME, "profiles", "work", "config.yaml"),
    );
  });

  it("reads from the default profile config.yaml when no profile given", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("provider: auto\n");
    getConfigValue("provider");
    expect(mockExistsSync).toHaveBeenCalledWith(
      join(FAKE_HERMES_HOME, "config.yaml"),
    );
  });
});

// ── setConfigValue() ──────────────────────────────────────────────────────────

describe("setConfigValue()", () => {
  it("does nothing when config.yaml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    setConfigValue("provider", "openai");
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("updates an existing key with a quoted value", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("provider: old_value\n");
    setConfigValue("provider", "openai");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain('provider: "openai"');
  });

  it("does not insert missing key — writes unchanged content", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("other_key: value\n");
    setConfigValue("missing_key", "newval");
    // safeWriteFile is still called but content should not include missing key
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).not.toContain("missing_key");
  });

  it("updates a commented-out key", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("  # provider: old\n");
    setConfigValue("provider", "new_provider");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain('"new_provider"');
  });
});

// ── getModelConfig() ──────────────────────────────────────────────────────────

describe("getModelConfig()", () => {
  it("returns defaults when config.yaml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = getModelConfig("mc-defaults-p");
    expect(result).toEqual({ provider: "auto", model: "", baseUrl: "" });
  });

  it("parses provider, model, and base_url from config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "provider: openai\ndefault: gpt-4o\nbase_url: https://api.openai.com\n",
    );
    const result = getModelConfig("mc-parse-p");
    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com",
    });
  });

  it("maps provider=custom with a regolo.ai base_url to provider='regolo'", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "provider: custom\ndefault: llama3\nbase_url: https://api.regolo.ai/v1\n",
    );
    const result = getModelConfig("mc-regolo-p");
    expect(result.provider).toBe("regolo");
    expect(result.baseUrl).toBe("https://api.regolo.ai/v1");
  });

  it("does NOT map custom to regolo when base_url is not regolo.ai", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "provider: custom\ndefault: llama3\nbase_url: https://my-own-server.com\n",
    );
    const result = getModelConfig("mc-custom-non-regolo-p");
    expect(result.provider).toBe("custom");
  });

  it("returns cached result on second call with same profile", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "provider: openai\ndefault: gpt-4\nbase_url: https://api.openai.com\n",
    );
    const r1 = getModelConfig("mc-cache-p");
    const r2 = getModelConfig("mc-cache-p");
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it("handles quoted values in config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'provider: "anthropic"\ndefault: "claude-3-5-sonnet"\nbase_url: "https://api.anthropic.com"\n',
    );
    const result = getModelConfig("mc-quoted-p");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-3-5-sonnet");
  });
});

// ── setModelConfig() ──────────────────────────────────────────────────────────

describe("setModelConfig()", () => {
  const YAML_TEMPLATE = `provider: auto
default: ""
base_url: ""
smart_model_routing:
  enabled: true
streaming: false
`;

  it("does nothing when config.yaml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    setModelConfig("openai", "gpt-4", "https://api.openai.com", "sm-no-file");
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("updates provider, model, and base_url fields", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(YAML_TEMPLATE);
    setModelConfig("openai", "gpt-4o", "https://api.openai.com", "sm-update-p");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain('"openai"');
    expect(content).toContain('"gpt-4o"');
    expect(content).toContain('"https://api.openai.com"');
  });

  it("maps 'regolo' provider to 'custom' in the written config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(YAML_TEMPLATE);
    setModelConfig(
      "regolo",
      "llama3",
      "https://api.regolo.ai/v1",
      "sm-regolo-p",
    );
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain('"custom"');
    expect(content).not.toContain('"regolo"');
  });

  it("regolo → custom round-trip: getModelConfig reads back as 'regolo'", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(YAML_TEMPLATE);

    setModelConfig(
      "regolo",
      "llama3",
      "https://api.regolo.ai/v1",
      "sm-roundtrip",
    );
    const [, writtenContent] = mockSafeWriteFile.mock.calls[0] as [
      string,
      string,
    ];

    // Now simulate reading the written content back with a fresh profile key
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(writtenContent);

    const result = getModelConfig("sm-roundtrip-read");
    expect(result.provider).toBe("regolo");
    expect(result.model).toBe("llama3");
    expect(result.baseUrl).toBe("https://api.regolo.ai/v1");
  });

  it("disables smart_model_routing.enabled", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(YAML_TEMPLATE);
    setModelConfig("openai", "gpt-4", "https://api.openai.com", "sm-smrtroute");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("enabled: false");
  });

  it("enables streaming", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(YAML_TEMPLATE);
    setModelConfig("openai", "gpt-4", "https://api.openai.com", "sm-stream");
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("streaming: true");
  });
});

// ── getHermesHome() ───────────────────────────────────────────────────────────

describe("getHermesHome()", () => {
  it("returns the hermes home path for the default profile", () => {
    expect(getHermesHome()).toBe(FAKE_HERMES_HOME);
    expect(getHermesHome("default")).toBe(FAKE_HERMES_HOME);
  });

  it("returns the profile subdirectory for a named profile", () => {
    expect(getHermesHome("work")).toBe(`${FAKE_HERMES_HOME}/profiles/work`);
  });
});

// ── getPlatformEnabled() / setPlatformEnabled() ───────────────────────────────

describe("getPlatformEnabled()", () => {
  it("returns empty object when config.yaml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getPlatformEnabled()).toEqual({});
  });

  it("returns false for each known platform when none are configured", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# empty config\n");
    const result = getPlatformEnabled();
    expect(result.telegram).toBe(false);
    expect(result.discord).toBe(false);
    expect(result.slack).toBe(false);
    expect(result.whatsapp).toBe(false);
    expect(result.signal).toBe(false);
  });

  it("reads enabled=true for a platform entry", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "platforms:\n  telegram:\n    enabled: true\n  discord:\n    enabled: false\n",
    );
    const result = getPlatformEnabled();
    expect(result.telegram).toBe(true);
    expect(result.discord).toBe(false);
  });

  it("reads enabled=false correctly", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "platforms:\n  slack:\n    enabled: false\n",
    );
    const result = getPlatformEnabled();
    expect(result.slack).toBe(false);
  });
});

describe("setPlatformEnabled()", () => {
  it("does nothing for an unsupported platform name", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("platforms:\n");
    setPlatformEnabled("fakeplatform", true);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("does nothing when config.yaml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    setPlatformEnabled("telegram", true);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("updates an existing platform entry from false to true", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "platforms:\n  telegram:\n    enabled: false\n",
    );
    setPlatformEnabled("telegram", true);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("enabled: true");
  });

  it("updates an existing platform entry from true to false", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "platforms:\n  discord:\n    enabled: true\n",
    );
    setPlatformEnabled("discord", false);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("enabled: false");
  });

  it("appends a new platform entry under existing platforms: block", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "other_key: value\nplatforms:\n  telegram:\n    enabled: true\n",
    );
    setPlatformEnabled("discord", true);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("discord:");
    expect(content).toContain("enabled: true");
  });

  it("creates platforms: section when none exists in config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("provider: openai\nstreaming: true\n");
    setPlatformEnabled("slack", true);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(content).toContain("platforms:");
    expect(content).toContain("slack:");
    expect(content).toContain("enabled: true");
  });
});

// ── getCredentialPool() / setCredentialPool() ─────────────────────────────────

describe("getCredentialPool()", () => {
  it("returns empty object when auth.json does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getCredentialPool()).toEqual({});
  });

  it("returns empty object when auth.json has no credential_pool key", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ other: "data" }));
    expect(getCredentialPool()).toEqual({});
  });

  it("returns the credential_pool entries when present", () => {
    const pool = {
      openai: [{ key: "sk-abc", label: "My Key" }],
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ credential_pool: pool }));
    expect(getCredentialPool()).toEqual(pool);
  });

  it("returns empty object when auth.json is malformed JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not-valid-json{{{");
    expect(getCredentialPool()).toEqual({});
  });

  it("reads from runtime.hermesHome/auth.json", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    getCredentialPool();
    expect(mockExistsSync).toHaveBeenCalledWith(
      join(FAKE_HERMES_HOME, "auth.json"),
    );
  });
});

describe("setCredentialPool()", () => {
  it("creates auth.json with credential_pool when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    setCredentialPool("openai", [{ key: "sk-abc", label: "My Key" }]);
    const [path, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    expect(path).toBe(join(FAKE_HERMES_HOME, "auth.json"));
    const parsed = JSON.parse(content);
    expect(parsed.credential_pool.openai).toEqual([
      { key: "sk-abc", label: "My Key" },
    ]);
  });

  it("merges new provider entries with existing credential_pool", () => {
    const existing = {
      credential_pool: {
        anthropic: [{ key: "sk-ant-1", label: "Ant Key" }],
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    setCredentialPool("openai", [{ key: "sk-openai", label: "OAI" }]);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed.credential_pool.anthropic).toBeDefined();
    expect(parsed.credential_pool.openai).toEqual([
      { key: "sk-openai", label: "OAI" },
    ]);
  });

  it("overwrites an existing provider's entries", () => {
    const existing = {
      credential_pool: {
        openai: [{ key: "sk-old", label: "Old Key" }],
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    setCredentialPool("openai", [{ key: "sk-new", label: "New Key" }]);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed.credential_pool.openai).toEqual([
      { key: "sk-new", label: "New Key" },
    ]);
    expect(
      parsed.credential_pool.openai.find(
        (e: { key: string }) => e.key === "sk-old",
      ),
    ).toBeUndefined();
  });

  it("preserves other top-level fields in auth.json", () => {
    const existing = { other_field: "keep_me", credential_pool: {} };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));
    setCredentialPool("openai", [{ key: "sk-x", label: "X" }]);
    const [, content] = mockSafeWriteFile.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content);
    expect(parsed.other_field).toBe("keep_me");
  });
});
