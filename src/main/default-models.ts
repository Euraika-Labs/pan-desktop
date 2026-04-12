/**
 * Default models seeded on first install.
 *
 * Contributors: add new models here! They'll be available to all users
 * on fresh install. Format:
 *   { name: "Display Name", provider: "provider-key", model: "model-id", baseUrl: "" }
 *
 * Provider keys: openrouter, anthropic, openai, regolo, custom
 * For openrouter models, use the full path (e.g. "anthropic/claude-sonnet-4-20250514")
 * For direct provider models, use the provider's model ID (e.g. "claude-sonnet-4-20250514")
 */

export interface DefaultModel {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
}

const DEFAULT_MODELS: DefaultModel[] = [
  // ── OpenRouter (200+ models via single API key) ──────────────────────
  {
    name: "Claude Sonnet 4",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4-20250514",
    baseUrl: "",
  },

  // ── Anthropic (direct) ───────────────────────────────────────────────
  {
    name: "Claude Sonnet 4",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "",
  },

  // ── OpenAI (direct) ──────────────────────────────────────────────────
  {
    name: "GPT-4.1",
    provider: "openai",
    model: "gpt-4.1",
    baseUrl: "",
  },

  // ── Regolo (EU-hosted, OpenAI-compatible) ───────────────────────────
  {
    name: "Llama 3.3 70B",
    provider: "regolo",
    model: "Llama-3.3-70B-Instruct",
    baseUrl: "https://api.regolo.ai/v1",
  },
  {
    name: "Qwen3 235B",
    provider: "regolo",
    model: "Qwen3-235B-A22B",
    baseUrl: "https://api.regolo.ai/v1",
  },
  {
    name: "DeepSeek R1",
    provider: "regolo",
    model: "DeepSeek-R1",
    baseUrl: "https://api.regolo.ai/v1",
  },
  {
    name: "Mistral Small 3.2",
    provider: "regolo",
    model: "Mistral-Small-3.2-24B-Instruct-2506",
    baseUrl: "https://api.regolo.ai/v1",
  },
];

export default DEFAULT_MODELS;
