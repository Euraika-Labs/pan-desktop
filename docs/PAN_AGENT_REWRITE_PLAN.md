# Pan-Agent Rewrite Plan

**From:** Electron + Python (Pan Desktop + Hermes Agent)
**To:** Tauri + React (desktop) + Go (agent)
**Author:** Claude Code session, 2026-04-12
**Status:** Draft — awaiting Bert's review

---

## Why

| Problem | Current | After rewrite |
|---|---|---|
| Install size | ~300MB (Electron + Python venv) | ~35MB (Tauri + Go binary) |
| Install flow | Download → SmartScreen → install.ps1 → venv → overlays | Download → run |
| Startup time | 3-5s | <500ms |
| Memory usage | ~300MB (Chromium + Python) | ~30-50MB |
| Windows support | 5 Python overlays + platform adapter layer | Native (Go stdlib) |
| PC control | Limited (Python subprocess tools) | Full Windows API |
| Build complexity | npm ci + node-gyp + VC++ + Python | `go build` + `npm run build` |
| Upstream sync | SHA256 overlay pinning | Own codebase — no upstream dependency |

## Architecture

```
pan-agent/                          ← Go module (the agent)
├── cmd/pan-agent/main.go           ← CLI + daemon entry point
├── internal/                       ← All business logic
└── go.mod

pan-desktop/                        ← Tauri app (the UI)
├── src-tauri/                      ← Rust shim (thin — just launches pan-agent)
│   ├── src/main.rs
│   └── Cargo.toml
├── src/                            ← React frontend (migrated from current)
│   ├── App.tsx
│   ├── screens/
│   └── components/
├── package.json
└── tauri.conf.json
```

**Key insight:** Tauri's Rust layer is minimal — it just embeds WebView2 and manages the window. All agent logic lives in the Go binary. The React frontend talks to Go via HTTP (localhost), not Tauri IPC. This means:
- Go binary can run headless (CLI mode, server mode, or desktop mode)
- React frontend is reusable across Tauri desktop, web browser, and mobile webview
- No Rust knowledge needed beyond the thin Tauri shim

---

## What moves where

### React frontend (keep ~90%, migrate framework)

| Current (Electron) | New (Tauri) | Change |
|---|---|---|
| `src/renderer/src/screens/Chat/` | `pan-desktop/src/screens/Chat/` | Replace `window.panAPI.*` with `fetch()` to Go HTTP API |
| `src/renderer/src/screens/Sessions/` | Same | Same migration |
| `src/renderer/src/screens/Settings/` | Same | Same |
| `src/renderer/src/components/ApprovalModal.tsx` | Same | Same — talks to Go API |
| `src/renderer/src/components/AgentMarkdown.tsx` | Same | No change |
| `src/preload/index.ts` (IPC bridge) | **Delete** | Replaced by HTTP client |
| `src/shared/channels.ts` (100 IPC channels) | **Delete** | Replaced by REST endpoints |
| Tailwind + Lucide + react-markdown | Same | No change |

### Go agent (rewrite from Python + TypeScript)

| Current | New Go package | Lines est. |
|---|---|---|
| `hermes.ts` (chat API + gateway) | `internal/gateway/` | ~400 |
| `config.ts` (.env, YAML, credentials) | `internal/config/` | ~300 |
| `sessions.ts` (SQLite history) | `internal/storage/sessions.go` | ~150 |
| `tools.ts` (16 toolsets) | `internal/tools/` (one file per tool) | ~1500 |
| `skills.ts` (discovery, SKILL.md) | `internal/skills/` | ~200 |
| `cronjobs.ts` (cron management) | `internal/cron/` | ~150 |
| `memory.ts` (MEMORY.md, USER.md) | `internal/memory/` | ~150 |
| `soul.ts` (SOUL.md persona) | `internal/persona/` | ~50 |
| `models.ts` (model library) | `internal/models/` | ~150 |
| `claw3d.ts` (OpenClaw) | `internal/claw3d/` | ~300 |
| `approval.py` (pattern matching) | `internal/approval/` | ~400 |
| `platformAdapter.ts` | **Delete** — Go handles natively | 0 |
| `processRunner.ts` | **Delete** — `os/exec` is sufficient | 0 |
| `runtimePaths.ts` | `internal/paths/` | ~80 |
| `runtimeInstaller.ts` | **Delete** — Go binary is self-contained | 0 |
| `overlayApplicator.ts` | **Delete** — no more Python overlays | 0 |

**Estimated Go code:** ~4,000 lines (vs ~8,000 lines TypeScript + Python today)

### What gets deleted entirely

| Component | Why |
|---|---|
| `src/main/platform/platformAdapter.ts` | Go's stdlib is cross-platform natively |
| `src/main/platform/processRunner.ts` | `os/exec.Command` handles everything |
| `src/main/runtime/runtimeInstaller.ts` | No Python venv to install |
| `src/main/runtime/runtimeUpdate.ts` | Go binary self-updates |
| `src/main/services/overlayApplicator.ts` | No more Python overlays |
| `resources/overlays/` (all 7 files) | No more Python to patch |
| `resources/install.ps1` | No more venv installation |
| `src/preload/` (IPC bridge) | HTTP replaces Electron IPC |
| `src/shared/channels.ts` | HTTP replaces IPC channels |
| `build/afterPack.js` | Tauri handles packaging |
| `electron-builder.yml` | Tauri handles packaging |
| `electron.vite.config.ts` | Vite stays but no electron-vite |
| `better-sqlite3` dependency | Go uses `mattn/go-sqlite3` or `modernc.org/sqlite` |

---

## Go Agent — Detailed Module Design

### `cmd/pan-agent/main.go`

```go
func main() {
    app := &cli.App{
        Name: "pan-agent",
        Commands: []*cli.Command{
            {Name: "serve", Action: serveHTTP},     // HTTP API server (desktop mode)
            {Name: "chat", Action: chatCLI},         // Interactive CLI chat
            {Name: "gateway", Subcommands: []*cli.Command{
                {Name: "run", Action: gatewayRun},
                {Name: "stop", Action: gatewayStop},
                {Name: "status", Action: gatewayStatus},
            }},
            {Name: "skills", ...},
            {Name: "cron", ...},
            {Name: "doctor", Action: doctor},
            {Name: "version", Action: version},
        },
    }
    app.Run(os.Args)
}
```

### `internal/gateway/server.go` — HTTP API

```
POST /v1/chat/completions     ← SSE streaming chat (OpenAI-compatible)
POST /v1/chat/abort           ← Cancel current generation
POST /v1/approvals/{id}       ← Resolve pending approval
GET  /v1/approvals/{id}       ← Poll approval status
GET  /v1/approvals            ← List pending approvals
GET  /v1/sessions             ← List sessions (with ?q= search)
GET  /v1/sessions/{id}        ← Get session messages
GET  /v1/models               ← List available models
POST /v1/models               ← Add model
DELETE /v1/models/{id}        ← Remove model
POST /v1/models/sync          ← Sync from remote provider
GET  /v1/config               ← Read config
PUT  /v1/config               ← Update config
GET  /v1/memory               ← Read memory entries
POST /v1/memory               ← Add entry
PUT  /v1/memory/{index}       ← Update entry
DELETE /v1/memory/{index}     ← Remove entry
GET  /v1/skills               ← List skills
POST /v1/skills/install       ← Install skill
POST /v1/skills/uninstall     ← Uninstall skill
GET  /v1/cron                 ← List cron jobs
POST /v1/cron                 ← Create cron job
DELETE /v1/cron/{id}          ← Remove cron job
GET  /v1/health               ← Health check
GET  /v1/tools                ← List toolsets
PUT  /v1/tools/{key}          ← Toggle toolset
GET  /v1/claw3d/status        ← Claw3D status
POST /v1/claw3d/setup         ← Setup Claw3D
POST /v1/claw3d/start         ← Start dev server + adapter
POST /v1/claw3d/stop          ← Stop all
```

This replaces all 100+ Electron IPC channels with a clean REST API.

### `internal/tools/` — The 16 Tool Implementations

```
internal/tools/
├── registry.go            ← Tool interface + registration
├── terminal.go            ← Shell commands (cmd/powershell/bash)
├── filesystem.go          ← File CRUD + search
├── browser.go             ← go-rod browser automation
├── code_execution.go      ← Sandboxed Python/shell execution
├── web_search.go          ← Web search (Tavily, Exa, etc.)
├── vision.go              ← Image analysis via multimodal LLM
├── image_gen.go           ← DALL-E / Fal.ai image generation
├── tts.go                 ← Text-to-speech
├── memory_tool.go         ← In-agent memory operations
├── session_search.go      ← Search past conversations
├── clarify.go             ← Ask user for clarification
├── delegation.go          ← Sub-agent spawning
├── cron_tool.go           ← Create/manage scheduled tasks
├── moa.go                 ← Mixture of Agents
└── todo.go                ← Task planning
```

Each tool implements:

```go
type Tool interface {
    Name() string
    Description() string
    Parameters() json.RawMessage       // JSON Schema for LLM function calling
    Execute(ctx context.Context, call ToolCall) (ToolResult, error)
    DangerLevel(params json.RawMessage) approval.Level  // 0, 1, or 2
}
```

### `internal/approval/` — Danger Detection

Port all 109 patterns (69 Level 1 + 40 Level 2) from Python regex to Go regex:

```go
var DangerousPatterns = []Pattern{
    {Regex: regexp.MustCompile(`(?i)\brm\s+-[^\s]*r`), Key: "rm -r", Desc: "Recursive delete"},
    {Regex: regexp.MustCompile(`(?i)\bdel\s+/s`), Key: "del /s", Desc: "Recursive Windows delete"},
    // ... 67 more
}

var CatastrophicPatterns = []Pattern{
    {Regex: regexp.MustCompile(`(?i)vssadmin\s+delete\s+shadows`), Key: "vssadmin", Desc: "Shadow copy deletion"},
    {Regex: regexp.MustCompile(`(?i)bcdedit\s+/set`), Key: "bcdedit", Desc: "Boot config tampering"},
    // ... 38 more
}

func Check(command string) ApprovalCheck {
    command = normalize(command) // Strip ANSI, null bytes, NFKC normalize
    for _, p := range CatastrophicPatterns {
        if p.Regex.MatchString(command) {
            return ApprovalCheck{Level: 2, Pattern: p}
        }
    }
    for _, p := range DangerousPatterns {
        if p.Regex.MatchString(command) {
            return ApprovalCheck{Level: 1, Pattern: p}
        }
    }
    return ApprovalCheck{Level: 0}
}
```

### `internal/llm/` — LLM Provider Client

```go
type Provider struct {
    Name    string // "openai", "anthropic", "regolo", "ollama", etc.
    BaseURL string
    APIKey  string
    Model   string
}

func (p *Provider) ChatStream(ctx context.Context, messages []Message, tools []Tool) (<-chan StreamEvent, error) {
    // POST to baseURL/chat/completions with streaming
    // Parse SSE events: content deltas, tool calls, usage
    // Returns channel of StreamEvent (chunk | tool_call | done | error | usage)
}
```

Supports all current providers: OpenAI, Anthropic, OpenRouter, Regolo, Groq, GLM, Kimi, MiniMax, HuggingFace, Ollama, vLLM, llama.cpp, LM Studio.

### `internal/storage/` — Data Layer

```go
// SQLite for sessions (read-write now — we own the DB)
type SessionStore struct {
    db *sql.DB
}

func (s *SessionStore) List(limit, offset int) ([]Session, error)
func (s *SessionStore) Search(query string, limit int) ([]SearchResult, error)
func (s *SessionStore) GetMessages(sessionID string) ([]Message, error)
func (s *SessionStore) CreateSession(model string) (*Session, error)
func (s *SessionStore) AddMessage(sessionID string, msg Message) error

// File-based for config, memory, persona (keep compatibility)
type ConfigStore struct { ... }   // .env + config.yaml
type MemoryStore struct { ... }   // MEMORY.md + USER.md (§ delimiter)
type PersonaStore struct { ... }  // SOUL.md
type ModelStore struct { ... }    // models.json
```

---

## Tauri Desktop — Migration Steps

### `src-tauri/src/main.rs` (minimal)

```rust
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Spawn pan-agent binary as a sidecar
            let sidecar = app.shell()
                .sidecar("pan-agent")
                .args(["serve", "--port", "8642"])
                .spawn()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap();
}
```

### React Migration Checklist

For every screen, the change is mechanical — replace `window.panAPI.xxx()` with `fetch()`:

```tsx
// BEFORE (Electron IPC)
const sessions = await window.panAPI.listSessions(30, 0);

// AFTER (HTTP to Go)
const res = await fetch("http://localhost:8642/v1/sessions?limit=30&offset=0");
const sessions = await res.json();
```

```tsx
// BEFORE (Electron IPC streaming)
const cleanup = window.panAPI.onChatChunk((chunk) => { ... });
window.panAPI.sendMessage(text, profile);

// AFTER (SSE streaming to Go)
const eventSource = new EventSource(
    `http://localhost:8642/v1/chat/completions?stream=true`
);
eventSource.onmessage = (e) => { ... };
```

| Screen | Effort | Notes |
|---|---|---|
| Chat.tsx | Medium | Replace IPC with EventSource SSE |
| Sessions.tsx | Low | Replace IPC with fetch |
| Settings.tsx | Low | Replace IPC with fetch |
| Models.tsx | Low | Replace IPC with fetch |
| Memory.tsx | Low | Replace IPC with fetch |
| Soul.tsx | Low | Replace IPC with fetch |
| Tools.tsx | Low | Replace IPC with fetch |
| Skills.tsx | Low | Replace IPC with fetch |
| Schedules.tsx | Low | Replace IPC with fetch |
| Office.tsx (Claw3D) | Low | WebSocket stays the same |
| ApprovalModal.tsx | Low | Already uses HTTP POST |
| Install.tsx | **Delete** | No Python install needed |
| Welcome.tsx | Simplify | Just "first run" setup |

---

## Phased Execution

### Phase 1 — Go Agent Core (weeks 1-2)

**Goal:** `pan-agent serve` runs and handles chat with one provider.

| Task | Est. |
|---|---|
| Project scaffold: `go mod init`, CLI framework (`urfave/cli/v2`) | 2h |
| `internal/config/` — .env + config.yaml parser | 4h |
| `internal/paths/` — cross-platform path resolution | 2h |
| `internal/llm/` — OpenAI-compatible streaming client | 6h |
| `internal/gateway/server.go` — HTTP server with `/v1/chat/completions` SSE | 4h |
| `internal/storage/sessions.go` — SQLite session CRUD | 4h |
| `internal/persona/` — SOUL.md read/write | 1h |
| `internal/memory/` — MEMORY.md + USER.md CRUD | 3h |
| Integration test: chat with Regolo, session saved, memory works | 4h |
| **Phase 1 total** | **~30h** |

**Exit criteria:** `pan-agent serve` → `curl localhost:8642/v1/chat/completions` returns streaming response from Regolo.

### Phase 2 — Tool System (weeks 3-4)

**Goal:** Agent can execute tools and respect approval gates.

| Task | Est. |
|---|---|
| `internal/tools/registry.go` — tool interface + OpenAI function calling format | 4h |
| `internal/tools/terminal.go` — shell command execution | 4h |
| `internal/tools/filesystem.go` — file CRUD | 3h |
| `internal/tools/web_search.go` — Tavily/Exa integration | 3h |
| `internal/tools/browser.go` — go-rod browser automation | 6h |
| `internal/tools/code_execution.go` — sandboxed execution | 4h |
| `internal/approval/` — port 109 patterns from Python | 4h |
| `internal/approval/` — SSE approval flow (request/resolve) | 3h |
| Remaining tools (vision, image_gen, tts, skills, delegation, clarify, moa, todo, cron, session_search, memory_tool) | 12h |
| Integration test: agent uses terminal tool with approval gate | 4h |
| **Phase 2 total** | **~47h** |

**Exit criteria:** Agent can browse the web, run shell commands (with approval), read/write files, execute code.

### Phase 3 — Tauri Desktop (weeks 5-6)

**Goal:** React frontend running in Tauri, talking to Go backend.

| Task | Est. |
|---|---|
| Tauri project scaffold (`create-tauri-app`) | 2h |
| Sidecar config: bundle `pan-agent.exe` as Tauri sidecar | 3h |
| API client module: replace all `window.panAPI.*` with `fetch()` | 8h |
| Chat screen: migrate to EventSource SSE | 4h |
| Settings/Models/Skills/Memory/Persona screens: migrate to fetch | 6h |
| ApprovalModal: verify works with Go approval API | 2h |
| Sessions screen: migrate to fetch | 2h |
| System tray integration (Tauri native) | 2h |
| Window management (Tauri native — title bar, menu) | 3h |
| Remove Electron-specific code (preload, IPC channels, electron-vite) | 2h |
| **Phase 3 total** | **~34h** |

**Exit criteria:** Tauri app launches, embeds pan-agent sidecar, full chat works with approval.

### Phase 4 — Claw3D + Skills + Cron (week 7)

**Goal:** Feature parity with current Pan Desktop.

| Task | Est. |
|---|---|
| `internal/claw3d/` — clone, install, dev server, adapter management | 6h |
| `internal/skills/` — discovery, SKILL.md parsing, install/uninstall | 4h |
| `internal/cron/` — job management (own implementation, not CLI wrapper) | 4h |
| `internal/models/` — model library, remote sync | 3h |
| Office.tsx screen migration | 2h |
| Schedules.tsx screen migration | 2h |
| **Phase 4 total** | **~21h** |

### Phase 5 — Distribution + Auto-Update (week 8)

**Goal:** Installable, updatable release.

| Task | Est. |
|---|---|
| Tauri config: NSIS + MSI + portable targets | 3h |
| Code signing via Tauri's built-in support (or SignPath) | 4h |
| Auto-update: Tauri updater (built-in, simpler than electron-updater) | 3h |
| CI: GitHub Actions build matrix (Windows/macOS/Linux) | 4h |
| CI: GitLab mirror pipeline | 2h |
| MSIX packaging for Microsoft Store (optional — eliminates SmartScreen) | 4h |
| **Phase 5 total** | **~20h** |

### Phase 6 — PC Control (Cowork-level) (weeks 9-10)

**Goal:** Agent can see and control the desktop.

| Task | Est. |
|---|---|
| Screen capture: `kbinani/screenshot` integration | 3h |
| OCR: send screenshots to multimodal LLM for understanding | 4h |
| Window management: list windows, focus, resize, move | 4h |
| Keyboard simulation: `micmonay/keybd_event` | 3h |
| Mouse simulation: click, drag, scroll | 3h |
| Clipboard: read/write system clipboard | 1h |
| Agent loop: think → see screen → decide action → execute → observe | 8h |
| Safety: approval gates for all desktop control actions | 3h |
| **Phase 6 total** | **~29h** |

**Exit criteria:** Agent can be told "open Notepad, type hello, save as test.txt" and execute it autonomously with screen verification.

---

## Timeline Summary

| Phase | Scope | Est. hours | Calendar (1 dev) |
|---|---|---|---|
| 1 | Go agent core (chat, config, sessions, memory) | 30h | Week 1-2 |
| 2 | Tool system (16 tools, approval, browser automation) | 47h | Week 3-4 |
| 3 | Tauri desktop (React migration, sidecar) | 34h | Week 5-6 |
| 4 | Claw3D, skills, cron, models | 21h | Week 7 |
| 5 | Distribution, auto-update, CI | 20h | Week 8 |
| 6 | PC control (screen, keyboard, mouse, OCR) | 29h | Week 9-10 |
| **Total** | | **~181h** | **~10 weeks** |

---

## Go Dependencies

```go
// go.mod
module github.com/euraika-labs/pan-agent

go 1.23

require (
    github.com/urfave/cli/v2          // CLI framework
    github.com/mattn/go-sqlite3       // SQLite (CGo) or modernc.org/sqlite (pure Go)
    github.com/go-rod/rod             // Browser automation (Chromium DevTools Protocol)
    github.com/gorilla/mux            // HTTP router (or stdlib http.ServeMux in Go 1.22+)
    github.com/kbinani/screenshot     // Screen capture
    github.com/micmonay/keybd_event   // Keyboard simulation
    github.com/atotto/clipboard       // Clipboard access
    github.com/shirou/gopsutil/v3     // Process management
    github.com/fsnotify/fsnotify      // File watching
    gopkg.in/yaml.v3                  // YAML parsing
    github.com/google/uuid            // UUID generation
    golang.org/x/sys                  // Windows API access
)
```

## Migration Strategy

**Parallel development** — keep current Pan Desktop working while building Pan-Agent:

```
Week 1-4:   Build Go agent in new repo (github.com/Euraika-Labs/pan-agent)
            Current Pan Desktop still ships for users
Week 5-6:   Build Tauri shell, migrate React screens
            Internal testing with pan-agent
Week 7-8:   Feature parity + distribution
            Beta release to select users
Week 9-10:  PC control + polish
            Public release as v1.0
Week 11:    Deprecate old Pan Desktop
            Redirect downloads to pan-agent
```

## Data Migration

When a user upgrades from Pan Desktop to Pan-Agent:

```go
func MigrateFromPanDesktop() error {
    // 1. Copy config
    //    %LOCALAPPDATA%\hermes\.env → %LOCALAPPDATA%\pan-agent\.env
    //    %LOCALAPPDATA%\hermes\config.yaml → %LOCALAPPDATA%\pan-agent\config.yaml

    // 2. Copy memory + persona
    //    MEMORY.md, USER.md, SOUL.md

    // 3. Copy session history
    //    state.db (SQLite — same schema, just copy the file)

    // 4. Copy skills
    //    skills/ directory tree

    // 5. Copy models.json, auth.json

    // 6. Leave old install intact (user can roll back)
    return nil
}
```

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Go rewrite takes longer than estimated | High | Medium | Phase 1-3 are the critical path; Phase 4-6 can be deferred |
| go-rod browser automation is less mature than Playwright | Medium | Medium | Fall back to `chromedp` or spawn Playwright as subprocess |
| Tauri WebView2 rendering differs from Chromium (Electron) | Low | Medium | WebView2 IS Chromium — same engine, Edge-based |
| `modernc.org/sqlite` (pure Go) is slower than C-based sqlite3 | Low | Low | Use `mattn/go-sqlite3` with CGo if needed |
| Users resist switching from Python Hermes to Go Pan-Agent | Medium | High | Data migration is seamless; old install remains as fallback |
| Claw3D depends on Node.js (Next.js) | Certain | Low | Keep Node.js for Claw3D only — it's an optional feature |

## Decision Record

| Decision | Rationale |
|---|---|
| Go over Rust for agent | Faster development, simpler concurrency (goroutines), sufficient performance |
| Tauri over Wails | Larger ecosystem, better Windows support, MSIX packaging, built-in updater |
| HTTP API over Tauri IPC | Go binary works headless (CLI, server, desktop) — UI is just one client |
| Keep React + Tailwind | Zero UI rewrite; proven stack; same developer skills |
| `modernc.org/sqlite` over `mattn/go-sqlite3` | Pure Go — no CGo, no C compiler needed, simpler cross-compilation |
| Own repo over fork | Clean break — no upstream sync burden, own release cadence |
| Parallel development | Users keep working on current Pan Desktop; no interruption |
