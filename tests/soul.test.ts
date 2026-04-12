/**
 * Unit tests for src/main/soul.ts
 *
 * Filesystem I/O is mocked via vi.mock("fs") so tests remain hermetic.
 * The utils module is mocked to provide a deterministic profileHome path,
 * and safeWriteFile is intercepted so we can assert on written content
 * without touching the disk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks must be hoisted above all imports ──────────────────────────────────

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("../src/main/utils", () => ({
  profileHome: vi.fn(() => "/fake/profile"),
  safeWriteFile: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  join: require("path").join,
}));

// ── Imports (after mocks are registered) ─────────────────────────────────────
import * as fs from "fs";
import { join } from "path";
import { readSoul, writeSoul, resetSoul } from "../src/main/soul";
import * as utils from "../src/main/utils";

// ── Shared expected values ────────────────────────────────────────────────────

const SOUL_PATH = join("/fake/profile", "SOUL.md");

const DEFAULT_SOUL = `You are Hermes, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.

You communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.

You strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.
`;

// ── readSoul ──────────────────────────────────────────────────────────────────

describe("readSoul", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string when SOUL.md is missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = readSoul();
    expect(result).toBe("");
  });

  it("reads and returns SOUL.md content when it exists", () => {
    const soulContent = "You are a custom soul.";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      soulContent as unknown as Buffer,
    );

    const result = readSoul();
    expect(result).toBe(soulContent);
    expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledWith(SOUL_PATH, "utf-8");
  });

  it("returns empty string when readFileSync throws", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const result = readSoul();
    expect(result).toBe("");
  });

  it("reads from the correct path for a named profile", () => {
    const profileHome = vi.mocked(utils.profileHome);
    profileHome.mockReturnValueOnce("/fake/profiles/work");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "work soul" as unknown as Buffer,
    );

    const result = readSoul("work");
    expect(result).toBe("work soul");
    expect(profileHome).toHaveBeenCalledWith("work");
    expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledWith(
      join("/fake/profiles/work", "SOUL.md"),
      "utf-8",
    );
  });
});

// ── writeSoul ─────────────────────────────────────────────────────────────────

describe("writeSoul", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists content via safeWriteFile and returns true", () => {
    const content = "My custom soul content";
    const result = writeSoul(content);
    expect(result).toBe(true);
    expect(vi.mocked(utils.safeWriteFile)).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = vi.mocked(utils.safeWriteFile).mock
      .calls[0];
    expect(writtenPath).toBe(SOUL_PATH);
    expect(writtenContent).toBe(content);
  });

  it("writes to the correct path for a named profile", () => {
    const profileHome = vi.mocked(utils.profileHome);
    profileHome.mockReturnValueOnce("/fake/profiles/work");

    writeSoul("work soul", "work");

    expect(profileHome).toHaveBeenCalledWith("work");
    const writtenPath = vi.mocked(utils.safeWriteFile).mock.calls[0][0];
    expect(writtenPath).toBe(join("/fake/profiles/work", "SOUL.md"));
  });

  it("returns false when safeWriteFile throws", () => {
    vi.mocked(utils.safeWriteFile).mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device");
    });

    const result = writeSoul("content");
    expect(result).toBe(false);
  });

  it("can write an empty string (clear the soul)", () => {
    const result = writeSoul("");
    expect(result).toBe(true);
    const writtenContent = vi.mocked(utils.safeWriteFile).mock.calls[0][1];
    expect(writtenContent).toBe("");
  });
});

// ── resetSoul ─────────────────────────────────────────────────────────────────

describe("resetSoul", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the default soul template and returns it", () => {
    const result = resetSoul();
    expect(result).toBe(DEFAULT_SOUL);
  });

  it("persists the default template via safeWriteFile", () => {
    resetSoul();
    expect(vi.mocked(utils.safeWriteFile)).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = vi.mocked(utils.safeWriteFile).mock
      .calls[0];
    expect(writtenPath).toBe(SOUL_PATH);
    expect(writtenContent).toBe(DEFAULT_SOUL);
  });

  it("returns the same string on repeated calls (idempotent)", () => {
    const first = resetSoul();
    vi.clearAllMocks();
    const second = resetSoul();
    expect(first).toBe(second);
  });

  it("writes to the correct path for a named profile", () => {
    const profileHome = vi.mocked(utils.profileHome);
    profileHome.mockReturnValueOnce("/fake/profiles/work");

    resetSoul("work");

    expect(profileHome).toHaveBeenCalledWith("work");
    const writtenPath = vi.mocked(utils.safeWriteFile).mock.calls[0][0];
    expect(writtenPath).toBe(join("/fake/profiles/work", "SOUL.md"));
  });
});
