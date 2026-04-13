# Decision Log

> All decisions from the M1 define session on 2026-04-10 are captured here. The
> full M1 scope snapshot lives in `DECISIONS_M1.md` — this log records each
> decision individually with rationale so future sessions can trace intent.

## 2026-04-10 — Hard fork and rebrand to Pan Desktop
Status: accepted

Decision:
- The Windows port ships as **Pan Desktop**, a hard fork of `fathah/hermes-desktop`.
- No upstream sync. Future Hermes Desktop improvements are NOT automatically pulled in.
- Package name: `pan-desktop`. Product name: `Pan Desktop`. Windows AUMID: `net.euraika.pandesktop`.
- Repo home: `git.euraika.net/pan-desktop` (self-hosted GitLab, matches rest of Euraika stack).
- Git history: squashed, reset to `v0.0.1`.
- License: preserve MIT `LICENSE` + add Euraika copyright line + new `NOTICE` file documenting fork origin (required because squashed history loses commit-level attribution).

Why:
- Clean product identity aligned with Euraika infrastructure.
- Hard fork avoids ongoing merge churn that would slow the Windows port.
- Squash simplifies the v0.0.1 baseline and keeps the DECISION_LOG authoritative over git history for "why" questions.

Implications:
- The REBRAND PR must land before any Wave 1 code refactor; Wave 1 files carry product-name references.
- `dev-app-update.yml` cannot point at GitHub anymore; auto-updater needs a new channel (see separate decision).
- CI cannot simply live on GitHub Actions without a mirror (see separate decision).

## 2026-04-10 — Signing Path A: ship M1 unsigned, sign for M1.1
Status: accepted

Decision:
- Milestone 1 ships **unsigned**. Users accept SmartScreen "Unknown publisher" warnings during alpha.
- Install documentation includes a SmartScreen notice and "More info → Run anyway" walkthrough.
- `electron-builder.yml` carries a commented `win.sign` scaffold so M1.1 can activate signing without reshaping the config.
- OV certificate acquisition starts in parallel during M1 (non-blocking wall-clock).

Why:
- Solo/small-team effort. Path B (signed M1) adds 1–4 weeks wall-clock for cert vetting before the first binary can exist.
- Alpha users can tolerate SmartScreen warnings; the cost is a documented install step, not a broken experience.
- Scaffolding now avoids config churn when the cert arrives.

Deferred to M1.1:
- Cert type (OV vs EV vs Azure Trusted Signing) — decide at acquisition time.
- Publisher CN — decide with cert acquisition.

## 2026-04-10 — Split runtimePaths (agent) from desktopPaths (shell)
Status: accepted

Decision:
- Hermes Agent storage (`~/.hermes`, Python venv, CLI, profiles, config) lives behind `src/main/runtime/runtimePaths.ts`.
- Desktop-owned storage (sessions DB, session cache, Claw3D settings, logs) lives behind a parallel `src/main/runtime/desktopPaths.ts` that uses Electron's `app.getPath()`.
- On Windows: desktop storage → `%APPDATA%\Pan Desktop\`; agent storage → `%LOCALAPPDATA%\hermes\` (or equivalent via runtimePaths).
- Existing Unix users' data stays put: desktopPaths falls back to old locations if new paths are empty, with a one-time log line.

Why:
- The original `runtimePaths` abstraction conflated two distinct concerns. Desktop-owned state belongs to the Electron shell, not the Hermes Agent.
- Windows convention (`app.getPath('userData')`) is materially different from `~/.hermes` conventions on Unix, and shoving desktop state into agent home breaks Windows UX norms.
- Fallback-read preserves backward compatibility without forcing a risky data migration in M1.

Migration targets:
- `src/main/sessions.ts` → `state.db`
- `src/main/session-cache.ts` → cached sessions JSON
- `src/main/claw3d.ts:22` → replace hardcoded `join(homedir(), ".openclaw", "claw3d")`

## 2026-04-10 — Use `tree-kill` npm package for cross-platform process termination
Status: accepted

Decision:
- `src/main/platform/processRunner.ts` exposes `killTree(handle, { timeout: 5000 })` as the single subprocess termination surface.
- Implementation uses the `tree-kill` npm package for cross-platform process-tree termination.
- Default grace period 5000ms before force-kill; callers can override via `opts.timeout`.
- ESLint rule bans direct `process.kill` calls outside `processRunner.ts`.

Why:
- `process.kill(-pid, "SIGKILL")` in `claw3d.ts:395-406` uses POSIX-only process group semantics; throws on Windows and leaves orphan `npm`/`node` processes.
- `tree-kill` is MIT-licensed, ~2M weekly downloads, handles platform edge cases (races, exit 128, tree walk) that hand-rolled `taskkill` calls typically miss.
- One dependency is cheaper than the bug backlog a hand-rolled version would accumulate.

## 2026-04-10 — CI on GitHub Actions via a GitHub mirror of the GitLab primary
Status: accepted

Decision:
- Code primary: `git.euraika.net/pan-desktop` (GitLab, self-hosted).
- CI mirror: a GitHub mirror of the same repo, used only for GitHub Actions runners.
- CI workflows split into `.github/workflows/ci.yml` (PR checks: lint + typecheck + build on `{windows-latest, macos-latest, ubuntu-latest}`) and `.github/workflows/release.yml` (publish-time builds).
- Dependency cache: `~/.npm` only (not `node_modules`).
- PR trigger: every PR against `develop` or `main`.
- First Windows CI run against pre-Wave-1 `develop` to capture a baseline failure signature.

Why:
- GitHub Actions `windows-latest` is free for public/mirrored repos; spinning up a self-hosted Windows runner on Euraika infrastructure is a separate workstream not needed for M1.
- GitLab-primary keeps Pan Desktop consistent with the rest of Euraika's stack (per `/opt/projects/CLAUDE.md`).
- Split workflow files keep triggers and retention cleanly separated.
- Every-PR CI catches Windows regressions before they land; cost is zero for a public/mirrored repo.

Implications:
- Need a one-time setup: create the GitHub mirror, configure GitLab → GitHub push mirror (or GitHub pull-mirror).
- `DEVELOPER_WORKFLOW.md` must document the two-remote workflow so contributors don't PR against the wrong remote.

## 2026-04-10 — Auto-update via electron-updater generic provider on GitLab Pages
Status: accepted

Decision:
- `dev-app-update.yml` uses electron-updater's `generic` provider pointing at a URL hosted on GitLab Pages.
- electron-builder publishes `latest.yml` + the NSIS binary to GitLab Pages on each release.
- M1 acceptable update experience: unsigned update, `publisherName` mismatch warning accepted.

Why:
- electron-updater has no GitLab provider; generic is the correct fit for a GitLab-hosted release channel.
- GitLab Pages is already available on the self-hosted GitLab instance; no new infrastructure required.
- Keeping the update channel co-located with the code avoids a dependency on GitHub for release artifacts.

Blocked on:
- GitLab Pages enablement for the `pan-desktop` project (one-time admin action).
- DNS record for the chosen updater URL (e.g. `pan-desktop.euraika-labs.net` → GitLab Pages CNAME).

## 2026-04-10 — hermes-desktop source tree cloned into workspace
Status: accepted (retroactive)

Decision:
- `fathah/hermes-desktop` has been cloned into `/opt/projects/pan-desktop/hermes-desktop/`.
- This workspace now holds BOTH planning docs (at root) AND working source tree.
- `OPEN_QUESTIONS.md` Q8 ("where should the actual source repo live?") is resolved by this action; removed from open questions.
- Post-rebrand, the `hermes-desktop/` directory will be renamed to `pan-desktop/` or replaced outright with a fresh clone from `git.euraika.net/pan-desktop`.

Why:
- Co-located docs and code remove the context-switching cost between planning and implementation.
- Action preceded formal decision; this entry backfills the record.

## 2026-04-10 — Treat Electron app and Hermes runtime as separate update layers
Status: accepted

Decision:
- The Electron desktop app and the Hermes Agent runtime will be treated as independently updateable layers.

Why:
- Desktop app updates are already a good fit for `electron-updater`.
- Hermes runtime updates have different failure modes and compatibility constraints.
- Separating them makes rollback and diagnostics much cleaner.

## 2026-04-10 — Prefer adapter-driven Windows port over ad hoc conditionals
Status: accepted

Decision:
- The Windows port should be built around central platform/runtime abstractions, not scattered `win32` special cases.

Why:
- Scattered conditionals scale badly.
- Upstream Hermes Agent changes would become expensive to absorb.
- A platform adapter keeps the cost of future updates bounded.

## 2026-04-10 — First milestone does not require pure PowerShell terminal backend
Status: accepted

Decision:
- Milestone 1 targets a native Windows desktop experience while allowing Hermes Agent to keep using Git for Windows Bash where required internally.

Why:
- This dramatically reduces porting scope.
- It aligns with current Hermes Agent Windows reality.
- It gets a working product sooner without overpromising platform purity.

## 2026-04-10 — Use focused docs instead of one giant plan file only
Status: accepted

Decision:
- Keep the long architecture plan as source material, but maintain a focused doc set in `docs/` for day-to-day development.

Why:
- Smaller docs are easier to update.
- Contributors can find the right context faster.
- The chance of losing architectural intent is lower.

## 2026-04-10 — First refactor target is installer/runtime pathing
Status: accepted

Decision:
- Refactor starts with installer/runtime pathing before profile/memory/tools services.

Why:
- These are the main choke points where Unix assumptions leak into everything else.
- Fixing service code first without stabilizing runtime foundations would be backwards.


### 2026-04-11: Defer Windows Polish Gaps to M1.1

**Context:** The M1 readiness smoke test identified 13 gaps. Gaps #6 (signing), #7 (auto-update), and #13 (AUMID/pinning) are polish features that carry significant schedule risk (e.g., OV cert lead times).
**Decision:** Defer Gaps 6, 7, and 13 to M1.1.
**Rationale:** We need to unblock the functional Windows release (M1). Users can bypass SmartScreen manually. Auto-update and perfect taskbar pinning are not strictly required to prove end-to-end functionality.

## 2026-04-11 — Defer three items to M1.1

Decided during Wave 8 of the Windows readiness plan. Three items consciously
moved out of M1 scope to keep the milestone shippable:

1. **Code signing** — cert lead time too long for M1; SmartScreen warning acceptable with documentation
2. **Auto-update feed** — requires GitLab Pages pipeline work not justified by M1 user base; manual update path documented
3. **AUMID verification** — needs real Windows VM not WSL interop; low user impact

Tickets: see `M1_1_TICKETS.md`. Non-goals logged in `DECISIONS_M1.md`.

Rationale: M1 trades polish for speed. These three items do not affect
correctness or the core install → run → use flow. They will land in the
first follow-up milestone once cert + infra prereqs are in place.

## 2026-04-12 — Close M1.1-#001 (code signing) as won't-fix

**Context:** The original M1 plan deferred code signing to M1.1 with a plan
to buy an SSL.com OV certificate (~$180/year) and a runbook at
`hermes-desktop/docs/CERT_ACQUISITION_RUNBOOK.md`. The /octo:research deep
investigation on 2026-04-12 surfaced updated 2026 realities:

- 2023 HSM mandate killed the `.pfx` path → existing runbook is obsolete
- Certificate validity capped at 458 days since 2026-02-27 (mandatory annual renewal)
- EV certs no longer grant instant SmartScreen reputation (since March 2024)
- OV reputation still takes 2-8 weeks of real downloads, same as EV now
- Azure Trusted Signing: Belgian entity not eligible (onboarding paused)
- SignPath Foundation (free OSS signing): plausible but CN would be "SignPath
  Foundation" not "Euraika Labs", and reputation build is similar 4-6 weeks

**Decision:** Close M1.1-#001 as **won't fix**, not defer. Pan Desktop ships
unsigned indefinitely. The SmartScreen "More info → Run anyway" dialog
becomes a permanent part of the Windows install UX.

**Rationale:**
- Recurring $180/year cost is not justified for a pre-1.0 open-source project
  with a small user base
- The reputation-build delay means even after paying, the warning persists for
  weeks anyway — the UX improvement is incremental, not dramatic
- "Click past SmartScreen" is a well-understood friction that users who care
  enough to install Pan Desktop will accept
- Reversible: can be reopened any time if Pan Desktop grows into a user base
  where SmartScreen friction is a real adoption blocker

**Consequences:**
- README.md has a permanent "Windows SmartScreen notice" section documenting
  the dialog and why we don't sign
- `hermes-desktop/docs/CERT_ACQUISITION_RUNBOOK.md` marked ARCHIVED with a
  status banner at the top
- **M1.1-#002 auto-update inherits a permanent UAC caveat**: every update
  triggers a UAC prompt because `NsisUpdater` can't silently apply unsigned
  updates on Windows. Acceptable for pre-1.0 betas; reconsider if Pan Desktop
  has many active updaters
- DECISIONS_M1.md non-goals list updated — code signing is now permanently
  out of scope, not just deferred to M1.1

**Reopen criteria:**
1. Pan Desktop has ≥ 1000 active Windows installs where SmartScreen friction
   is measurably blocking adoption, OR
2. Euraika Labs has a recurring budget line for compliance tooling, OR
3. A free signing option that uses Euraika-branded CN becomes available

## 2026-04-12 — M1.1 complete, preparing v0.0.1 release

All 10 M1.1 tickets resolved or consciously deferred:
- 1 closed as won't-fix (code signing)
- 1 shipped as Wave 5 bonus (remote model discovery)
- 3 shipped in MR !16 (crashpad, integrity check, asarUnpack cleanup)
- 5 shipped in MR !17 (auto-update, AUMID, overlays, tool_context, Claw3D workaround)

The Windows readiness swarm is complete. Pan Desktop is now in
"stable running" state on Windows: install flow works, overlays apply
against pinned upstream, auto-update feed wired with documented UAC
caveat, crash reports land in the right place, SHA256 integrity check
covers the vendored installer, AUMID verification checklist ready for
VM testing.

Next step: create `release/v0.0.1` branch from develop, merge to both
main and develop (this also resolves the 2026-04-11 main↔develop
divergence caused by the auto back-merge running on stale feature
branch state), tag v0.0.1 on main, push tag to trigger CI's
`release.yml` on windows-latest, which produces the first NSIS
installer published to the GitHub Releases mirror.

Three small follow-up items filed as M1.1-#011 (msvcrt spin loop),
M1.1-#012 (overlay test coverage gaps), M1.1-#013 (browser_tool.py
external agent-browser binary). All non-blocking for v0.0.1.
