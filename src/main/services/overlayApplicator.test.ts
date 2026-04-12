import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import {
  applyOverlays,
  type OverlayManifest,
  type OverlayResult,
} from "./overlayApplicator";

/*
 * Overlay applicator tests. These use real filesystem fixtures under
 * `os.tmpdir()` so we can verify atomic rename, parent-dir creation, and
 * drift detection without mocking fs. Each test gets its own isolated
 * temp root via `makeWorkspace` and cleans up in `afterEach`.
 *
 * The fixture layout mirrors what Pan Desktop sees in production:
 *
 *   workspace/
 *     hermesInstall/       # fake Hermes install tree
 *       tools/
 *       environments/
 *     overlayResources/    # fake `resources/overlays/`
 *       manifest.json
 *       tools/
 *       environments/
 *     stateDir/            # where pan-desktop-overlays.json is written
 */

let workspaces: string[] = [];

async function makeWorkspace(): Promise<{
  workspace: string;
  hermesInstallDir: string;
  overlayResourceDir: string;
  stateDir: string;
}> {
  const workspace = await fs.mkdtemp(join(tmpdir(), "overlay-test-"));
  workspaces.push(workspace);
  const hermesInstallDir = join(workspace, "hermesInstall");
  const overlayResourceDir = join(workspace, "overlayResources");
  const stateDir = join(workspace, "stateDir");
  await fs.mkdir(hermesInstallDir, { recursive: true });
  await fs.mkdir(overlayResourceDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  return { workspace, hermesInstallDir, overlayResourceDir, stateDir };
}

function sha256(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function writeFile(path: string, contents: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, contents);
}

async function writeManifest(
  overlayResourceDir: string,
  manifest: OverlayManifest,
): Promise<void> {
  await fs.writeFile(
    join(overlayResourceDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

function byTarget(
  results: OverlayResult[],
  target: string,
): OverlayResult | undefined {
  return results.find((r) => r.entry.target === target);
}

afterEach(async () => {
  for (const ws of workspaces) {
    try {
      await fs.rm(ws, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  workspaces = [];
});

describe("applyOverlays — replace mode", () => {
  it("replaces a pristine upstream file with the overlay", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    const upstream = "upstream pristine content\n";
    const overlay = "pan desktop overlay content\n";
    const upstreamHash = sha256(upstream);
    const overlayHash = sha256(overlay);

    await writeFile(join(hermesInstallDir, "tools/memory_tool.py"), upstream);
    await writeFile(join(overlayResourceDir, "tools/memory_tool.py"), overlay);
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/memory_tool.py",
          upstreamSha256: upstreamHash,
          overlaySha256: overlayHash,
          overlayFile: "tools/memory_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
      ],
    });

    const results = await applyOverlays({
      hermesInstallDir,
      overlayResourceDir,
      stateDir,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("applied");

    const onDisk = await fs.readFile(
      join(hermesInstallDir, "tools/memory_tool.py"),
      "utf8",
    );
    expect(onDisk).toBe(overlay);
  });

  it("reports 'already-applied' when target already matches the overlay hash", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    const upstream = "upstream pristine\n";
    const overlay = "already here\n";
    await writeFile(
      join(hermesInstallDir, "tools/memory_tool.py"),
      overlay, // target already matches overlay
    );
    await writeFile(join(overlayResourceDir, "tools/memory_tool.py"), overlay);
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/memory_tool.py",
          upstreamSha256: sha256(upstream),
          overlaySha256: sha256(overlay),
          overlayFile: "tools/memory_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
      ],
    });

    const results = await applyOverlays({
      hermesInstallDir,
      overlayResourceDir,
      stateDir,
    });

    expect(results[0].status).toBe("already-applied");
    // File untouched (still equal to overlay).
    const onDisk = await fs.readFile(
      join(hermesInstallDir, "tools/memory_tool.py"),
      "utf8",
    );
    expect(onDisk).toBe(overlay);
  });

  it("skips on drift — target matches neither upstream nor overlay", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    const upstream = "upstream pristine\n";
    const overlay = "pan desktop overlay\n";
    const drifted = "upstream has been modified since we pinned\n";

    await writeFile(join(hermesInstallDir, "tools/memory_tool.py"), drifted);
    await writeFile(join(overlayResourceDir, "tools/memory_tool.py"), overlay);
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/memory_tool.py",
          upstreamSha256: sha256(upstream),
          overlaySha256: sha256(overlay),
          overlayFile: "tools/memory_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
      ],
    });

    const results = await applyOverlays({
      hermesInstallDir,
      overlayResourceDir,
      stateDir,
    });

    expect(results[0].status).toBe("drift-skipped");
    // File MUST remain unchanged.
    const onDisk = await fs.readFile(
      join(hermesInstallDir, "tools/memory_tool.py"),
      "utf8",
    );
    expect(onDisk).toBe(drifted);
  });
});

describe("applyOverlays — create mode", () => {
  it("creates the target file when it does not exist", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    const overlay = "# new helper module\nprint('hi')\n";
    await writeFile(join(overlayResourceDir, "tools/_ipc.py"), overlay);
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/_ipc.py",
          upstreamSha256: "",
          overlaySha256: sha256(overlay),
          overlayFile: "tools/_ipc.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
          mode: "create",
        },
      ],
    });

    const results = await applyOverlays({
      hermesInstallDir,
      overlayResourceDir,
      stateDir,
    });

    expect(results[0].status).toBe("applied");
    const onDisk = await fs.readFile(
      join(hermesInstallDir, "tools/_ipc.py"),
      "utf8",
    );
    expect(onDisk).toBe(overlay);
  });

  it("skips when the target already exists (upstream may have merged an equivalent)", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    const existing = "# upstream-added helper — do not touch\n";
    await writeFile(join(hermesInstallDir, "tools/_ipc.py"), existing);
    await writeFile(
      join(overlayResourceDir, "tools/_ipc.py"),
      "# pan desktop version\n",
    );
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/_ipc.py",
          upstreamSha256: "",
          overlaySha256: sha256("# pan desktop version\n"),
          overlayFile: "tools/_ipc.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
          mode: "create",
        },
      ],
    });

    const results = await applyOverlays({
      hermesInstallDir,
      overlayResourceDir,
      stateDir,
    });

    expect(results[0].status).toBe("create-exists");
    const onDisk = await fs.readFile(
      join(hermesInstallDir, "tools/_ipc.py"),
      "utf8",
    );
    expect(onDisk).toBe(existing);
  });
});

describe("applyOverlays — atomicity + error isolation", () => {
  it("does not leave a stray .tmp file in the target dir after a successful replace", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    const upstream = "upstream\n";
    const overlay = "overlay\n";
    await writeFile(join(hermesInstallDir, "tools/memory_tool.py"), upstream);
    await writeFile(join(overlayResourceDir, "tools/memory_tool.py"), overlay);
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/memory_tool.py",
          upstreamSha256: sha256(upstream),
          overlaySha256: sha256(overlay),
          overlayFile: "tools/memory_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
      ],
    });

    await applyOverlays({ hermesInstallDir, overlayResourceDir, stateDir });

    const toolsDir = await fs.readdir(join(hermesInstallDir, "tools"));
    // The atomic write path creates `memory_tool.py.tmp` then renames.
    // A successful run must NOT leave that temp behind.
    expect(toolsDir).not.toContain("memory_tool.py.tmp");
    expect(toolsDir).toContain("memory_tool.py");
  });

  it("isolates per-entry errors — later overlays still apply when an earlier one fails", async () => {
    const { hermesInstallDir, overlayResourceDir, stateDir } =
      await makeWorkspace();

    // Overlay 1: target does not exist → errors
    // Overlay 2: valid replace → should still apply
    const upstream2 = "upstream two\n";
    const overlay2 = "overlay two\n";
    await writeFile(
      join(hermesInstallDir, "tools/code_execution_tool.py"),
      upstream2,
    );
    // NOTE: overlay file on disk for entry 1 is fine, but target path
    // `tools/memory_tool.py` is missing under hermesInstallDir. Replace
    // mode requires the target to exist so this errors.
    await writeFile(
      join(overlayResourceDir, "tools/memory_tool.py"),
      "overlay one\n",
    );
    await writeFile(
      join(overlayResourceDir, "tools/code_execution_tool.py"),
      overlay2,
    );
    await writeManifest(overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "abc",
      description: "test",
      overlays: [
        {
          target: "tools/memory_tool.py",
          upstreamSha256: sha256("upstream one\n"),
          overlaySha256: sha256("overlay one\n"),
          overlayFile: "tools/memory_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
        {
          target: "tools/code_execution_tool.py",
          upstreamSha256: sha256(upstream2),
          overlaySha256: sha256(overlay2),
          overlayFile: "tools/code_execution_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
      ],
    });

    const results = await applyOverlays({
      hermesInstallDir,
      overlayResourceDir,
      stateDir,
    });

    const first = byTarget(results, "tools/memory_tool.py");
    const second = byTarget(results, "tools/code_execution_tool.py");
    expect(first?.status).toBe("error");
    expect(first?.error).toBeTruthy();
    expect(second?.status).toBe("applied");

    const cetOnDisk = await fs.readFile(
      join(hermesInstallDir, "tools/code_execution_tool.py"),
      "utf8",
    );
    expect(cetOnDisk).toBe(overlay2);
  });
});

describe("applyOverlays — diagnostics summary", () => {
  let summaryWorkspace: {
    hermesInstallDir: string;
    overlayResourceDir: string;
    stateDir: string;
  };

  beforeEach(async () => {
    summaryWorkspace = await makeWorkspace();
    const upstream = "upstream\n";
    const overlay = "overlay\n";
    await writeFile(
      join(summaryWorkspace.hermesInstallDir, "tools/memory_tool.py"),
      upstream,
    );
    await writeFile(
      join(summaryWorkspace.overlayResourceDir, "tools/memory_tool.py"),
      overlay,
    );
    await writeManifest(summaryWorkspace.overlayResourceDir, {
      schemaVersion: 1,
      hermesAgentPinnedSha: "deadbeef",
      description: "test",
      overlays: [
        {
          target: "tools/memory_tool.py",
          upstreamSha256: sha256(upstream),
          overlaySha256: sha256(overlay),
          overlayFile: "tools/memory_tool.py",
          reason: "test",
          upstreamIssue: "",
          ticket: "TEST",
        },
      ],
    });
  });

  it("writes pan-desktop-overlays.json with applied-at timestamp and pinned sha", async () => {
    await applyOverlays(summaryWorkspace);
    const raw = await fs.readFile(
      join(summaryWorkspace.stateDir, "pan-desktop-overlays.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.hermesAgentPinnedSha).toBe("deadbeef");
    expect(typeof parsed.appliedAt).toBe("string");
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].status).toBe("applied");
    // ISO 8601 timestamp
    expect(parsed.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
