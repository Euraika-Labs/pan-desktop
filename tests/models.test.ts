/**
 * Unit tests for src/main/models.ts
 *
 * Strategy: vi.mock the fs module and the runtime/instance singleton so
 * no real filesystem or Electron paths are involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────
// Must be hoisted before any import that would pull them in transitively.

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("../src/main/utils", () => ({
  safeWriteFile: vi.fn(),
  profileHome: vi.fn((p?: string) => (p ? `/hermes/profiles/${p}` : "/hermes")),
  join: (...args: string[]) =>
    args.join("/").replace(/\/+/g, "/").replace(/\/$/, ""),
}));

vi.mock("../src/main/runtime/instance", () => ({
  runtime: {
    hermesHome: "/hermes",
    hermesRepo: "/hermes/repo",
    profileHome: (p?: string) => (p ? `/hermes/profiles/${p}` : "/hermes"),
    buildCliCmd: () => ({ command: "hermes", args: [] }),
  },
  processRunner: {
    run: vi.fn(),
  },
}));

// ── Import after mocks are in place ──────────────────────────────────────────
import { existsSync, readFileSync } from "fs";
import {
  listModels,
  addModel,
  removeModel,
  updateModel,
  syncRemoteModels,
  type SavedModel,
} from "../src/main/models";
import { safeWriteFile } from "../src/main/utils";

// ── Typed mock helpers ────────────────────────────────────────────────────────
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockSafeWriteFile = safeWriteFile as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeModel(overrides: Partial<SavedModel> = {}): SavedModel {
  return {
    id: "id-1",
    name: "Test Model",
    provider: "openai",
    model: "gpt-4",
    baseUrl: "",
    createdAt: 1000,
    ...overrides,
  };
}

function serializeModels(models: SavedModel[]): string {
  return JSON.stringify(models, null, 2);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("listModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds defaults and returns them when models.json does not exist", () => {
    // existsSync returns false for every path → triggers seedDefaults()
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("[]");

    const models = listModels();

    // safeWriteFile must have been called (writing the seed)
    expect(mockSafeWriteFile).toHaveBeenCalledOnce();
    // Seeded models come from default-models.ts — just check we got some
    expect(models.length).toBeGreaterThan(0);
    // Each has the expected shape
    for (const m of models) {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("provider");
      expect(m).toHaveProperty("model");
    }
  });

  it("reads and returns models from disk when models.json exists", () => {
    const persisted: SavedModel[] = [makeModel()];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(serializeModels(persisted));

    const models = listModels();

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("id-1");
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("returns empty array when models.json is corrupted JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json{{{{");

    const models = listModels();

    expect(models).toEqual([]);
  });
});

describe("addModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("adds a new model to an empty list", () => {
    mockReadFileSync.mockReturnValue("[]");

    const result = addModel("GPT-4", "openai", "gpt-4", "");

    expect(result.name).toBe("GPT-4");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4");
    expect(result.baseUrl).toBe("");
    expect(result.id).toBeTruthy();
    expect(typeof result.createdAt).toBe("number");
    expect(mockSafeWriteFile).toHaveBeenCalledOnce();
  });

  it("stores baseUrl when provided", () => {
    mockReadFileSync.mockReturnValue("[]");

    const result = addModel(
      "Llama",
      "regolo",
      "llama-3",
      "https://api.regolo.ai/v1",
    );

    expect(result.baseUrl).toBe("https://api.regolo.ai/v1");
  });

  it("uses empty string for baseUrl when not provided (empty string arg)", () => {
    mockReadFileSync.mockReturnValue("[]");

    const result = addModel("Model", "custom", "my-model", "");

    expect(result.baseUrl).toBe("");
  });

  it("deduplicates: returns existing model if same model+provider already exists", () => {
    const existing = makeModel({ model: "gpt-4", provider: "openai" });
    mockReadFileSync.mockReturnValue(serializeModels([existing]));

    const result = addModel("Different Name", "openai", "gpt-4", "");

    // Returns the existing entry unchanged
    expect(result.id).toBe(existing.id);
    expect(result.name).toBe(existing.name);
    // No write since we returned early
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("does NOT deduplicate when provider differs", () => {
    const existing = makeModel({ model: "gpt-4", provider: "openai" });
    mockReadFileSync.mockReturnValue(serializeModels([existing]));

    const result = addModel("GPT-4 via OR", "openrouter", "gpt-4", "");

    expect(result.id).not.toBe(existing.id);
    expect(result.provider).toBe("openrouter");
    expect(mockSafeWriteFile).toHaveBeenCalledOnce();
  });

  it("assigns a new unique id for each new entry", () => {
    mockReadFileSync.mockReturnValue("[]");

    const first = addModel("A", "openai", "gpt-3", "");

    // Reset mock to simulate the new persisted state
    mockReadFileSync.mockReturnValue(serializeModels([first]));
    const second = addModel("B", "openai", "gpt-4", "");

    expect(first.id).not.toBe(second.id);
  });
});

describe("removeModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("removes an existing model and returns true", () => {
    const m1 = makeModel({ id: "aaa" });
    const m2 = makeModel({ id: "bbb", model: "gpt-3" });
    mockReadFileSync.mockReturnValue(serializeModels([m1, m2]));

    const result = removeModel("aaa");

    expect(result).toBe(true);
    // Verify the written content excludes the removed model
    const written = mockSafeWriteFile.mock.calls[0][1] as string;
    const parsed: SavedModel[] = JSON.parse(written);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("bbb");
  });

  it("returns false when id does not exist", () => {
    const m = makeModel({ id: "aaa" });
    mockReadFileSync.mockReturnValue(serializeModels([m]));

    const result = removeModel("nonexistent-id");

    expect(result).toBe(false);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("returns false on an empty list", () => {
    mockReadFileSync.mockReturnValue("[]");

    const result = removeModel("any-id");

    expect(result).toBe(false);
  });
});

describe("updateModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("updates name field and returns true", () => {
    const m = makeModel({ id: "aaa", name: "Old Name" });
    mockReadFileSync.mockReturnValue(serializeModels([m]));

    const result = updateModel("aaa", { name: "New Name" });

    expect(result).toBe(true);
    const written = mockSafeWriteFile.mock.calls[0][1] as string;
    const parsed: SavedModel[] = JSON.parse(written);
    expect(parsed[0].name).toBe("New Name");
    // Other fields unchanged
    expect(parsed[0].provider).toBe(m.provider);
  });

  it("updates baseUrl field", () => {
    const m = makeModel({ id: "aaa", baseUrl: "" });
    mockReadFileSync.mockReturnValue(serializeModels([m]));

    updateModel("aaa", { baseUrl: "https://custom.api" });

    const written = mockSafeWriteFile.mock.calls[0][1] as string;
    const parsed: SavedModel[] = JSON.parse(written);
    expect(parsed[0].baseUrl).toBe("https://custom.api");
  });

  it("can update multiple fields at once", () => {
    const m = makeModel({ id: "aaa" });
    mockReadFileSync.mockReturnValue(serializeModels([m]));

    updateModel("aaa", { name: "Updated", provider: "anthropic" });

    const written = mockSafeWriteFile.mock.calls[0][1] as string;
    const parsed: SavedModel[] = JSON.parse(written);
    expect(parsed[0].name).toBe("Updated");
    expect(parsed[0].provider).toBe("anthropic");
  });

  it("returns false when id does not exist", () => {
    const m = makeModel({ id: "aaa" });
    mockReadFileSync.mockReturnValue(serializeModels([m]));

    const result = updateModel("not-there", { name: "X" });

    expect(result).toBe(false);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("preserves createdAt and id after update", () => {
    const m = makeModel({ id: "aaa", createdAt: 12345 });
    mockReadFileSync.mockReturnValue(serializeModels([m]));

    updateModel("aaa", { name: "New" });

    const written = mockSafeWriteFile.mock.calls[0][1] as string;
    const parsed: SavedModel[] = JSON.parse(written);
    expect(parsed[0].id).toBe("aaa");
    expect(parsed[0].createdAt).toBe(12345);
  });
});

describe("syncRemoteModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(body: unknown, ok = true): void {
    const mockFetchFn = fetch as ReturnType<typeof vi.fn>;
    mockFetchFn.mockResolvedValue({
      ok,
      json: async () => body,
    });
  }

  it("adds remote models not already in the local list", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ data: [{ id: "llama-3", name: "Llama 3" }] });

    const result = await syncRemoteModels(
      "regolo",
      "https://api.regolo.ai/v1",
      "key123",
    );

    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("llama-3");
    expect(result[0].provider).toBe("regolo");
    expect(result[0].name).toBe("Llama 3");
    expect(mockSafeWriteFile).toHaveBeenCalledOnce();
  });

  it("uses remote.id as name when remote.name is absent", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ data: [{ id: "nameless-model" }] });

    const result = await syncRemoteModels("regolo", "https://api.regolo.ai/v1");

    expect(result[0].name).toBe("nameless-model");
  });

  it("accepts 'models' key instead of 'data'", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ models: [{ id: "alt-model", name: "Alt" }] });

    const result = await syncRemoteModels(
      "openai",
      "https://api.openai.com/v1",
    );

    expect(result[0].model).toBe("alt-model");
  });

  it("skips models already present for the same provider", async () => {
    const existing = makeModel({ model: "llama-3", provider: "regolo" });
    mockReadFileSync.mockReturnValue(serializeModels([existing]));
    mockFetch({ data: [{ id: "llama-3", name: "Llama 3" }] });

    const result = await syncRemoteModels("regolo", "https://api.regolo.ai/v1");

    expect(result).toHaveLength(1);
    // No write because nothing new was added
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("adds the model when same model id exists but for a different provider", async () => {
    const existing = makeModel({ model: "llama-3", provider: "openai" });
    mockReadFileSync.mockReturnValue(serializeModels([existing]));
    mockFetch({ data: [{ id: "llama-3", name: "Llama 3" }] });

    const result = await syncRemoteModels("regolo", "https://api.regolo.ai/v1");

    expect(result).toHaveLength(2);
    expect(mockSafeWriteFile).toHaveBeenCalledOnce();
  });

  it("returns empty array when fetch response is not ok", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({}, false);

    const result = await syncRemoteModels("regolo", "https://api.regolo.ai/v1");

    expect(result).toEqual([]);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("strips trailing slash from baseUrl when building the fetch URL", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ data: [] });
    const mockFetchFn = fetch as ReturnType<typeof vi.fn>;

    await syncRemoteModels("regolo", "https://api.regolo.ai/v1///");

    const calledUrl = mockFetchFn.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://api.regolo.ai/v1/models");
    expect(calledUrl).not.toContain("///");
  });

  it("sets Authorization header when apiKey is provided", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ data: [] });
    const mockFetchFn = fetch as ReturnType<typeof vi.fn>;

    await syncRemoteModels("regolo", "https://api.regolo.ai/v1", "my-secret");

    const options = mockFetchFn.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(options.headers["Authorization"]).toBe("Bearer my-secret");
  });

  it("omits Authorization header when apiKey is not provided", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ data: [] });
    const mockFetchFn = fetch as ReturnType<typeof vi.fn>;

    await syncRemoteModels("regolo", "https://api.regolo.ai/v1");

    const options = mockFetchFn.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(options.headers["Authorization"]).toBeUndefined();
  });

  it("returns empty array when response data is not an array", async () => {
    mockReadFileSync.mockReturnValue("[]");
    mockFetch({ data: "not-an-array" });

    const result = await syncRemoteModels("regolo", "https://api.regolo.ai/v1");

    expect(result).toEqual([]);
  });

  it("handles multiple remote models, adding only new ones", async () => {
    const existing = makeModel({ model: "model-a", provider: "custom" });
    mockReadFileSync.mockReturnValue(serializeModels([existing]));
    mockFetch({
      data: [
        { id: "model-a", name: "A" },
        { id: "model-b", name: "B" },
      ],
    });

    const result = await syncRemoteModels(
      "custom",
      "https://custom.api/v1",
      "key",
    );

    expect(result).toHaveLength(2);
    const added = result.find((m) => m.model === "model-b");
    expect(added).toBeDefined();
    expect(added?.provider).toBe("custom");
    expect(mockSafeWriteFile).toHaveBeenCalledOnce();
  });
});

// ── Provider name round-trip ──────────────────────────────────────────────────
describe("provider name round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("[]");
  });

  const providerKeys = [
    "openrouter",
    "anthropic",
    "openai",
    "regolo",
    "custom",
  ];

  for (const provider of providerKeys) {
    it(`round-trips provider key "${provider}" through add → list`, () => {
      const added = addModel("Test", provider, "some-model", "");

      // Simulate that writeModels stored the entry and readModels returns it
      mockReadFileSync.mockReturnValue(serializeModels([added]));

      // On next listModels call, existsSync says file exists
      const listed = listModels();

      expect(listed[0].provider).toBe(provider);
    });
  }
});
