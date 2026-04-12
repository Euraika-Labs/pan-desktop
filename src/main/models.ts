import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { runtime } from "./runtime/instance";
import { safeWriteFile } from "./utils";
import DEFAULT_MODELS from "./default-models";

const MODELS_FILE = join(runtime.hermesHome, "models.json");

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

function readModels(): SavedModel[] {
  try {
    if (!existsSync(MODELS_FILE)) return [];
    return JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeModels(models: SavedModel[]): void {
  safeWriteFile(MODELS_FILE, JSON.stringify(models, null, 2));
}

function seedDefaults(): SavedModel[] {
  const models: SavedModel[] = DEFAULT_MODELS.map((def) => ({
    id: randomUUID(),
    name: def.name,
    provider: def.provider,
    model: def.model,
    baseUrl: def.baseUrl,
    createdAt: Date.now(),
  }));
  writeModels(models);
  return models;
}

export function listModels(): SavedModel[] {
  if (!existsSync(MODELS_FILE)) {
    return seedDefaults();
  }
  return readModels();
}

export function addModel(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): SavedModel {
  const models = readModels();

  // Dedup: if same model ID + provider exists, return existing
  const existing = models.find(
    (entry) => entry.model === model && entry.provider === provider,
  );
  if (existing) return existing;

  const entry: SavedModel = {
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
  };
  models.push(entry);
  writeModels(models);
  return entry;
}

export function removeModel(id: string): boolean {
  const models = readModels();
  const filtered = models.filter((entry) => entry.id !== id);
  if (filtered.length === models.length) return false;
  writeModels(filtered);
  return true;
}

/**
 * Sync models from a remote OpenAI-compatible /models endpoint.
 * Adds any models not already in the library. Used for providers
 * like Regolo where the full model catalog should be discoverable.
 */
export async function syncRemoteModels(
  provider: string,
  baseUrl: string,
  apiKey?: string,
): Promise<SavedModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    data?: Array<{ id: string; name?: string }>;
    models?: Array<{ id: string; name?: string }>;
  };
  const remoteModels = data.data || data.models || [];
  if (!Array.isArray(remoteModels)) return [];

  const existing = readModels();
  let added = false;
  for (const remote of remoteModels) {
    const exists = existing.some(
      (entry) => entry.model === remote.id && entry.provider === provider,
    );
    if (!exists) {
      existing.push({
        id: randomUUID(),
        name: remote.name || remote.id,
        provider,
        model: remote.id,
        baseUrl,
        createdAt: Date.now(),
      });
      added = true;
    }
  }
  if (added) writeModels(existing);
  return existing;
}

export function updateModel(
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): boolean {
  const models = readModels();
  const idx = models.findIndex((entry) => entry.id === id);
  if (idx === -1) return false;
  models[idx] = { ...models[idx], ...fields };
  writeModels(models);
  return true;
}
