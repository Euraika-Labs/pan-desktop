# Pan Desktop — User Guide

Pan Desktop is a graphical interface for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It handles installing and configuring the agent, then lets you chat, manage sessions, set up tools and skills, and more — all without touching the command line.

---

## Contents

1. [Installation](#1-installation)
2. [First Launch](#2-first-launch)
3. [API Key Setup](#3-api-key-setup)
4. [Chat](#4-chat)
5. [Features](#5-features)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Installation

Download the latest release for your platform from the GitHub releases page:

**https://github.com/Euraika-Labs/pan-desktop/releases**

### Windows

Download the `.exe` installer (NSIS).

**SmartScreen warning** — Pan Desktop is unsigned, so Windows will show:

> "Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."

To proceed:

1. Click **More info**
2. Click **Run anyway**

This is a one-time prompt per installer binary. Windows will not ask again for that file.

The app installs by default to `%LOCALAPPDATA%\Programs\pan-desktop\`. Auto-updates trigger a UAC prompt each time for the same reason (unsigned installers cannot update silently).

### macOS

Download the `.dmg` file. Open it and drag **Pan Desktop** to your **Applications** folder.

The app is not notarized, so macOS Gatekeeper will block it on first launch. To open it:

- Right-click (or Control-click) the app icon in Applications and choose **Open**, then click **Open** in the confirmation dialog.

Alternatively, run the following once in Terminal:

```bash
xattr -cr "/Applications/Pan Desktop.app"
```

After clearing the quarantine flag, the app opens normally from that point on.

### Linux

Two packages are available:

| Package | Instructions |
|---------|-------------|
| `.AppImage` | `chmod +x pan-desktop-*.AppImage && ./pan-desktop-*.AppImage` |
| `.deb` | `sudo dpkg -i pan-desktop_*.deb` |

No additional setup is required. The `.AppImage` is self-contained and runs without installation.

---

## 2. First Launch

On first launch Pan Desktop checks whether Hermes Agent is already installed at the standard location for your OS.

**If Hermes Agent is not installed:**

A progress screen appears and runs the built-in Hermes installer automatically. Installation has 7 steps and takes a few minutes depending on your internet connection. A real-time log is shown so you can see what is happening. If the install fails, a **Retry Installation** button and a **Copy Logs** button are available — copy the logs and include them when reporting an issue.

**If Hermes Agent is already installed:**

The installer is skipped entirely and the app moves directly to the setup or main workspace.

**After installation — provider setup:**

A one-time setup screen asks you to choose an LLM provider and enter an API key. Select one of the listed providers (OpenRouter is recommended for access to 200+ models), paste your key, and click **Continue**. For local models, select **Local LLM** and point it at your running server (no key required). You can change everything later in Settings.

---

## 3. API Key Setup

API keys are stored in Settings and written to Hermes Agent's environment file. Changes take effect immediately without restarting.

**To add or update a key:**

1. Open **Settings** (gear icon in the sidebar).
2. Scroll to the **LLM Providers** section.
3. Paste your key into the appropriate field and click or tab away — the field saves automatically.

**Supported providers:**

| Provider | Environment variable | Notes |
|----------|---------------------|-------|
| OpenRouter | `OPENROUTER_API_KEY` | 200+ models; recommended starting point |
| Anthropic | `ANTHROPIC_API_KEY` | Claude models (`sk-ant-...`) |
| OpenAI | `OPENAI_API_KEY` | GPT models (`sk-...`) |
| Regolo | `REGOLO_API_KEY` | EU-hosted, OpenAI-compatible. Base URL: `https://api.regolo.ai/v1` |
| Groq | `GROQ_API_KEY` | Used for voice tools and speech-to-text |
| Hugging Face | `HF_TOKEN` | 20+ open models via HF Inference |
| Local / Custom | none required | Point at any OpenAI-compatible endpoint |

**Tool API keys** (optional, unlock additional agent capabilities):

| Tool | Variable |
|------|----------|
| Exa Search | `EXA_API_KEY` |
| Tavily | `TAVILY_API_KEY` |
| Firecrawl | `FIRECRAWL_API_KEY` |
| FAL.ai image generation | `FAL_KEY` |
| Browserbase cloud browser | `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` |

**Setting the active model:**

In the **Settings → Model** section, select a provider and enter the model name (for example `anthropic/claude-opus-4-5`). The model picker in the chat input bar also lets you switch models per-session.

**Local models (LM Studio, Ollama, vLLM, llama.cpp):**

Set the provider to **Local / Custom** and enter the base URL of your running server:

| Server | Default base URL |
|--------|-----------------|
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |
| llama.cpp | `http://localhost:8080/v1` |

**Credential pool (advanced):**

Settings → Credential Pool lets you add multiple API keys per provider. Hermes Agent rotates through them automatically for load balancing or redundancy.

---

## 4. Chat

The **Chat** screen is the main interface for talking to Bibi, the Hermes Agent assistant.

### Sending messages

Type in the input field at the bottom and press **Enter** to send. Press **Shift+Enter** for a newline within a message. Press **Cmd+N** (macOS) or **Ctrl+N** (Windows/Linux) to start a new chat. Responses stream in as they are generated.

While a response is generating, a tool-progress indicator shows which tool Bibi is currently using. Click the stop button (square icon) to abort.

### Quick Ask

When a conversation is already in progress, a 💭 button appears in the input bar. Clicking it sends the message as a `/btw` side question — the response is shown in the chat but the message is not added to the agent's context, so it does not affect the ongoing conversation.

### Slash commands

Type `/` in the input field to open the command menu. Use arrow keys to navigate and **Enter** or **Tab** to select.

**Chat control**

| Command | What it does |
|---------|-------------|
| `/new` | Start a new chat (same as Cmd/Ctrl+N) |
| `/clear` | Clear the current conversation history |

**Agent commands**

| Command | What it does |
|---------|-------------|
| `/btw <question>` | Side question that does not affect context |
| `/approve` | Approve a pending action |
| `/deny` | Deny a pending action |
| `/status` | Show current agent status |
| `/reset` | Reset conversation context |
| `/compact` | Compact and summarize the conversation |
| `/undo` | Undo the last action |
| `/retry` | Retry the last failed action |

**Tools & capabilities**

| Command | What it does |
|---------|-------------|
| `/web <query>` | Search the web |
| `/image <prompt>` | Generate an image |
| `/browse <url>` | Browse a URL |
| `/code <task>` | Write or execute code |
| `/file <path>` | Read or write a file |
| `/shell <command>` | Run a shell command |

**Info commands** (resolved locally, no round-trip to the agent)

| Command | What it does |
|---------|-------------|
| `/help` | List all available commands |
| `/tools` | List available toolsets and their enabled/disabled status |
| `/skills` | List installed skills |
| `/model` | Show the currently active model and provider |
| `/memory` | Show agent memory and session stats |
| `/persona` | Show the current persona |
| `/version` | Show Hermes Agent and desktop app versions |

### Approval system

Some agent actions require explicit approval before they run:

- **Standard approval** — Bibi pauses and shows **Approve** / **Deny** buttons in the chat when it detects a potentially dangerous action. Click the appropriate button to continue or cancel.
- **Manual approval via command** — You can also type `/approve` or `/deny` at any point during an active session.

### Token counter

A token counter in the chat header shows total tokens used in the current session (prompt + completion). Hover over it for a breakdown.

---

## 5. Features

### Sessions

The **Sessions** screen lists all past conversations with Bibi. You can search sessions, resume any previous conversation, or delete sessions you no longer need.

### Profiles

The **Profiles** screen (labeled **Profiles** in the sidebar) lets you create and switch between multiple independent Hermes environments. Each profile has its own API keys, model config, memory, skills, and session history. This is useful for separating work, personal, or project-specific setups.

### Models

The **Models** screen manages the list of available models. You can add models manually, remove ones you no longer use, or sync the model list from a provider (auto-discovery is supported for Regolo and any OpenAI-compatible endpoint).

### Persona (Soul)

The **Persona** screen lets you define Bibi's personality and behavior. Write a system-level persona prompt and Bibi will adopt it for all conversations. Use `/persona` in chat to check the active persona at any time.

### Memory

The **Memory** screen shows what Bibi has learned and retained across sessions. You can review, edit, or clear stored memories. Use `/memory` in chat for a quick summary.

### Tools

The **Tools** screen lists all tool groups available to the agent (web search, code execution, file access, browser automation, etc.) and lets you enable or disable each group. Use `/tools` in chat for a quick list.

### Skills

The **Skills** screen shows installable capability packs. Each skill extends what Bibi can do — for example a skill might add support for a specific API or workflow. Use `/skills` in chat to list what is currently installed.

### Schedules

The **Schedules** screen lets you set up cron-style tasks that run Hermes Agent commands on a recurring schedule.

### Gateway

The **Gateway** screen manages messaging integrations (signal routing for external services).

### Office (Claw3D)

The **Office** screen embeds [Claw3D](https://github.com/iamlukethedev/Claw3D), a 3D visualization environment that shows your Hermes agents working in an interactive office space.

On first visit, click **Install Claw3D** to download and set up the dependency (requires internet and Git). Once installed, click **Start** to launch the local Claw3D server and load the 3D view inside the app. The port (default 3000) and WebSocket URL can be changed in the Office settings panel.

### Settings

The **Settings** screen covers:

- **Hermes Agent** — version info, update check, and diagnostic runner (Run Doctor)
- **Appearance** — Light, Dark, or System theme
- **Model** — provider selection, model name, and base URL
- **Credential Pool** — multi-key rotation per provider
- **LLM Provider API keys** — all provider keys in one place
- **Tool API keys** — keys for search, image generation, browser automation, voice, etc.
- **OpenClaw migration** — if a previous OpenClaw installation is detected, a one-click migration imports your config, keys, sessions, and skills

---

## 6. Troubleshooting

### "better-sqlite3 rebuild failed" during npm install (developers only)

Pan Desktop uses a native SQLite module. If it fails to build:

- **Windows:** Install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and Python 3.x, then re-run `npm ci`.
- **macOS:** Run `xcode-select --install` in Terminal to install the Xcode command-line tools, then re-run `npm ci`.

### "Hermes Agent not installed" / installer screen on every launch

If the installer screen appears repeatedly, the Hermes Agent install may have failed silently. Let the installer run to completion — it shows a progress log and a **Retry Installation** button if something goes wrong. If it continues to fail, copy the logs using the **Copy Logs** button and open an issue at https://git.euraika.net/euraika/pan-desktop/-/issues.

### SmartScreen blocks the installer (Windows)

See [Installation — Windows](#windows) above. Click **More info** then **Run anyway**. This is expected behavior for unsigned apps and is safe to proceed.

### Auto-update prompts UAC on every update (Windows)

This is expected. Because the app is unsigned, Windows cannot verify that the new installer matches the installed version, so it re-prompts for elevation every time. Click **Yes** to allow the update.

### Chat returns no response or an error

1. Open **Settings** and check that an API key is present for the selected provider.
2. Confirm the model name is correct (Settings → Model).
3. For local models, make sure the local server (LM Studio, Ollama, etc.) is running and the base URL matches.
4. Use **Run Doctor** in Settings → Hermes Agent to check the agent's environment and dependencies.

### macOS: app does not open after install

Run this command in Terminal, then try opening the app again:

```bash
xattr -cr "/Applications/Pan Desktop.app"
```

### Claw3D won't start (Office screen)

- Check that port 3000 (or whichever port is configured) is not in use by another process.
- Click **View Logs** in the Office settings panel for detailed error output.
- If setup failed, click the **Install Claw3D** button again to re-run setup.
