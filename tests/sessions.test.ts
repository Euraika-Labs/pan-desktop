/**
 * Unit tests for src/main/sessions.ts
 *
 * Strategy: fully mock better-sqlite3 with a chainable fake that mimics
 * the prepare().all() / prepare().get() API. An in-memory store (plain JS
 * arrays/maps) backs each fake "table" so the logic in sessions.ts runs
 * against realistic-looking data without touching native code or the
 * filesystem.
 *
 * Mocks:
 *   - better-sqlite3         → fake Database constructor + chainable Statement
 *   - ./runtime/instance     → runtime.hermesHome = "/fake/hermes-home"
 *   - fs (existsSync)        → controllable per test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../src/main/runtime/instance", () => ({
  runtime: { hermesHome: "/fake/hermes-home" },
  adapter: {},
  processRunner: {},
}));

const mockExistsSync = vi.fn<(path: string) => boolean>(() => true);
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: (p: string) => mockExistsSync(p) };
});

// ─── Fake SQLite types ────────────────────────────────────────────────────────

export interface FakeRow {
  [key: string]: unknown;
}

// A fake "database" is just a reference holder so tests can swap data.
// Each instance exposes `_tables` (a plain-object store) and `_closed`.
export interface FakeDb {
  _closed: boolean;
  _tables: {
    sessions: FakeRow[];
    messages: FakeRow[];
    messages_fts: FakeRow[] | null; // null = table doesn't exist
  };
  prepare: (sql: string) => FakeStatement;
  close: () => void;
}

interface FakeStatement {
  all: (...params: unknown[]) => FakeRow[];
  get: (...params: unknown[]) => FakeRow | undefined;
}

// ─── Fake implementation factories ───────────────────────────────────────────

// Tiny SQL parser helpers — good enough for the exact queries in sessions.ts
function execStatement(db: FakeDb, sql: string, params: unknown[]): FakeRow[] {
  const s = sql.replace(/\s+/g, " ").trim();

  // ── sqlite_master check for messages_fts ──
  if (
    /SELECT name FROM sqlite_master.*WHERE.*name.*messages_fts/i.test(s)
  ) {
    if (db._tables.messages_fts === null) return [];
    return [{ name: "messages_fts" }];
  }

  // ── listSessions: SELECT from sessions ORDER BY started_at DESC LIMIT ? OFFSET ? ──
  if (/SELECT.*FROM sessions s.*ORDER BY s\.started_at DESC/i.test(s)) {
    const limit = (params[0] as number) ?? 30;
    const offset = (params[1] as number) ?? 0;
    const sorted = [...db._tables.sessions].sort(
      (a, b) => (b.started_at as number) - (a.started_at as number),
    );
    return sorted.slice(offset, offset + limit);
  }

  // ── getSessionMessages: SELECT from messages WHERE session_id = ? ──
  if (
    /SELECT id, role, content, timestamp\s+FROM messages\s+WHERE session_id = \?/i.test(s)
  ) {
    const sessionId = params[0] as string;
    const rows = db._tables.messages.filter(
      (m) =>
        m.session_id === sessionId &&
        (m.role === "user" || m.role === "assistant") &&
        m.content != null,
    );
    // ORDER BY timestamp, id
    rows.sort(
      (a, b) =>
        (a.timestamp as number) - (b.timestamp as number) ||
        (a.id as number) - (b.id as number),
    );
    return rows;
  }

  // ── searchSessions: FTS JOIN query ──
  if (/FROM messages_fts\s+JOIN messages/i.test(s)) {
    if (db._tables.messages_fts === null) return [];
    const ftsQuery = (params[0] as string).toLowerCase();
    const limit = (params[1] as number) ?? 20;

    // Extract the bare search keyword(s) from the FTS5 sanitized form:
    // '"word"*' → 'word'
    const keywords = ftsQuery
      .replace(/"/g, "")
      .replace(/\*/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (keywords.length === 0) return [];

    // Find messages whose content contains the keyword
    const matchingMessages = db._tables.messages.filter((m) => {
      if (!m.content) return false;
      const lower = (m.content as string).toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    });

    // DISTINCT session_id
    const seen = new Set<string>();
    const results: FakeRow[] = [];
    for (const msg of matchingMessages) {
      if (seen.has(msg.session_id as string)) continue;
      seen.add(msg.session_id as string);

      const session = db._tables.sessions.find(
        (s) => s.id === msg.session_id,
      );
      if (!session) continue;

      // Build a fake snippet with << >> markers around matched keyword
      const content = msg.content as string;
      let snippet = content;
      for (const kw of keywords) {
        snippet = snippet.replace(
          new RegExp(kw, "gi"),
          (m) => `<<${m}>>`,
        );
      }
      // Truncate to simulate SQLite snippet()
      if (snippet.length > 80) snippet = "..." + snippet.slice(0, 77);

      results.push({
        session_id: session.id,
        title: session.title ?? null,
        started_at: session.started_at,
        source: session.source,
        message_count: session.message_count,
        model: session.model,
        snippet,
      });

      if (results.length >= limit) break;
    }
    return results;
  }

  return [];
}

function makeFakeStatement(db: FakeDb, sql: string): FakeStatement {
  return {
    all(...params: unknown[]) {
      return execStatement(db, sql, params);
    },
    get(...params: unknown[]) {
      return execStatement(db, sql, params)[0];
    },
  };
}

// ─── Mutable current DB ref ───────────────────────────────────────────────────

let currentFakeDb: FakeDb = null!;

// ─── Mock better-sqlite3 ──────────────────────────────────────────────────────

vi.mock("better-sqlite3", () => {
  const MockDatabase = function (
    this: unknown,
    _path: string,
    _opts?: object,
  ): FakeDb {
    // Return the current test's fake DB (set in beforeEach)
    return currentFakeDb;
  };
  return { default: MockDatabase };
});

// ─── Import module under test ─────────────────────────────────────────────────

const { listSessions, getSessionMessages, searchSessions } = await import(
  "../src/main/sessions"
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _nextMsgId = 1;

function makeFreshDb(): FakeDb {
  _nextMsgId = 1;
  return {
    _closed: false,
    _tables: {
      sessions: [],
      messages: [],
      messages_fts: [], // exists by default
    },
    prepare(sql: string) {
      return makeFakeStatement(this, sql);
    },
    close() {
      this._closed = true;
    },
  };
}

function insertSession(
  db: FakeDb,
  row: {
    id: string;
    source?: string;
    started_at: number;
    ended_at?: number | null;
    message_count?: number;
    model?: string;
    title?: string | null;
  },
) {
  db._tables.sessions.push({
    id: row.id,
    source: row.source ?? "cli",
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
    message_count: row.message_count ?? 0,
    model: row.model ?? "claude",
    title: row.title ?? null,
  });
}

function insertMessage(
  db: FakeDb,
  row: {
    session_id: string;
    role: string;
    content: string | null;
    timestamp: number;
  },
) {
  db._tables.messages.push({
    id: _nextMsgId++,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  currentFakeDb = makeFreshDb();
  mockExistsSync.mockReturnValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// listSessions
// ─────────────────────────────────────────────────────────────────────────────

describe("listSessions", () => {
  it("returns empty array when the DB file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(listSessions()).toEqual([]);
  });

  it("returns empty array when there are no sessions", () => {
    expect(listSessions()).toEqual([]);
  });

  it("returns sessions sorted descending by started_at", () => {
    insertSession(currentFakeDb, { id: "sess-old", started_at: 1000 });
    insertSession(currentFakeDb, { id: "sess-new", started_at: 9000 });
    insertSession(currentFakeDb, { id: "sess-mid", started_at: 5000 });

    const result = listSessions();

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("sess-new");
    expect(result[1].id).toBe("sess-mid");
    expect(result[2].id).toBe("sess-old");
  });

  it("maps snake_case DB columns to camelCase fields", () => {
    insertSession(currentFakeDb, {
      id: "sess-1",
      source: "cli",
      started_at: 1234567890,
      ended_at: 1234567900,
      message_count: 7,
      model: "claude-3-opus",
      title: "My Chat",
    });

    const [session] = listSessions();

    expect(session.id).toBe("sess-1");
    expect(session.source).toBe("cli");
    expect(session.startedAt).toBe(1234567890);
    expect(session.endedAt).toBe(1234567900);
    expect(session.messageCount).toBe(7);
    expect(session.model).toBe("claude-3-opus");
    expect(session.title).toBe("My Chat");
    expect(session.preview).toBe(""); // always empty string in current impl
  });

  it("treats null ended_at and title correctly", () => {
    insertSession(currentFakeDb, {
      id: "sess-open",
      started_at: 1000,
      ended_at: null,
      title: null,
    });

    const [session] = listSessions();
    expect(session.endedAt).toBeNull();
    expect(session.title).toBeNull();
  });

  it("treats empty model as empty string (session.model || '')", () => {
    insertSession(currentFakeDb, {
      id: "sess-nomodel",
      started_at: 1000,
      model: "",
    });

    const [session] = listSessions();
    expect(session.model).toBe("");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      insertSession(currentFakeDb, { id: `sess-${i}`, started_at: i * 100 });
    }
    expect(listSessions(5)).toHaveLength(5);
  });

  it("respects the offset parameter", () => {
    for (let i = 0; i < 5; i++) {
      insertSession(currentFakeDb, { id: `sess-${i}`, started_at: i * 100 });
    }
    // Sorted desc: sess-4, sess-3, sess-2, sess-1, sess-0
    const page2 = listSessions(3, 3);
    expect(page2).toHaveLength(2);
    expect(page2[0].id).toBe("sess-1");
    expect(page2[1].id).toBe("sess-0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSessionMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("getSessionMessages", () => {
  it("returns empty array when the DB file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getSessionMessages("any-session")).toEqual([]);
  });

  it("returns empty array for a non-existent session id", () => {
    expect(getSessionMessages("does-not-exist")).toEqual([]);
  });

  it("returns messages in timestamp/id order", () => {
    insertSession(currentFakeDb, { id: "sess-abc", started_at: 1000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-abc",
      role: "user",
      content: "Hello there",
      timestamp: 1000,
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-abc",
      role: "assistant",
      content: "Hi back",
      timestamp: 2000,
    });

    const result = getSessionMessages("sess-abc");

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello there");
    expect(result[0].timestamp).toBe(1000);
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toBe("Hi back");
  });

  it("excludes messages with role 'tool'", () => {
    insertSession(currentFakeDb, { id: "sess-tools", started_at: 1000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-tools",
      role: "user",
      content: "Run the tool",
      timestamp: 1000,
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-tools",
      role: "tool",
      content: '{"result": 42}',
      timestamp: 1100,
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-tools",
      role: "assistant",
      content: "The answer is 42",
      timestamp: 1200,
    });

    const result = getSessionMessages("sess-tools");
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== "tool")).toBe(true);
  });

  it("excludes messages with null content", () => {
    insertSession(currentFakeDb, { id: "sess-null", started_at: 1000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-null",
      role: "user",
      content: null,
      timestamp: 1000,
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-null",
      role: "assistant",
      content: "Reply to nothing",
      timestamp: 2000,
    });

    const result = getSessionMessages("sess-null");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Reply to nothing");
  });

  it("does not return messages from a different session", () => {
    insertSession(currentFakeDb, { id: "sess-A", started_at: 1000 });
    insertSession(currentFakeDb, { id: "sess-B", started_at: 2000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-A",
      role: "user",
      content: "Message for A",
      timestamp: 1000,
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-B",
      role: "user",
      content: "Message for B",
      timestamp: 2000,
    });

    const result = getSessionMessages("sess-A");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Message for A");
  });

  it("maps DB columns to SessionMessage interface fields", () => {
    insertSession(currentFakeDb, { id: "sess-map", started_at: 1000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-map",
      role: "user",
      content: "Test content",
      timestamp: 9999,
    });

    const [msg] = getSessionMessages("sess-map");

    expect(typeof msg.id).toBe("number");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Test content");
    expect(msg.timestamp).toBe(9999);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// searchSessions
// ─────────────────────────────────────────────────────────────────────────────

describe("searchSessions", () => {
  it("returns empty array when the DB file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(searchSessions("hello")).toEqual([]);
  });

  it("returns empty array when the FTS table does not exist", () => {
    currentFakeDb._tables.messages_fts = null;
    expect(searchSessions("hello")).toEqual([]);
  });

  it("returns empty array when no messages match", () => {
    insertSession(currentFakeDb, { id: "sess-fts1", started_at: 1000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-fts1",
      role: "user",
      content: "Hello world",
      timestamp: 1000,
    });

    expect(searchSessions("zzznomatchzzz")).toEqual([]);
  });

  it("returns empty array for a blank query string", () => {
    expect(searchSessions("   ")).toEqual([]);
  });

  it("finds a session whose message matches the FTS query", () => {
    insertSession(currentFakeDb, {
      id: "sess-match",
      source: "cli",
      started_at: 5000,
      message_count: 2,
      model: "claude-3",
      title: "Interesting Talk",
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-match",
      role: "user",
      content: "Tell me about quantum computing",
      timestamp: 5000,
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-match",
      role: "assistant",
      content: "Quantum computing uses qubits",
      timestamp: 6000,
    });

    const result = searchSessions("quantum");

    expect(result.length).toBeGreaterThan(0);
    const hit = result.find((r) => r.sessionId === "sess-match");
    expect(hit).toBeDefined();
    expect(hit!.sessionId).toBe("sess-match");
    expect(hit!.title).toBe("Interesting Talk");
    expect(hit!.startedAt).toBe(5000);
    expect(hit!.source).toBe("cli");
    expect(hit!.messageCount).toBe(2);
    expect(hit!.model).toBe("claude-3");
  });

  it("returns a non-empty snippet string for matching messages", () => {
    insertSession(currentFakeDb, { id: "sess-snip", started_at: 1000 });
    insertMessage(currentFakeDb, {
      session_id: "sess-snip",
      role: "user",
      content: "The quick brown fox jumps over the lazy dog",
      timestamp: 1000,
    });

    const result = searchSessions("fox");
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].snippet).toBe("string");
    expect(result[0].snippet.length).toBeGreaterThan(0);
  });

  it("maps all SearchResult interface fields correctly", () => {
    insertSession(currentFakeDb, {
      id: "sess-fields",
      source: "web",
      started_at: 3000,
      message_count: 4,
      model: "gpt-4",
      title: "Field Test",
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-fields",
      role: "user",
      content: "Testing the field mapping",
      timestamp: 3000,
    });

    const result = searchSessions("testing");
    expect(result.length).toBeGreaterThan(0);

    const hit = result[0];
    expect(hit).toHaveProperty("sessionId");
    expect(hit).toHaveProperty("title");
    expect(hit).toHaveProperty("startedAt");
    expect(hit).toHaveProperty("source");
    expect(hit).toHaveProperty("messageCount");
    expect(hit).toHaveProperty("model");
    expect(hit).toHaveProperty("snippet");
  });

  it("treats empty model as empty string in search results (model || '')", () => {
    insertSession(currentFakeDb, {
      id: "sess-nomodel2",
      started_at: 1000,
      model: "",
    });
    insertMessage(currentFakeDb, {
      session_id: "sess-nomodel2",
      role: "user",
      content: "A message without model",
      timestamp: 1000,
    });

    const result = searchSessions("message");
    const hit = result.find((r) => r.sessionId === "sess-nomodel2");
    expect(hit).toBeDefined();
    expect(hit!.model).toBe("");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      insertSession(currentFakeDb, { id: `sess-lim-${i}`, started_at: i * 100 });
      insertMessage(currentFakeDb, {
        session_id: `sess-lim-${i}`,
        role: "user",
        content: `Shared keyword banana here ${i}`,
        timestamp: i * 100,
      });
    }

    const result = searchSessions("banana", 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});
