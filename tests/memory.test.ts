/**
 * Unit tests for src/main/memory.ts
 *
 * All filesystem I/O is mocked via vi.mock("fs") so tests are hermetic and
 * do not touch the real disk.  The runtime singleton and utils module are
 * also mocked to supply deterministic profileHome paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks must be hoisted above all imports ──────────────────────────────────

// Mock fs – we intercept existsSync, readFileSync, statSync, and writeFileSync.
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock better-sqlite3 so getSessionStats() doesn't open a real database.
vi.mock("better-sqlite3", () => ({
  default: vi.fn().mockImplementation(() => ({
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ count: 0 }),
    }),
    close: vi.fn(),
  })),
}));

// Mock the runtime singleton – only hermesHome is consumed by memory.ts
// (inside getSessionStats).
vi.mock("../src/main/runtime/instance", () => ({
  runtime: { hermesHome: "/fake/hermes" },
}));

// Mock utils – profileHome returns a predictable temp path; safeWriteFile
// delegates to the mocked fs.writeFileSync.
vi.mock("../src/main/utils", () => ({
  profileHome: vi.fn(() => "/fake/profile"),
  safeWriteFile: vi.fn(),
  join: require("path").join,
}));

// ── Imports (after mocks are registered) ─────────────────────────────────────
import * as fs from "fs";
import { join } from "path";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "../src/main/memory";
import * as utils from "../src/main/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DELIMITER = "\n§\n";

/** Simulate a file that exists with the given content. */
function mockFile(content: string, mtimeMs = 1_700_000_000_000): void {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
  vi.mocked(fs.statSync).mockReturnValue({
    mtimeMs,
  } as unknown as ReturnType<typeof fs.statSync>);
}

/** Simulate a file that does not exist. */
function mockMissingFile(): void {
  vi.mocked(fs.existsSync).mockReturnValue(false);
}

// ── readMemory ────────────────────────────────────────────────────────────────

describe("readMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default neither MEMORY.md nor USER.md exists.
    mockMissingFile();
  });

  it("returns empty entries and zeroed charCount when MEMORY.md is missing", () => {
    const result = readMemory();
    expect(result.memory.exists).toBe(false);
    expect(result.memory.entries).toEqual([]);
    expect(result.memory.charCount).toBe(0);
    expect(result.memory.charLimit).toBe(2200);
  });

  it("returns empty entries for an empty MEMORY.md", () => {
    // existsSync returns true for MEMORY.md call, false for USER.md call.
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true) // MEMORY.md exists
      .mockReturnValueOnce(false); // USER.md missing
    vi.mocked(fs.readFileSync).mockReturnValueOnce("" as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValueOnce({
      mtimeMs: 1_700_000_000_000,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = readMemory();
    expect(result.memory.entries).toEqual([]);
    expect(result.memory.exists).toBe(true);
  });

  it("parses § delimited entries correctly", () => {
    const content = ["Entry A", "Entry B", "Entry C"].join(DELIMITER);
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true) // MEMORY.md
      .mockReturnValueOnce(false); // USER.md
    vi.mocked(fs.readFileSync).mockReturnValueOnce(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValueOnce({
      mtimeMs: 1_700_000_000_000,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = readMemory();
    expect(result.memory.entries).toHaveLength(3);
    expect(result.memory.entries[0]).toEqual({ index: 0, content: "Entry A" });
    expect(result.memory.entries[1]).toEqual({ index: 1, content: "Entry B" });
    expect(result.memory.entries[2]).toEqual({ index: 2, content: "Entry C" });
  });

  it("reports correct charCount for memory content", () => {
    const content = "Hello World";
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.mocked(fs.readFileSync).mockReturnValueOnce(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValueOnce({
      mtimeMs: 1_700_000_000_000,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = readMemory();
    expect(result.memory.charCount).toBe(content.length);
  });

  it("includes USER.md data in the result", () => {
    const userContent = "I am a user";
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(false) // MEMORY.md
      .mockReturnValueOnce(true); // USER.md
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      userContent as unknown as Buffer,
    );
    vi.mocked(fs.statSync).mockReturnValueOnce({
      mtimeMs: 1_700_000_000_000,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = readMemory();
    expect(result.user.content).toBe(userContent);
    expect(result.user.exists).toBe(true);
    expect(result.user.charLimit).toBe(1375);
  });

  it("includes stats with zero counts when db is missing", () => {
    const result = readMemory();
    expect(result.stats).toEqual({ totalSessions: 0, totalMessages: 0 });
  });
});

// ── addMemoryEntry ────────────────────────────────────────────────────────────

describe("addMemoryEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends an entry to an empty file", () => {
    mockMissingFile();
    const result = addMemoryEntry("First entry");
    expect(result.success).toBe(true);
    expect(vi.mocked(utils.safeWriteFile)).toHaveBeenCalledOnce();
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe("First entry");
  });

  it("appends with delimiter when entries already exist", () => {
    // File exists with one entry.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "Existing entry" as unknown as Buffer,
    );
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = addMemoryEntry("New entry");
    expect(result.success).toBe(true);
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe(`Existing entry${DELIMITER}New entry`);
  });

  it("trims whitespace from the new entry", () => {
    mockMissingFile();
    addMemoryEntry("  trimmed  ");
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe("trimmed");
  });

  it("returns an error when new content would exceed MEMORY_CHAR_LIMIT (2200)", () => {
    mockMissingFile();
    const longContent = "x".repeat(2201);
    const result = addMemoryEntry(longContent);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/2200/);
    expect(vi.mocked(utils.safeWriteFile)).not.toHaveBeenCalled();
  });

  it("succeeds when content is exactly at the limit", () => {
    mockMissingFile();
    const atLimit = "x".repeat(2200);
    const result = addMemoryEntry(atLimit);
    expect(result.success).toBe(true);
  });
});

// ── updateMemoryEntry ─────────────────────────────────────────────────────────

describe("updateMemoryEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the entry at the given index", () => {
    const content = ["Alpha", "Beta", "Gamma"].join(DELIMITER);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = updateMemoryEntry(1, "Updated Beta");
    expect(result.success).toBe(true);
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe(["Alpha", "Updated Beta", "Gamma"].join(DELIMITER));
  });

  it("returns error for out-of-range index (too high)", () => {
    const content = "Only entry";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = updateMemoryEntry(5, "Nope");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Entry not found");
    expect(vi.mocked(utils.safeWriteFile)).not.toHaveBeenCalled();
  });

  it("returns error for negative index", () => {
    const content = "Only entry";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = updateMemoryEntry(-1, "Nope");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Entry not found");
  });

  it("returns error when updated content would exceed char limit", () => {
    const content = "Short entry";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = updateMemoryEntry(0, "x".repeat(2201));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/2200/);
    expect(vi.mocked(utils.safeWriteFile)).not.toHaveBeenCalled();
  });

  it("trims whitespace from updated content", () => {
    const content = "Entry";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    updateMemoryEntry(0, "  trimmed  ");
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe("trimmed");
  });
});

// ── removeMemoryEntry ─────────────────────────────────────────────────────────

describe("removeMemoryEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the entry at the given index and reflows remaining entries", () => {
    const content = ["Alpha", "Beta", "Gamma"].join(DELIMITER);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = removeMemoryEntry(1); // remove "Beta"
    expect(result).toBe(true);
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe(["Alpha", "Gamma"].join(DELIMITER));
  });

  it("removes the first entry", () => {
    const content = ["Alpha", "Beta"].join(DELIMITER);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content as unknown as Buffer);
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = removeMemoryEntry(0);
    expect(result).toBe(true);
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe("Beta");
  });

  it("removes the only entry leaving an empty file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "Only entry" as unknown as Buffer,
    );
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = removeMemoryEntry(0);
    expect(result).toBe(true);
    const written = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(written).toBe("");
  });

  it("returns false for an out-of-range index", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "Only entry" as unknown as Buffer,
    );
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = removeMemoryEntry(99);
    expect(result).toBe(false);
    expect(vi.mocked(utils.safeWriteFile)).not.toHaveBeenCalled();
  });

  it("returns false for a negative index", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "Only entry" as unknown as Buffer,
    );
    vi.mocked(fs.statSync).mockReturnValue({
      mtimeMs: 0,
    } as unknown as ReturnType<typeof fs.statSync>);

    const result = removeMemoryEntry(-1);
    expect(result).toBe(false);
  });

  it("returns false when the file is missing (no entries)", () => {
    mockMissingFile();
    const result = removeMemoryEntry(0);
    expect(result).toBe(false);
  });
});

// ── writeUserProfile ──────────────────────────────────────────────────────────

describe("writeUserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes content that is within the 1375 char limit", () => {
    const content = "User profile content";
    const result = writeUserProfile(content);
    expect(result.success).toBe(true);
    expect(vi.mocked(utils.safeWriteFile)).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] =
      vi.mocked(utils.safeWriteFile).mock.calls[0];
    expect(writtenPath).toContain("USER.md");
    expect(writtenContent).toBe(content);
  });

  it("returns an error for content exceeding 1375 chars", () => {
    const overLimit = "x".repeat(1376);
    const result = writeUserProfile(overLimit);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/1375/);
    expect(vi.mocked(utils.safeWriteFile)).not.toHaveBeenCalled();
  });

  it("succeeds for content exactly at the 1375 char limit", () => {
    const atLimit = "x".repeat(1375);
    const result = writeUserProfile(atLimit);
    expect(result.success).toBe(true);
  });

  it("writes to the correct path for a named profile", () => {
    const profileHome = vi.mocked(utils.profileHome);
    profileHome.mockReturnValueOnce("/fake/profiles/work");
    const result = writeUserProfile("content", "work");
    expect(result.success).toBe(true);
    expect(profileHome).toHaveBeenCalledWith("work");
    const writtenPath = vi.mocked(utils.safeWriteFile).mock.calls[0][0];
    expect(writtenPath).toBe(join("/fake/profiles/work", "USER.md"));
  });
});
