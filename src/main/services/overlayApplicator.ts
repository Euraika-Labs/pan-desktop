import { createHash } from "crypto";
import { promises as fs } from "fs";
import { dirname, join } from "path";

/**
 * M1.1-#008 / M1.1-#009 — overlay applicator.
 *
 * Pan Desktop installs upstream Hermes Agent via a vendored PowerShell
 * installer (`resources/install.ps1`). Upstream still has a handful of
 * POSIX-only assumptions in its Python tree:
 *
 *   - `tools/memory_tool.py` uses `fcntl.flock` without guarding the
 *     import (M1.1-#008).
 *   - `tools/code_execution_tool.py` builds the in-process <-> child
 *     RPC channel on `socket.AF_UNIX` and flips a hard `SANDBOX_AVAILABLE
 *     = sys.platform != "win32"` gate (M1.1-#009).
 *   - `environments/tool_context.py` hardcodes `/tmp/_hermes_upload.b64`
 *     for chat file upload (M1.1-#009).
 *
 * Rather than fork the whole repo we ship minimal, targeted overlays that
 * replace those files byte-for-byte after install — but only when the
 * target on disk matches the pristine upstream SHA256 we tested against.
 * If upstream has since changed the file ("drift") we skip the overlay
 * and surface a diagnostic, so a future Hermes Agent bump can't silently
 * undo our fixes or, worse, clobber an upstream fix with a stale overlay.
 *
 * Design notes:
 *   - The manifest.json source of truth lives alongside the overlay files
 *     under `resources/overlays/` and gets copied into
 *     `process.resourcesPath/overlays/` at pack time via electron-builder's
 *     `extraResources`.
 *   - Every overlay has one of two modes: `replace` (default — require a
 *     pristine target on disk) or `create` (net-new files that live nowhere
 *     in upstream, e.g. `tools/_ipc.py`). Create mode refuses to overwrite
 *     any existing file in case upstream merges an equivalent helper later.
 *   - Writes are atomic (temp file + rename) so a crash mid-apply never
 *     leaves the target in a half-written state.
 *   - A per-entry summary is written to
 *     `{stateDir}/pan-desktop-overlays.json` after every run so the
 *     Diagnostics screen can show "overlays applied at {date} against
 *     Hermes Agent {sha}" without having to re-scan every file on disk.
 *
 * This applicator is intentionally a best-effort improvement, not a
 * blocking install step: if any individual overlay errors the install
 * still succeeds. Users can always fall back to unpatched upstream if
 * drift protection triggers.
 */

/** One row in the manifest — matches the shape serialized under resources/overlays/manifest.json. */
export interface OverlayEntry {
  /** Path under the Hermes install root where the overlay applies (e.g. `tools/memory_tool.py`). */
  target: string;
  /**
   * SHA256 of the pristine upstream file at `hermesAgentPinnedSha`. Empty
   * string for `create`-mode entries where there is no upstream baseline.
   */
  upstreamSha256: string;
  /** SHA256 of the overlay file shipped by Pan Desktop. */
  overlaySha256: string;
  /** Path under `overlayResourceDir` that holds the overlay bytes. */
  overlayFile: string;
  /** Human-readable justification — surfaced in logs and the manifest summary. */
  reason: string;
  /** Optional upstream issue URL so contributors can track resolution. */
  upstreamIssue: string;
  /** M1.1 ticket ID for cross-referencing. */
  ticket: string;
  /**
   * Apply mode.
   *   - `replace` (default) — target must exist and match `upstreamSha256`.
   *   - `create` — target must NOT exist; overlay is written as a new file.
   */
  mode?: "replace" | "create";
}

/** Shape of `resources/overlays/manifest.json`. */
export interface OverlayManifest {
  schemaVersion: number;
  /** Pinned upstream commit the overlays were computed against. */
  hermesAgentPinnedSha: string;
  description: string;
  overlays: OverlayEntry[];
}

/**
 * Outcome for a single overlay apply attempt.
 *
 *   - `applied`          — target was replaced / created successfully.
 *   - `already-applied`  — target already matches the overlay hash; no-op.
 *   - `drift-skipped`    — target exists but matches neither upstream nor
 *                          overlay, so we refuse to overwrite.
 *   - `create-exists`    — create-mode target already exists; no-op.
 *   - `error`            — an exception was thrown; message captured in
 *                          `OverlayResult.error`.
 */
export type OverlayStatus =
  | "applied"
  | "already-applied"
  | "drift-skipped"
  | "create-exists"
  | "error";

/** Full result row returned by `applyOverlays`. */
export interface OverlayResult {
  entry: OverlayEntry;
  status: OverlayStatus;
  error?: string;
}

/** Shape of `{stateDir}/pan-desktop-overlays.json` — per-install diagnostics. */
export interface OverlayRunRecord {
  appliedAt: string;
  hermesAgentPinnedSha: string;
  entries: OverlayResult[];
}

/** Options bundle for `applyOverlays` — kept as a single object so tests don't care about positional order. */
export interface ApplyOverlaysOptions {
  /** Root of the installed Hermes Agent tree — overlay targets are resolved relative to this. */
  hermesInstallDir: string;
  /** Directory on disk that holds the overlay bundle (manifest.json + per-file payloads). */
  overlayResourceDir: string;
  /** Where to write the `pan-desktop-overlays.json` diagnostics summary. */
  stateDir: string;
  /** Optional progress callback — invoked with a short human-readable status line per overlay. */
  onProgress?: (status: string) => void;
}

/**
 * Apply all overlays defined in `manifest.json` using SHA256
 * match-before-replace to avoid blindly overwriting upstream-changed files.
 *
 * Returns one `OverlayResult` per entry so callers can render a summary
 * into the Install log. Never throws for individual overlay errors — the
 * exception is caught, logged via `onProgress`, and the run continues.
 * A top-level exception (e.g. the manifest itself can't be read) DOES
 * bubble up — that's a genuine install bug worth surfacing.
 */
export async function applyOverlays(
  opts: ApplyOverlaysOptions,
): Promise<OverlayResult[]> {
  const { hermesInstallDir, overlayResourceDir, stateDir, onProgress } = opts;

  const manifestPath = join(overlayResourceDir, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as OverlayManifest;

  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Unsupported overlay manifest schemaVersion ${manifest.schemaVersion} (expected 1)`,
    );
  }

  const results: OverlayResult[] = [];

  for (const entry of manifest.overlays) {
    const result = await applySingleOverlay({
      entry,
      hermesInstallDir,
      overlayResourceDir,
    });
    results.push(result);
    if (onProgress) {
      onProgress(formatProgress(result));
    }
  }

  // Write the diagnostics summary last. Failures here are not fatal —
  // the install itself succeeded and future runs can always regenerate
  // the record.
  try {
    await writeRunRecord(stateDir, {
      appliedAt: new Date().toISOString(),
      hermesAgentPinnedSha: manifest.hermesAgentPinnedSha,
      entries: results,
    });
  } catch (err) {
    if (onProgress) {
      onProgress(`WARN: failed to write overlay summary: ${errorMessage(err)}`);
    }
  }

  return results;
}

/**
 * Apply a single overlay entry, catching all exceptions into an
 * `error` result so the outer loop can keep going.
 */
async function applySingleOverlay(args: {
  entry: OverlayEntry;
  hermesInstallDir: string;
  overlayResourceDir: string;
}): Promise<OverlayResult> {
  const { entry, hermesInstallDir, overlayResourceDir } = args;
  const mode: "replace" | "create" = entry.mode ?? "replace";

  try {
    const targetPath = join(hermesInstallDir, entry.target);
    const overlayPath = join(overlayResourceDir, entry.overlayFile);

    if (mode === "create") {
      const exists = await pathExists(targetPath);
      if (exists) {
        return { entry, status: "create-exists" };
      }
      await atomicCopy(overlayPath, targetPath);
      return { entry, status: "applied" };
    }

    // mode === "replace"
    if (!(await pathExists(targetPath))) {
      return {
        entry,
        status: "error",
        error: `target does not exist: ${targetPath}`,
      };
    }

    const actualHash = await sha256OfFile(targetPath);

    if (actualHash === entry.overlaySha256) {
      return { entry, status: "already-applied" };
    }

    if (actualHash !== entry.upstreamSha256) {
      return { entry, status: "drift-skipped" };
    }

    await atomicCopy(overlayPath, targetPath);
    return { entry, status: "applied" };
  } catch (err) {
    return { entry, status: "error", error: errorMessage(err) };
  }
}

/**
 * Compute the SHA256 of a file by reading its full contents. Overlays
 * are small Python files (< 100 KB) so a single `readFile` is simpler
 * and fast enough — we don't need a streaming digest here.
 */
async function sha256OfFile(path: string): Promise<string> {
  const h = createHash("sha256");
  h.update(await fs.readFile(path));
  return h.digest("hex");
}

/**
 * Copy `src` to `dst` via a `.tmp` sibling + `rename`. Rename is atomic
 * on every supported filesystem so readers never see a half-written file.
 * The target's parent directory is created if missing (important for
 * `create`-mode overlays like `tools/_ipc.py` when `tools/` exists but
 * Pan Desktop adds a net-new subdirectory).
 */
async function atomicCopy(src: string, dst: string): Promise<void> {
  await fs.mkdir(dirname(dst), { recursive: true });
  const tmp = `${dst}.tmp`;
  const data = await fs.readFile(src);
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, dst);
  } catch (err) {
    // Best effort cleanup — if rename failed the temp file is orphaned.
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeRunRecord(
  stateDir: string,
  record: OverlayRunRecord,
): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const out = join(stateDir, "pan-desktop-overlays.json");
  const tmp = `${out}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, out);
}

function formatProgress(result: OverlayResult): string {
  const base = `${result.entry.target}: ${result.status}`;
  if (result.status === "error" && result.error) {
    return `${base} (${result.error})`;
  }
  return base;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
