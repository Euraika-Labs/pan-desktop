import { useState } from "react";
import { ArrowRight, ExternalLink } from "../../assets/icons";
import { PROVIDERS, LOCAL_PRESETS } from "../../constants";

function Setup({ onComplete }: { onComplete: () => void }): React.JSX.Element {
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [modelName, setModelName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const provider = PROVIDERS.setup.find((p) => p.id === selectedProvider)!;
  const isLocal = selectedProvider === "local";
  const isCustomOpenai = selectedProvider === "custom-openai";
  const isCustomEndpoint = isLocal || isCustomOpenai;

  function applyLocalPreset(port: string): void {
    setBaseUrl(`http://localhost:${port}/v1`);
    // Clear stale fetched models when the URL changes via preset
    setAvailableModels([]);
    setFetchError("");
  }

  async function handleFetchModels(): Promise<void> {
    if (!baseUrl.trim()) {
      setFetchError("Enter a base URL first");
      return;
    }
    setFetchingModels(true);
    setFetchError("");
    setAvailableModels([]);
    try {
      const result = await window.hermesAPI.fetchRemoteModels(
        baseUrl.trim(),
        apiKey.trim() || null,
      );
      if (result.ok) {
        setAvailableModels(result.models);
        // Pre-select first model if nothing chosen yet
        if (!modelName && result.models.length > 0) {
          setModelName(result.models[0]);
        }
      } else {
        setFetchError(result.error ?? "Failed to fetch models");
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleContinue(): Promise<void> {
    if (provider.needsKey && !apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }
    if (isCustomEndpoint && !baseUrl.trim()) {
      setError(
        isLocal ? "Please enter the server URL" : "Please enter the API base URL",
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      // For fixed providers (openrouter/anthropic/openai) the key is required.
      // For custom-openai the key is OPTIONAL — only set it if the user typed
      // something, so endpoints without auth still work.
      if (provider.envKey && apiKey.trim()) {
        await window.hermesAPI.setEnv(provider.envKey, apiKey.trim());
      }

      const configProvider = isCustomEndpoint
        ? "custom"
        : provider.configProvider;
      const configBaseUrl = isCustomEndpoint ? baseUrl.trim() : provider.baseUrl;
      const configModel = modelName.trim() || "";
      await window.hermesAPI.setModelConfig(
        configProvider,
        configModel,
        configBaseUrl,
      );

      // For custom endpoints, save ALL fetched models to models.json so
      // they show up in the Models screen and the chat model picker.
      // Skip any that fail — partial success is better than none.
      if (isCustomEndpoint && availableModels.length > 0) {
        for (const id of availableModels) {
          try {
            await window.hermesAPI.addModel(
              id,
              "custom",
              id,
              baseUrl.trim(),
            );
          } catch {
            /* continue on failure */
          }
        }
      }

      onComplete();
    } catch {
      setError("Failed to save configuration");
      setSaving(false);
    }
  }

  return (
    <div className="screen setup-screen">
      <h1 className="setup-title">Set Up Your AI Provider</h1>
      <p className="setup-subtitle">
        Choose a provider and configure it to get started
      </p>

      <div className="setup-provider-grid">
        {PROVIDERS.setup.map((p) => (
          <button
            key={p.id}
            className={`setup-provider-card ${selectedProvider === p.id ? "selected" : ""}`}
            onClick={() => {
              setSelectedProvider(p.id);
              setError("");
              setAvailableModels([]);
              setFetchError("");
              // Reset baseUrl placeholder when switching between local /
              // custom cards so user isn't stuck with a stale URL.
              if (p.id === "local") {
                setBaseUrl("http://localhost:1234/v1");
              } else if (p.id === "custom-openai") {
                setBaseUrl("");
              }
            }}
          >
            <div className="setup-provider-name">{p.name}</div>
            <div className="setup-provider-desc">{p.desc}</div>
            {p.tag && <div className="setup-provider-tag">{p.tag}</div>}
          </button>
        ))}
      </div>

      <div className="setup-form">
        {isCustomEndpoint ? (
          <>
            {isLocal && (
              <>
                <label className="setup-label">Server Preset</label>
                <div className="setup-local-presets">
                  {LOCAL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`setup-local-preset ${baseUrl.includes(`:${preset.port}/`) ? "active" : ""}`}
                      onClick={() => applyLocalPreset(preset.port)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className="setup-label">
              {isLocal ? "Server URL" : "API Base URL"}
            </label>
            <input
              className="input"
              type="text"
              placeholder={
                isLocal
                  ? "http://localhost:1234/v1"
                  : "https://api.example.com/v1"
              }
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setError("");
                // Invalidate any previously-fetched list when URL changes
                setAvailableModels([]);
                setFetchError("");
              }}
              autoFocus
            />
            <div className="setup-field-hint">
              {isLocal
                ? "Make sure your local server is running before continuing"
                : "The OpenAI-compatible endpoint including /v1 if the provider uses it"}
            </div>

            {isCustomOpenai && (
              <>
                <label className="setup-label" style={{ marginTop: 16 }}>
                  API Key{" "}
                  <span className="setup-label-optional">optional</span>
                </label>
                <div className="setup-input-group">
                  <input
                    className="input"
                    type={showKey ? "text" : "password"}
                    placeholder={provider.placeholder}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setError("");
                    }}
                  />
                  <button
                    className="setup-toggle-visibility"
                    onClick={() => setShowKey(!showKey)}
                    type="button"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
                <div className="setup-field-hint">
                  Leave blank for endpoints that don&apos;t require
                  authentication. Stored as OPENAI_API_KEY.
                </div>
              </>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 16,
              }}
            >
              <label className="setup-label" style={{ margin: 0 }}>
                Model{" "}
                {availableModels.length === 0 && (
                  <span className="setup-label-optional">optional</span>
                )}
              </label>
              <button
                type="button"
                className="setup-link"
                onClick={handleFetchModels}
                disabled={fetchingModels || !baseUrl.trim()}
                style={{ marginLeft: 8 }}
              >
                {fetchingModels
                  ? "Fetching…"
                  : availableModels.length > 0
                    ? "Refresh list"
                    : "Fetch available models"}
              </button>
            </div>

            {availableModels.length > 0 ? (
              <>
                <select
                  className="input"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                >
                  {availableModels.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <div className="setup-field-hint">
                  {availableModels.length} model
                  {availableModels.length === 1 ? "" : "s"} discovered from the
                  endpoint. All will be added to your Models library.
                </div>
              </>
            ) : (
              <>
                <input
                  className="input"
                  type="text"
                  placeholder={
                    isLocal
                      ? "e.g. llama-3.1-8b"
                      : "e.g. gpt-4o-mini or hermes-3"
                  }
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                />
                <div className="setup-field-hint">
                  Leave blank to use the server&apos;s default model, or click
                  &quot;Fetch available models&quot; to discover what&apos;s
                  hosted.
                </div>
                {fetchError && (
                  <div className="setup-error" style={{ marginTop: 8 }}>
                    {fetchError}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <label className="setup-label">{provider.name} API Key</label>
            <div className="setup-input-group">
              <input
                className="input"
                type={showKey ? "text" : "password"}
                placeholder={provider.placeholder}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                autoFocus
              />
              <button
                className="setup-toggle-visibility"
                onClick={() => setShowKey(!showKey)}
                type="button"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>

            <button
              className="setup-link"
              onClick={() => window.hermesAPI.openExternal(provider.url)}
            >
              Don&apos;t have a key? Get one here
              <ExternalLink size={12} />
            </button>
          </>
        )}

        {error && <div className="setup-error">{error}</div>}

        <button
          className="btn btn-primary setup-continue"
          onClick={handleContinue}
          disabled={
            saving ||
            (provider.needsKey && !apiKey.trim()) ||
            (isCustomEndpoint && !baseUrl.trim())
          }
          style={{ marginTop: isCustomEndpoint ? 20 : 0 }}
        >
          {saving ? "Saving..." : "Continue"}
          {!saving && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}

export default Setup;
