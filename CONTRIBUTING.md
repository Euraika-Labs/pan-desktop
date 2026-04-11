# Contributing to Pan Desktop

Thanks for your interest in contributing to Pan Desktop. Whether it's a bug fix, new feature, improved docs, or a typo — contributions are welcome.

> Pan Desktop is a hard fork of [fathah/hermes-desktop](https://github.com/fathah/hermes-desktop). See `NOTICE` for attribution and the fork rationale.

## Remotes

Pan Desktop lives on **two remotes** — read carefully before pushing:

- **Primary (GitLab):** `https://git.euraika.net/euraika/pan-desktop` — all development, PRs, issues, and reviews happen here
- **CI mirror (GitHub):** `https://github.com/Euraika-Labs/pan-desktop` — read-only mirror, used only so CI can run on free GitHub Actions Windows runners

**Always push to GitLab.** GitLab auto-mirrors to GitHub roughly every 5 minutes. Pushing directly to GitHub will cause divergence and is blocked by branch protection.

## Getting started

1. Request access to `git.euraika.net/euraika/pan-desktop` (internal visibility)
2. Clone from GitLab:
   ```bash
   git clone https://git.euraika.net/euraika/pan-desktop.git
   cd pan-desktop
   ```
3. Install dependencies:
   ```bash
   npm ci
   ```
4. Run in development:
   ```bash
   npm run dev
   ```

See `README.md` for platform-specific prerequisites, especially the Windows toolchain requirements (`better-sqlite3` native build).

## Making changes

1. Create a feature branch from `develop`:
   ```bash
   git checkout -b feature/my-feature develop
   ```

   We follow **Git Flow**:
   - `main` — production-ready, tagged with SemVer releases
   - `develop` — integration branch for next release
   - `feature/*` — branch from `develop`, merge back to `develop`
   - `release/*` — branch from `develop`, merge to both `main` and `develop`
   - `hotfix/*` — branch from `main`, merge to both `main` and `develop`

2. Make your changes. Keep commits focused — one logical change per commit.

3. Run checks before submitting:
   ```bash
   npm run lint
   npm run typecheck
   ```

4. Test your changes locally with `npm run dev`.

## Architectural invariants

Pan Desktop is built around a platform adapter architecture. **New code must respect these invariants** (from `docs/ARCHITECTURE_OVERVIEW.md` and `docs/DECISIONS_M1.md` §10):

1. No OS-specific logic outside `src/main/platform/`
2. No hardcoded Hermes Agent paths outside `src/main/runtime/runtimePaths.ts`
3. No hardcoded desktop-owned paths outside `src/main/runtime/desktopPaths.ts`
4. No subprocess `spawn` / `exec` / `kill` outside `src/main/platform/processRunner.ts`
5. No install/update command strings in `src/renderer/`
6. No scattered `process.platform === 'win32'` checks — all branches go through `platformAdapter`
7. Two-layer update model: `electron-updater` for the shell, `runtimeUpdate` service for Hermes Agent

Violating these requires an explicit reversal in `docs/DECISION_LOG.md`. If you want to propose a change, open an issue first.

## IPC namespacing

New IPC handlers should use namespaced names:
- `runtime:*` for runtime services (paths, installer, update, probe)
- `platform:*` for platform services (process runner, executable lookup)
- `desktop:*` for desktop-owned services (sessions, cache, claw3d settings)

Existing handlers stay as-is. Only new work follows the namespace rule.

## Submitting a merge request

1. Push your branch to GitLab (never to GitHub):
   ```bash
   git push -u origin feature/my-feature
   ```
2. Open a merge request against `develop` on GitLab
3. Write a clear description of what you changed and why
4. Reference any related issues (e.g., `Closes #42`)

A maintainer will review and may request changes.

## Reporting bugs

Open an issue at [git.euraika.net/euraika/pan-desktop/-/issues](https://git.euraika.net/euraika/pan-desktop/-/issues) with:

- A clear title and description
- Steps to reproduce
- What you expected vs. what happened
- Your OS and app version
- Whether it affects Windows / macOS / Linux (Windows bugs are the highest priority right now)

## Requesting features

Open an issue with:

- The problem you're trying to solve
- How you'd like it to work
- Any alternatives you've considered

## Project structure

```text
src/main/                Electron main process, IPC handlers, Hermes integration
src/main/platform/       Platform adapter + process runner
src/main/runtime/        Runtime paths, installer, update, desktop paths
src/preload/             Secure renderer bridge
src/renderer/src/        React app and UI components
resources/               App icons and packaged assets
build/                   Packaging resources
```

## Code style

- TypeScript, React, Electron
- `npm run lint` — ESLint with flat config (`eslint.config.mjs`)
- `npm run typecheck` — separate `tsconfig` for main vs. renderer
- Follow existing patterns in the codebase
- Prettier handles formatting: `npm run format`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
