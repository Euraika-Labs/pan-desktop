# Pan Desktop — Project Roadmap

**Generated:** 2026-04-12
**Current version:** 0.0.2 (develop) / 0.0.1 (latest tag)
**Status:** M2 in progress, approval system uncommitted on WSL

---

## Current State Assessment

### What's shipped (in git, on `develop`)

| Milestone | Scope | Status |
|---|---|---|
| M1 Waves 1-4 | Platform adapter, runtime layer, processRunner, runtimeInstaller/Update | Shipped |
| M1 Waves 5-9 | Windows installer, NSIS packaging, safety harness, upstream overlays | Shipped |
| M1.1 | SHA256 integrity, Crashpad fix, auto-update via GitHub, overlay mechanism (4 patches), code signing won't-fix | Shipped |
| M2 | Shared IPC channels (`src/shared/channels.ts`), Regolo first-class provider, Windows CLI fix (shell:true), data migration, portable build, GitLab Windows CI | Shipped to develop, not tagged |

### What's built but NOT committed (WSL `/opt/projects/pan-desktop/hermes-desktop/`)

**Approval system — 581 lines, 9 files modified, 4 new files:**
- `src/renderer/src/components/ApprovalModal.tsx` — Level 1 + Level 2 modal
- `resources/overlays/tools/approval.py` — dangerous command detection overlay
- `resources/overlays/gateway/platforms/pan_desktop_approval.py` — gateway approval module
- `resources/overlays/gateway/platforms/pan_desktop_routes.py` — gateway route registration
- Modified: `hermes.ts`, `index.ts`, `preload/index.ts`, `preload/index.d.ts`, `Chat.tsx`, `channels.ts`, `main.css`, `manifest.json`

### What exists only in WSL workspace (never in git)

**11 planning docs** at `/opt/projects/pan-desktop/docs/`:
`ARCHITECTURE_OVERVIEW.md`, `DECISIONS_M1.md`, `DECISION_LOG.md`, `DEVELOPER_WORKFLOW.md`, `INDEX.md`, `M1_1_TICKETS.md`, `OPEN_QUESTIONS.md`, `PRODUCT_GOAL.md`, `REFACTOR_ORDER_AND_WAVES.md`, `RUNTIME_UPDATE_STRATEGY.md`, `WAVE_5_TO_9_PLAN.md`

These are the project's institutional memory. They are not in the repo and would be lost if the WSL instance is destroyed.

### What doesn't exist yet

- Test coverage for feature code (only 8 test files covering platform/runtime)
- api_server.py integration of approval overlays
- Claw3D upstream issue submission (M1.1-#010)
- AUMID verification on real Windows hardware
- User-facing documentation (install guide, feature guide)
- Changelog / release notes
- Long-path manifest (mt.exe afterPack)
- macOS notarization
- ARM64 Windows builds

---

## Roadmap

### Phase 0 — Recover & Consolidate (NOW — this session)

**Goal:** Get all existing work into git. Zero new features; pure recovery.

| # | Task | Risk | Effort |
|---|---|---|---|
| 0.1 | Copy 11 planning docs from WSL workspace into `docs/` in the repo | Low | 30 min |
| 0.2 | Recover approval system from WSL uncommitted changes — cherry-pick the 4 new files + 9 modified files onto a `feature/approval-system` branch | Medium (merge conflicts with M2) | 1-2 hr |
| 0.3 | Add cutover docs: update `DECISION_LOG.md` with today's cutover entry, add B-2 section to `DEVELOPER_WORKFLOW.md` | Low | 30 min |
| 0.4 | Add platform startup probe commit (already done in this session) | Low | Done |
| 0.5 | Fix CRLF lint warnings — add `.gitattributes` rule `* text=auto eol=lf` and normalize | Low | 15 min |

**Exit criteria:** All existing work is committed. WSL can be nuked without data loss.

---

### Phase 1 — Ship v0.0.2 (Target: this week)

**Goal:** Tag what's on `develop` as v0.0.2. Get a real Windows release out.

| # | Task | Depends on | Effort |
|---|---|---|---|
| 1.1 | Merge M2 from `develop` to `main` via release branch | Phase 0 complete | 30 min |
| 1.2 | Tag `v0.0.2` — triggers GitHub Actions release build | 1.1 | 5 min |
| 1.3 | Verify Windows NSIS + portable artifacts on GitHub Releases | 1.2 | 30 min |
| 1.4 | Install from NSIS on clean Windows, walk the smoke test checklist (`tests/windows-smoke/checklist.md`) | 1.3 | 1 hr |
| 1.5 | Verify auto-update path: install v0.0.1, confirm it detects v0.0.2 | 1.3 | 30 min |
| 1.6 | Run AUMID verification checklist (`docs/windows/AUMID_VERIFICATION.md`) | 1.4 | 30 min |

**Exit criteria:** v0.0.2 installable from GitHub Releases on a clean Windows 11 machine. Auto-update from v0.0.1 works.

---

### Phase 2 — Approval System (Target: +1 week)

**Goal:** Ship the Level 1/Level 2 dangerous command approval system end-to-end.

| # | Task | Depends on | Effort |
|---|---|---|---|
| 2.1 | Recover + rebase approval branch onto current `develop` (resolve merge conflicts from M2 IPC channel changes) | Phase 0.2 | 2-3 hr |
| 2.2 | Fix 2 React hook warnings in `ApprovalModal.tsx` (lines 43/60) — either add `request` to deps or refactor with `useRef` | 2.1 | 30 min |
| 2.3 | Wire `approval.py` overlay into `api_server.py` chat handler — the overlay modules exist but aren't integrated into the upstream gateway code | 2.1 | 2-4 hr |
| 2.4 | Add approval overlays to `resources/overlays/manifest.json` with SHA256 pins | 2.3 | 30 min |
| 2.5 | Test Level 1 (file create/delete) + Level 2 (catastrophic commands like `vssadmin delete shadows`) on Windows | 2.3 | 1 hr |
| 2.6 | Verification Checklist Parts C-E from `VERIFICATION_CHECKLIST.md` | 2.5 | 1 hr |
| 2.7 | Add unit tests for approval pattern matching (DANGEROUS_PATTERNS, CATASTROPHIC_PATTERNS regex) | 2.1 | 1 hr |

**Exit criteria:** Bibi shows Level 1 modal for `del` commands, Level 2 red modal for catastrophic commands. Deny works. Approve executes via `cmd.exe` on Windows.

---

### Phase 3 — Test Coverage & Quality (Target: +2 weeks)

**Goal:** Bring test coverage from "platform/runtime only" to meaningful feature coverage.

| # | Task | Effort |
|---|---|---|
| 3.1 | Unit tests for `config.ts` — .env parsing, config.yaml read/write, cache TTL, credential pool | 3-4 hr |
| 3.2 | Unit tests for `sessions.ts` — FTS5 queries, session resume, search snippets | 2-3 hr |
| 3.3 | Unit tests for `profiles.ts` — list, create, delete, active profile switching | 1-2 hr |
| 3.4 | Unit tests for `memory.ts` — entry CRUD, delimiter parsing, char limits | 1-2 hr |
| 3.5 | Unit tests for `models.ts` — CRUD, remote sync, provider name mapping | 1-2 hr |
| 3.6 | Unit tests for `skills.ts` — discovery, frontmatter parsing, install/uninstall | 1-2 hr |
| 3.7 | Integration tests for IPC handlers — verify channel wiring between main/preload | 3-4 hr |
| 3.8 | Harden IPC type safety — replace `unknown` casts in event handlers with discriminated unions | 2-3 hr |
| 3.9 | Add `npm run test:coverage` script with vitest coverage reporting | 30 min |

**Exit criteria:** >60% line coverage on `src/main/`. All IPC channels have at least a smoke test.

---

### Phase 4 — Claw3D & Ecosystem (Target: +3 weeks)

**Goal:** Polish the Claw3D (hermes-office) integration and address upstream issues.

| # | Task | Effort |
|---|---|---|
| 4.1 | Submit Claw3D upstream issue (M1.1-#010) — `outputFileTracingRoot` pinning in `next.config.js` | 1 hr |
| 4.2 | Test Claw3D setup flow on Windows: clone, install, dev server, adapter start, Office webview | 2-3 hr |
| 4.3 | Fix Claw3D status polling — make 5s interval configurable, fix webview error cascade to UI state | 1-2 hr |
| 4.4 | Add structured tool event protocol — replace regex-based tool progress detection with typed SSE events | 3-4 hr |
| 4.5 | Session cache auto-refresh — detect external writes to `state.db` (e.g., from CLI) | 2-3 hr |

**Exit criteria:** Claw3D works on Windows from fresh install. Tool progress tracking doesn't break on upstream format changes.

---

### Phase 5 — Distribution Hardening (Target: +4-5 weeks)

**Goal:** Make the distribution pipeline production-grade.

| # | Task | Effort |
|---|---|---|
| 5.1 | Follow up on SignPath OSS application — if approved, integrate into CI | 2-4 hr |
| 5.2 | If SignPath approved: add code signing to release workflow, test SmartScreen reputation building | 4-8 hr |
| 5.3 | Add long-path manifest via mt.exe in `build/afterPack.js` (Wave 6 deferred work) | 2-3 hr |
| 5.4 | Test auto-update end-to-end: v0.0.2 → v0.0.3 with signed binaries (if 5.2) | 2 hr |
| 5.5 | Add delta update support — verify blockmap generation in electron-builder | 1-2 hr |
| 5.6 | Add changelog automation — generate from conventional commits | 2-3 hr |
| 5.7 | macOS notarization setup (if macOS users exist) | 4-8 hr |
| 5.8 | ARM64 Windows build exploration — test on Windows ARM VM | 4-8 hr |

**Exit criteria:** Signed builds (if SignPath approved). Long paths don't crash. Delta updates work. Changelog auto-generated.

---

### Phase 6 — Documentation & v1.0 Prep (Target: +6-8 weeks)

**Goal:** User-facing documentation. Production-ready release.

| # | Task | Effort |
|---|---|---|
| 6.1 | User install guide — Windows (NSIS + portable), macOS (DMG), Linux (AppImage) | 3-4 hr |
| 6.2 | Feature guide — chat, profiles, models, memory, skills, Claw3D, approval system | 4-6 hr |
| 6.3 | API key setup guide — Regolo, OpenAI, Anthropic, local Ollama | 1-2 hr |
| 6.4 | Troubleshooting guide — common failures (better-sqlite3 rebuild, Hermes install, SmartScreen) | 2-3 hr |
| 6.5 | Final AUMID + toast + jump list verification on clean Windows 11 | 1 hr |
| 6.6 | Final smoke test on all 3 platforms | 2-3 hr |
| 6.7 | Version bump to 1.0.0, tag, release | 1 hr |

**Exit criteria:** A new user can install Pan Desktop, configure Regolo, and chat with Bibi without needing to read source code.

---

## Priority Matrix

```
                  HIGH IMPACT
                      │
   Phase 0 (Recover)  │  Phase 2 (Approval)
   Phase 1 (v0.0.2)   │  Phase 3 (Tests)
                       │
  LOW EFFORT ──────────┼────────── HIGH EFFORT
                       │
   Phase 5.6 (Chlog)  │  Phase 5 (Signing)
   Phase 4.1 (Issue)  │  Phase 6 (Docs+v1.0)
                       │
                  LOW IMPACT
```

**Recommended execution order:** 0 → 1 → 2 → 3 → 4 → 5 → 6

Phase 0 is non-negotiable and urgent — the WSL uncommitted work is at risk of loss.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WSL instance destroyed before Phase 0 | Medium | **Critical** — 581 lines + 11 docs lost | Execute Phase 0 immediately |
| Approval branch has unresolvable conflicts with M2 | Low | High — rework needed | Manual 3-way merge; M2 IPC changes are well-scoped |
| SignPath OSS application denied | Medium | Low — already decided to ship unsigned | No action needed; won't-fix is the permanent decision |
| Claw3D upstream rejects issue | Low | Medium — workaround exists (pin in config) | Document local patch; maintain as overlay |
| better-sqlite3 ABI breaks on Electron upgrade | Medium | High — app can't start | PE verification in CI already catches this |
| Hermes Agent upstream breaks overlay SHA256 | Medium | Medium — overlays skip with warning | Monitor upstream; re-pin after review |

---

## Definition of Done — v1.0.0

All of these must be true:

1. Clean install on Windows 11 works without developer tools
2. Auto-update from v0.x to v1.0 works
3. Chat with Bibi works (streaming, tool execution, approval modal)
4. Profile switching, model config, memory, and skills all functional
5. Claw3D setup and Office view work on Windows
6. >60% test coverage on main process
7. User documentation covers install, setup, and basic usage
8. CI/CD pipeline builds all 3 platforms on tag push
9. All architectural invariants still hold (verified by ESLint rules)
10. No known P0/P1 bugs in the issue tracker
