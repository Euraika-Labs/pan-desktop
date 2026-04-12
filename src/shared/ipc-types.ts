/**
 * Shared IPC payload types — used by both main and preload.
 *
 * Each type corresponds to data sent over a push-channel (ipcRenderer.on /
 * ipcMain.emit).  Keeping them here gives us a single source of truth and
 * lets preload type-guard against them without duplicating the shape.
 */

// ── Installation / setup progress ─────────────────────────────────────────────
export interface SetupProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

export function isSetupProgress(v: unknown): v is SetupProgress {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["step"] === "number" &&
    typeof o["totalSteps"] === "number" &&
    typeof o["title"] === "string" &&
    typeof o["detail"] === "string" &&
    typeof o["log"] === "string"
  );
}

// ── Chat usage ────────────────────────────────────────────────────────────────
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function isChatUsage(v: unknown): v is ChatUsage {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["promptTokens"] === "number" &&
    typeof o["completionTokens"] === "number" &&
    typeof o["totalTokens"] === "number"
  );
}

// ── Chat approval request ─────────────────────────────────────────────────────
export interface ChatApprovalRequest {
  id: string;
  level: 1 | 2;
  command: string;
  patternKey: string;
  description: string;
  reason: string;
}

export function isChatApprovalRequest(v: unknown): v is ChatApprovalRequest {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["id"] === "string" &&
    (o["level"] === 1 || o["level"] === 2) &&
    typeof o["command"] === "string" &&
    typeof o["patternKey"] === "string" &&
    typeof o["description"] === "string" &&
    typeof o["reason"] === "string"
  );
}

// ── Auto-updater events ───────────────────────────────────────────────────────
export interface UpdateAvailableInfo {
  version: string;
  releaseNotes: string;
}

export function isUpdateAvailableInfo(v: unknown): v is UpdateAvailableInfo {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["version"] === "string" && typeof o["releaseNotes"] === "string"
  );
}

export interface UpdateDownloadProgress {
  percent: number;
}

export function isUpdateDownloadProgress(
  v: unknown,
): v is UpdateDownloadProgress {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["percent"] === "number";
}

// ── Tool progress event ───────────────────────────────────────────────────────
export interface ToolProgressEvent {
  type: "tool_progress";
  tool: string;
  status?: "started" | "running" | "completed" | "failed";
}
