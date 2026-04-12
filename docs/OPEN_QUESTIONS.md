# Open Questions

> Last refreshed during the M1 define session on 2026-04-10. Several prior
> questions were resolved by `DECISIONS_M1.md` and `DECISION_LOG.md` and have
> been removed from this list. Only genuinely open items remain below.

## M1 — still open

### 1. Hermes Agent home location on Windows
Partially resolved by `DECISIONS_M1.md`: desktop-owned storage lives in `%APPDATA%\Pan Desktop\` via `desktopPaths`. Still open: where does the **Hermes Agent** runtime live?

Options:
- `%LOCALAPPDATA%\hermes` (Electron-adjacent, user-owned, fast disk)
- `%PROGRAMDATA%\hermes` (system-wide, requires elevation on install)
- Bundled inside the desktop app's install directory (self-contained, no external runtime root)
- Let the upstream Hermes Agent installer decide, and read its output

Why it matters: affects `runtimePaths` implementation and the installer strategy on Windows.

### 2. Upstream installer reuse vs. desktop-managed installer
Options:
- Call the upstream Hermes Agent installer directly (Phase 1 / Phase A)
- Vendor a tested installer snapshot in app resources
- Build a desktop-specific installer orchestration layer

Current bias (per `RUNTIME_UPDATE_STRATEGY.md` Phase 1): call upstream installer. Still unresolved for Windows specifically, because the upstream installer is `bash`-only and a Windows-compatible equivalent does not yet exist in a form Pan Desktop can rely on.

### 3. End-user runtime dependency management
How aggressive should the app be about managing runtime deps like Git for Windows, Node, ripgrep, ffmpeg on end-user machines?

Options:
- Detect + instruct (show the user what to install, link to installers)
- Auto-install via a bundled resource (adds installer complexity)
- Require them as explicit prerequisites in docs (simplest)

Note: this is end-user runtime deps, NOT developer build toolchain (which is resolved — see `DEVELOPER_WORKFLOW.md`).

### 4. MCP server lifecycle management in M1
Options:
- Only preserve existing MCP configurations
- Launch local command-based MCP servers automatically
- Offer a real MCP management UI immediately

Current bias: preserve configs only for M1; full MCP lifecycle is M1.1+ territory.

## M1.1 — deferred from M1

### 5. Code signing cert type
Deferred from Q7 in the M1 define session. Options:
- **OV cert** (~$200–400/yr, no SmartScreen bypass day-one, needs reputation period)
- **EV cert** (~$300–700/yr, SmartScreen bypass, requires hardware token — friction with GitHub Actions)
- **Azure Trusted Signing** (~$10/month, no token, requires Azure tenant + 3yr business history)

Must decide before cert acquisition completes.

### 6. Publisher CN for code signing
Deferred from Q8. Is the publisher a personal identity (Fathah, Drwho, etc.) or a company identity (Euraika Labs)?

Impacts:
- SmartScreen display text
- `electron-builder.yml` `publisherName` field
- Pan Desktop's public-facing identity

### 7. Self-hosted Windows runner on Euraika infra
M1 decided on GitHub Actions via mirror for CI. If that approach accumulates friction (mirror drift, minute limits, GitHub downtime), M1.1 may revisit:
- Provision a Windows self-hosted runner on Euraika infrastructure
- Connect it to GitLab CI directly
- Retire the GitHub mirror dependency

Open: is the mirror sustainable, or is the extra Euraika hardware worth it?

### 8. Forced data migration from old Unix paths
M1 uses fallback-read from old paths (`~/.hermes/state.db`, etc.). If the dual-read becomes a maintenance burden or user-visible confusion, M1.1 may add a one-time forced migration with explicit user consent.

### 9. Portable build target
M1 ships NSIS only. If enterprise users request a portable (no-install) build, add it in M1.1 via `electron-builder` `portable` target.

## Resolved — archived for reference

- **Q4 (M1 packaging target)** — resolved: NSIS only for M1, portable/MSIX deferred. See `DECISIONS_M1.md`.
- **Q7 (one-codebase vs split)** — resolved: single codebase with platform adapter, per `DECISION_LOG.md` 2026-04-10 entry.
- **Q8 (where should source repo live)** — resolved: co-located in this workspace; hermes-desktop cloned here, will be renamed to pan-desktop during the REBRAND PR. See `DECISION_LOG.md` 2026-04-10 entry.


## Deferred to M1.1 (closed 2026-04-11 as part of Wave 8)

These items had open questions that are now resolved by deferral:

- Code signing cert vendor + cost → SSL.com OV ~$180/year per `CERT_ACQUISITION_RUNBOOK.md`; M1 ships unsigned
- Update feed URL wiring → GitLab Pages, M1.1 scope per M1_1_TICKETS.md#M1.1-#002
- AUMID verification method → manual VM checklist per M1_1_TICKETS.md#M1.1-#003

The tickets themselves are tracked in `M1_1_TICKETS.md`.
