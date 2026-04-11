# Pan Desktop

**Pan Desktop** is a native Windows-first desktop application for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It is a hard fork of [fathah/hermes-desktop](https://github.com/fathah/hermes-desktop), renamed and rebuilt around a platform adapter architecture so the Windows port can survive future upstream changes.

> **Status:** Early development. This is `v0.0.1`. Expect rough edges, especially on Windows — that's literally what we're building. If you hit something broken, [open an issue](https://git.euraika.net/euraika/pan-desktop/-/issues).

## What it does

Pan Desktop walks through installing, configuring, and chatting with Hermes Agent from a graphical interface. Instead of managing the CLI by hand, you get a GUI for:

- First-run install and provider setup
- Streaming chat
- Session history with resume and search
- Profile switching for separate Hermes environments
- Persona / memory / tools / installed skills management
- Gateway controls for messaging integrations

## Install

> Pan Desktop is in early development. Releases are hosted at
> `https://pan-desktop.euraika-labs.net/releases/` (GitLab Pages, pending setup).
> Until that channel is live, download builds directly from CI artifacts.

| Platform | File |
|----------|------|
| Windows | `.exe` (NSIS installer, unsigned for M1 — see SmartScreen notice below) |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

### Windows SmartScreen notice (M1)

Milestone 1 ships **unsigned**. When you run the installer, Windows SmartScreen will show:

> Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting.

To proceed:
1. Click **More info**
2. Click **Run anyway**

This is a one-time acceptance. M1.1 will ship code-signed and bypass this dialog. The unsigned decision is documented in `docs/DECISIONS_M1.md` (see the planning workspace at `/opt/projects/pan-desktop`).

### macOS

The app is not notarized. macOS will block it on first launch:

```bash
xattr -cr "/Applications/Pan Desktop.app"
```

Or right-click the app → **Open** → click **Open** in the confirmation dialog.

## How it works

On first launch, Pan Desktop:

1. Detects whether Hermes Agent is already installed
2. If not, runs the Hermes installer (Unix for now; Windows installer strategy is in progress)
3. Prompts for an API provider or local model endpoint
4. Saves provider config through Hermes config files
5. Launches the main workspace once setup is complete

Chat requests are routed through the local Hermes CLI, and Pan Desktop streams the response back into the UI.

## Architecture

Pan Desktop is built around four layers:

| Layer | Lives in | Knows about |
|---|---|---|
| **Electron shell** | `src/main/index.ts`, `src/renderer/` | Windows, menus, IPC, UI state |
| **Platform adapter** | `src/main/platform/` | OS-specific paths, process management, PATH handling |
| **Runtime layer** | `src/main/runtime/` | Hermes Agent install/update/run; desktop-owned storage |
| **Domain services** | `src/main/*.ts` | Profiles, memory, tools, skills, sessions, cron |

The Wave 1 refactor (in progress) establishes this separation so that no feature code cares whether the app runs on Windows, macOS, or Linux. See the planning workspace `docs/ARCHITECTURE_OVERVIEW.md` for the full layer contract and invariants.

## Development

### Prerequisites

**All platforms:**
- Node.js 22 or newer (pin via `.nvmrc` if you use nvm)
- npm 10+
- Git

**Windows additionally:**
- [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — required for `better-sqlite3` native rebuild during `npm install`
- Python 3.x — required by `node-gyp`
- [Git for Windows](https://gitforwindows.org/) — the Hermes Agent installer currently requires a Bash backend internally (Git Bash is acceptable)

See `docs/DEVELOPER_WORKFLOW.md` in the planning workspace for the full prerequisite list.

### Install dependencies

```bash
npm ci
```

### Run in development

```bash
npm run dev
```

### Run checks

```bash
npm run lint
npm run typecheck
```

### Build

```bash
npm run build        # verify + electron-vite build (no packaging)
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage + deb
```

## Repository layout

```
src/main/                Electron main process, IPC handlers, Hermes integration
src/main/platform/       Platform adapter + process runner (Wave 1 target)
src/main/runtime/        Runtime paths, installer, update, desktop paths (Wave 1 target)
src/preload/             Secure renderer bridge
src/renderer/src/        React app and UI components
resources/               App icons and packaged assets
build/                   Packaging resources (entitlements, afterPack hook)
```

## Contributing

Contributions are welcome — especially Windows fixes and platform adapter work. Check `CONTRIBUTING.md` for the workflow.

Primary remote: `git.euraika.net/euraika/pan-desktop` (GitLab, self-hosted).
CI mirror: `github.com/Euraika-Labs/pan-desktop` (GitHub, used for free Actions runners).

All contributions should target the GitLab primary. The GitHub mirror is read-only; it exists so CI can use GitHub Actions Windows runners.

## Related projects

- **Hermes Agent** — the underlying Python agent Pan Desktop talks to: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- **Hermes Desktop** (upstream) — the original fathah project this is forked from: [fathah/hermes-desktop](https://github.com/fathah/hermes-desktop)

## License

MIT. Copyright © 2026 Euraika Labs and original copyright © 2026 github.com/fathah. See `LICENSE` for the full text and `NOTICE` for fork attribution and origin.
