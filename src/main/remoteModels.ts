/**
 * Remote model discovery for OpenAI-compatible endpoints.
 *
 * Calls `GET {baseUrl}/models` with an optional bearer token and returns
 * the list of model IDs. Used by the Setup screen's "Custom OpenAI-compatible"
 * card to populate a dropdown instead of forcing the user to type a model
 * name from memory.
 *
 * The OpenAI /v1/models spec returns:
 *   { object: "list", data: [{ id, object: "model", created, owned_by }, ...] }
 *
 * Every OpenAI-compatible provider (vLLM, Ollama, LM Studio, llama.cpp,
 * OpenRouter, Euraika hermes proxy, Anthropic via OAI shim, etc.) implements
 * this endpoint. We accept any response that has a top-level `data` array
 * whose elements have `id` string fields. Anything else is treated as an
 * endpoint that doesn't support discovery — the caller falls back to manual
 * entry.
 */

export interface FetchRemoteModelsResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export async function fetchRemoteModels(
  baseUrl: string,
  apiKey: string | null,
): Promise<FetchRemoteModelsResult> {
  if (!baseUrl || !baseUrl.trim()) {
    return { ok: false, models: [], error: "baseUrl is empty" };
  }

  // Normalize: strip trailing slash so we don't end up with //models.
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const url = `${normalized}/models`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  let response: Response;
  try {
    // 10s timeout — some self-hosted endpoints are slow on first hit but
    // anything over 10s is probably dead.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      models: [],
      error: `Network error: ${message}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      models: [],
      error: `HTTP ${response.status} ${response.statusText}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      models: [],
      error: "Response was not valid JSON",
    };
  }

  // Tolerant parser: accept OpenAI shape, Ollama shape, or anything with a
  // top-level array of strings. Strip duplicates and sort for stable UX.
  const ids = extractModelIds(payload);
  if (ids.length === 0) {
    return {
      ok: false,
      models: [],
      error: "Endpoint returned no models",
    };
  }

  return { ok: true, models: ids };
}

function extractModelIds(payload: unknown): string[] {
  // Shape 1: OpenAI spec — { data: [{ id: string }] }
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    const data = (payload as { data: unknown[] }).data;
    const ids = data
      .map((entry) =>
        entry &&
        typeof entry === "object" &&
        "id" in entry &&
        typeof (entry as { id: unknown }).id === "string"
          ? (entry as { id: string }).id
          : null,
      )
      .filter((id): id is string => id !== null && id.length > 0);
    return dedupSort(ids);
  }

  // Shape 2: Ollama /api/tags — { models: [{ name: string }] }
  // Some users may point Pan Desktop at the native Ollama port (11434/api/tags)
  // instead of the OAI-compat port (11434/v1). Best-effort support.
  if (
    payload &&
    typeof payload === "object" &&
    "models" in payload &&
    Array.isArray((payload as { models: unknown }).models)
  ) {
    const models = (payload as { models: unknown[] }).models;
    const ids = models
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          if (typeof e.id === "string") return e.id;
          if (typeof e.name === "string") return e.name;
        }
        return null;
      })
      .filter((id): id is string => id !== null && id.length > 0);
    return dedupSort(ids);
  }

  // Shape 3: bare array of strings
  if (Array.isArray(payload)) {
    const ids = payload.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    return dedupSort(ids);
  }

  return [];
}

function dedupSort(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}
