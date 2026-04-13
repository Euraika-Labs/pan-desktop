# M1 Decisions — Pan Desktop Windows Port

Snapshot of decisions made during the `/octo:discover` + `/octo:define` phases. This
file is the source of truth for the M1 scope. Amend only via additional
`DECISION_LOG.md` entries that explicitly supersede these.

**Dated:** 2026-04-10
**Source:** discover → gap audit → define → decision session
**Supersedes:** `OPEN_QUESTIONS.md` Q8 (resolved) and several Q1–Q7 ambiguities

---

## TL;DR

Pan Desktop is a **hard fork** of `fathah/hermes-desktop`, renamed end-to-end, re-homed to `git.euraika.net/pan-desktop`, and starting at `v0.0.1`. M1 ships **unsigned** but with a **full rebrand, three new platform/runtime abstractions, a GitHub Actions CI mirror, and a generic-provider auto-updater served from GitLab Pages**. Scope is ambitious but internally consistent. Expect a ~10–14 day path to a shippable M1.

---

## 1. Product identity

| Item | Decision | Source |
|---|---|---|
| **Product name** | `Pan Desktop` (with space, in `productName`) | rebrand scope |
| **Package name** | `pan-desktop` (lowercase, hyphenated) | rebrand scope |
| **Windows AppUserModelID** | `net.euraika.pandesktop` | Q13 |
| **Desktop path segment** | `Pan Desktop` → `%APPDATA%\Pan Desktop\` | Q9 |
| **Fork relationship** | **Hard fork** — no upstream sync with `fathah/hermes-desktop` | Q11 |
| **Git history** | **Squash + fresh start at `v0.0.1`** | rebrand scope |
| **Repo home** | `git.euraika.net/pan-desktop` (GitLab, self-hosted) | Q12 |
| **Upstream attribution** | Preserve `LICENSE` (MIT) + add Euraika copyright line + `NOTICE` file documenting fork origin (required because squashed history loses commit-level attribution) | Q14 + squash implication |

**Blast radius of rebrand** (all files to edit in the REBRAND PR, not exhaustive):

- `package.json` — `name`, `description`, `author`, `homepage`, add `productName`, version → `0.0.1`
- `electron-builder.yml` — `appId`, `productName`, NSIS artifact name, `publish` block
- `dev-app-update.yml` — provider/owner/url (see §5)
- `src/main/index.ts:748` — `setAppUserModelId("net.euraika.pandesktop")`
- Electron `BrowserWindow` titles, macOS bundle ID
- `README.md`, `CONTRIBUTING.md`
- `LICENSE` (add Euraika copyright line) + `NOTICE` (new file)
- `.github/workflows/*.yml` — repo references
- All occurrences of "Hermes Desktop" in `src/renderer/src/` copy
- All occurrences of "hermes-desktop" in paths and bundle IDs

---

## 2. GAP 1 — Windows process/signal portability

| Question | Decision |
|---|---|
| **Q1:** `tree-kill` dep or hand-roll `taskkill`? | **`tree-kill` npm package** — one dep, ~2M weekly downloads |
| **Q2:** kill grace period? | **5000ms default, caller can override via `opts.timeout`** |

**Implementation lives in:** `src/main/platform/processRunner.ts`
**Consumer:** `src/main/claw3d.ts` (migration bundled with GAP 4 in the same PR)
**Enforcement:** ESLint `no-restricted-syntax` rule banning direct `process.kill` calls outside `processRunner.ts`

---

## 3. GAP 2 — CI (re-scoped for GitLab move)

| Question | Decision |
|---|---|
| **CI host** | **GitHub Actions on a GitHub mirror** of `git.euraika.net/pan-desktop`. Code primary on GitLab, CI/CD runs on GitHub for free Windows runners |
| **Q3:** Workflow file organization? | **Split `ci.yml` (PR checks) + `release.yml` (publish)** |
| **Q4:** Dependency cache? | **`~/.npm` only** — no `node_modules` caching |
| **Q5:** PR trigger scope? | **Every PR** — free for public/mirrored repos |

**New M1 deliverables from this scope:**
- Set up GitHub mirror of `git.euraika.net/pan-desktop` (one-time)
- Configure GitLab → GitHub push mirror (or mirror-from-GitLab via GitHub's pull mirroring)
- `.github/workflows/ci.yml` — matrix `{os: [windows-latest, macos-latest, ubuntu-latest]}`, runs `lint + typecheck + build`
- `.github/workflows/release.yml` — extended with `windows-latest` producing NSIS artifact
- Baseline Windows CI run against the pre-Wave-1 `develop` to capture failure signature

**Constraint:** Mirror means two sources of truth for CI config. PRs against GitLab must be reflected into the GitHub mirror for CI to run. Document the workflow clearly in `DEVELOPER_WORKFLOW.md`.

---

## 4. GAP 3 — Code signing

| Question | Decision |
|---|---|
| **Q6:** Signing path for M1? | **Path A — unsigned M1; OV cert acquired during M1 for use in M1.1** |
| **Q7:** Cert type? | **Deferred to M1.1 planning** |
| **Q8:** Publisher CN? | **Deferred to M1.1 planning** — leaning toward `Euraika Labs` or similar, decide when acquiring cert |

**M1 deliverables:**
1. `DECISION_LOG.md` entry recording Path A choice and SmartScreen mitigation strategy
2. Commented `win.sign` scaffold in `electron-builder.yml` (env-var driven)
3. `build/afterPack.js` — drop the macOS-only early return, add a Windows branch (currently a no-op stub)
4. Release notes template + `README.md` install section include a SmartScreen notice and "More info → Run anyway" steps

**Parallel work during M1** (wall-clock, not blocking code):
- Start OV cert acquisition process — typical wall-clock is 1–3 days, but vetting can delay
- Revisit EV vs OV vs Azure Trusted Signing decision before M1.1 planning

---

## 5. GAP 4 — Desktop-owned storage + auto-updater channel

| Question | Decision |
|---|---|
| **Q9:** Product name in paths? | `Pan Desktop` (matches productName, has space) |
| **Q10:** Include `desktopPaths.logs`? | **Yes — add `app.getPath('logs')` in the initial abstraction** |
| **Update channel** | **electron-updater `generic` provider pointing at GitLab Pages** |

**`src/main/runtime/desktopPaths.ts` exports:**
```ts
getDesktopPaths() → {
  userData,        // app.getPath('userData') → %APPDATA%\Pan Desktop\
  stateDb,         // sessions DB location
  sessionCache,    // cached sessions JSON
  claw3dSettings,  // .openclaw/claw3d equivalent, now under userData
  logs,            // app.getPath('logs')
}
```

**Migration targets (Wave 2):**
- `src/main/sessions.ts` — `state.db`
- `src/main/session-cache.ts` — `sessions.json`
- `src/main/claw3d.ts:22` — replace hardcoded `join(homedir(), ".openclaw", "claw3d")`

**Auto-updater M1 deliverables (new scope):**
- Set up GitLab Pages site for `pan-desktop` project
- electron-builder publishes `latest.yml` + NSIS binary to GitLab Pages on release
- `dev-app-update.yml` provider:
  ```yaml
  provider: generic
  url: https://pan-desktop.euraika-labs.net/releases/
  ```
  (or wherever GitLab Pages routes — verify before first release)
- Unsigned updater: accept the `publisherName` mismatch warning on first update from v0.0.1

**Constraint:** Electron `app.getPath(...)` MUST NOT be called at module load time — it requires the `ready` event. Use a lazy accessor pattern inside `desktopPaths.ts`.

---

## 6. P2 gaps

| Gap | Decision |
|---|---|
| **GAP 5** (dev toolchain docs) | Land as part of `docs/housekeeping` PR. `DEVELOPER_WORKFLOW.md` gets a "Windows developer prerequisites" section covering MSVC build tools, Python, node-gyp, Git for Windows. Consider adopting `@vscode/better-sqlite3` prebuilds to skip native build on most dev machines. |
| **GAP 6** (`.exe`/`.cmd` extension resolution) | Fold into `runtimePaths.ts`. `getHermesCli()` tries `hermes`, `hermes.exe`, `hermes.cmd`, `hermes.bat` in order. ESLint rule bans `join(*, "hermes")` outside `runtime/`. |
| **GAP 7** (IPC namespace) | Pure docs. `DEVELOPER_WORKFLOW.md` adds rule: `runtime:*`, `platform:*`, `desktop:*` prefixes for new handlers. Existing handlers stay; only new ones follow the rule. |
| **STALE 1** (repo colocation) | `DECISION_LOG.md` entry: _"hermes-desktop cloned into workspace; docs + code co-located."_ Remove `OPEN_QUESTIONS.md` Q8. Update `CLAUDE.md` scope sentence. |

---

## 7. Updated execution plan

| Day | PR | Contents |
|---|---|---|
| **0a** | `docs/housekeeping` | STALE 1 + GAP 5 + GAP 7 (all pure docs) |
| **0b** | `rebrand/pan-desktop` | Full product rename, new git remote setup, LICENSE + NOTICE update, `package.json` reset to `0.0.1`, `electron-builder.yml`, `src/main/index.ts:748` AUMID, all UI strings. **Squash+reset history on this commit.** Land before any code refactor. |
| **1a** | `ci/github-mirror-setup` | Create GitHub mirror of `git.euraika.net/pan-desktop`. Configure mirror push/pull. |
| **1b** | `ci/windows-matrix` | `ci.yml` with 3-OS matrix + `release.yml` Windows job. Baseline run against pre-Wave-1 `develop`. |
| **2–3** | `feature/wave1-foundation` | Create `platformAdapter.ts` + `processRunner.ts` (with `tree-kill`) + `runtimePaths.ts` (with `.exe`/`.cmd` resolution) + `desktopPaths.ts` (with logs). Unit tests. No migrations yet. |
| **4** | `feature/claw3d-windows` | Migrate `claw3d.ts` to `processRunner.killTree()` + `desktopPaths.claw3dSettings`. Both GAP 1 and GAP 4 for this file in one PR. |
| **5** | `feature/wave1-refactor` | Migrate `installer.ts` + `utils.ts` + `constants.ts` onto new abstractions. Delete `HERMES_PYTHON`/`HERMES_SCRIPT` exports. This is where Windows support actually becomes real. |
| **6–7** | `feature/wave2-services` | Service migration: `config.ts`, `profiles.ts`, `memory.ts`, `tools.ts`, `soul.ts`, `cronjobs.ts`. Mostly mechanical against new abstractions. |
| **8** | `feature/signing-scaffold` | GAP 3 Path A: scaffold + `afterPack.js` Windows branch + SmartScreen install docs |
| **9** | `feature/updater-channel` | GitLab Pages site setup + `dev-app-update.yml` generic provider + first published `latest.yml` |
| **10** | `release/m1-smoke-test` | Full Windows 11 VM smoke test via CI. Fix whatever breaks. |
| **11+** | `release/v0.0.1` | M1 ship: release notes, SmartScreen notice, first binary to GitLab Pages |

**Critical path:** rebrand PR must land before Wave 1 because Wave 1 touches files that carry product-name references.

---

## 8. Deferred to M1.1

- **Code signing** — acquire cert during M1, wire up in M1.1. Decide cert type (EV / OV / Azure Trusted Signing) and publisher CN before acquisition.
- **Forced migration** of existing Unix user data from `~/.hermes` to new `desktopPaths` locations (M1 uses fallback-read; users keep data in place)
- **Portable build target** — NSIS only for M1
- **IPC handler namespace rename** — only new handlers follow the namespace rule; existing ones stay as-is
- **Self-hosted GitLab Windows runner** — if the GitHub mirror approach becomes a pain point, provision one in M1.1
- **EV cert hardware-token CI pipeline** — relevant only if Q7 lands on EV
- **Windows Firewall handling** for gateway port 8642 — accept one-time UAC dialog for M1

### Wave 8 non-goals (added 2026-04-11, status updated 2026-04-12)

The following three items were originally deferred from M1 to M1.1 during
Wave 8 of the Windows readiness plan. As of 2026-04-12 the statuses have
settled:

- **Code signing (Q15)** — **CLOSED as won't-fix on 2026-04-12**, not
  deferred. Pan Desktop ships unsigned indefinitely. Recurring $180/year
  OV cert cost and 2-8 week reputation-build delay not justified for a
  pre-1.0 OSS project. The SmartScreen "click past" dialog is a permanent
  part of the Windows install UX. See `DECISION_LOG.md` 2026-04-12 entry
  for the full rationale and reopen criteria, and `M1_1_TICKETS.md#M1.1-#001`
  for the closed ticket.
- **Auto-update feed (Q16)** — **SHIPPED in M1.1 (MR !17, commit
  `566bc5e`).** Feed wired via electron-updater generic provider with
  release manifests published to the GitHub Releases mirror. Permanent UAC
  caveat documented: because Q15 is closed won't-fix, every update on
  Windows triggers a UAC prompt since `NsisUpdater` can't silently apply
  unsigned updates. Acceptable for pre-1.0 betas. See
  `M1_1_TICKETS.md#M1.1-#002`.
- **AUMID / taskbar verification (Q17)** — **SHIPPED in M1.1 (MR !17,
  commit `4ba8d23`).** Code-review verified `appId` and
  `setAppUserModelId()` match; VM verification checklist landed as
  `hermes-desktop/docs/windows/AUMID_VERIFICATION.md` for the final
  Windows 11 smoke test. See `M1_1_TICKETS.md#M1.1-#003`.

**M1 completion status (2026-04-12):** Ready to tag v0.0.1 pending
Windows smoke test. All 10 M1.1 tickets resolved; Waves 1–9 of the
Windows readiness plan complete. Three small follow-up items (M1.1-#011,
#012, #013) are filed as post-M1 quality work and do not block release.

---

## 9. Blocked-on-external items

Items that depend on things outside the code:

1. **GitHub mirror setup** — requires GitHub org account with push access (blocks GAP 2 start)
2. **GitLab Pages enablement** — requires `git.euraika.net` admin to enable Pages for the project (blocks auto-updater)
3. **DNS for updater URL** — if using `pan-desktop.euraika-labs.net` as the Pages CNAME, needs DNS record
4. **Cert acquisition** (parallel, non-blocking for M1) — vetting timeline unknown

---

## 10. Invariants that must survive M1

These are the architectural commitments that no future PR may violate without explicit reversal in `DECISION_LOG.md`:

1. No OS-specific logic outside `src/main/platform/`
2. No hardcoded Hermes Agent paths outside `src/main/runtime/runtimePaths.ts`
3. No hardcoded desktop paths outside `src/main/runtime/desktopPaths.ts`
4. No subprocess spawn/exec/kill outside `src/main/platform/processRunner.ts`
5. No install/update commands in `src/renderer/`
6. Two-layer update model: `electron-updater` for shell, `runtimeUpdate` service for Hermes Agent
7. No scattered `process.platform === 'win32'` — all branches go through `platformAdapter`

---

_End of M1 decision snapshot. Amendments via dated `DECISION_LOG.md` entries only._
