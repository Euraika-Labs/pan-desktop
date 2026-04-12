import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  crashReporter,
  dialog,
} from "electron";
import { join } from "path";
import { optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";
import {
  checkInstallStatus,
  runInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  checkOpenClawExists,
  runClawMigrate,
  getInstallInstructions,
  InstallProgress,
} from "./installer";
import {
  sendMessage,
  startGateway,
  stopGateway,
  isGatewayRunning,
  stopHealthPolling,
  restartGateway,
} from "./hermes";
import {
  getClaw3dStatus,
  setupClaw3d,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  startAll as startClaw3dAll,
  stopAll as stopClaw3d,
  getClaw3dLogs,
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  Claw3dSetupProgress,
} from "./claw3d";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  getPlatformEnabled,
  setPlatformEnabled,
} from "./config";
import { listSessions, getSessionMessages, searchSessions } from "./sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "./session-cache";
import {
  listModels,
  addModel,
  removeModel,
  updateModel,
  syncRemoteModels,
} from "./models";
import { fetchRemoteModels } from "./remoteModels";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "./profiles";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "./memory";
import { readSoul, writeSoul, resetSoul } from "./soul";
import { getToolsets, setToolsetEnabled } from "./tools";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "./skills";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "./cronjobs";
import {
  formatCrashDumpHelp,
  getCrashDumpsPath,
  persistCrashLog,
} from "./crashReports";
import { migrateDesktopData } from "./runtime/dataMigration";
import { adapter, getDesktop } from "./runtime/instance";
import {
  GET_INSTALL_INSTRUCTIONS,
  CHECK_INSTALL,
  START_INSTALL,
  INSTALL_PROGRESS,
  GET_HERMES_VERSION,
  REFRESH_HERMES_VERSION,
  RUN_HERMES_DOCTOR,
  RUN_HERMES_UPDATE,
  CHECK_OPENCLAW,
  RUN_CLAW_MIGRATE,
  GET_ENV,
  SET_ENV,
  GET_CONFIG,
  SET_CONFIG,
  GET_HERMES_HOME,
  GET_MODEL_CONFIG,
  SET_MODEL_CONFIG,
  SEND_MESSAGE,
  ABORT_CHAT,
  CHAT_CHUNK,
  CHAT_DONE,
  CHAT_ERROR,
  CHAT_TOOL_PROGRESS,
  CHAT_USAGE,
  START_GATEWAY,
  STOP_GATEWAY,
  GATEWAY_STATUS,
  GET_PLATFORM_ENABLED,
  SET_PLATFORM_ENABLED,
  LIST_SESSIONS,
  GET_SESSION_MESSAGES,
  SEARCH_SESSIONS,
  LIST_PROFILES,
  CREATE_PROFILE,
  DELETE_PROFILE,
  SET_ACTIVE_PROFILE,
  READ_MEMORY,
  ADD_MEMORY_ENTRY,
  UPDATE_MEMORY_ENTRY,
  REMOVE_MEMORY_ENTRY,
  WRITE_USER_PROFILE,
  READ_SOUL,
  WRITE_SOUL,
  RESET_SOUL,
  GET_TOOLSETS,
  SET_TOOLSET_ENABLED,
  LIST_INSTALLED_SKILLS,
  LIST_BUNDLED_SKILLS,
  GET_SKILL_CONTENT,
  INSTALL_SKILL,
  UNINSTALL_SKILL,
  LIST_CACHED_SESSIONS,
  SYNC_SESSION_CACHE,
  UPDATE_SESSION_TITLE,
  GET_CREDENTIAL_POOL,
  SET_CREDENTIAL_POOL,
  LIST_MODELS,
  ADD_MODEL,
  REMOVE_MODEL,
  UPDATE_MODEL,
  FETCH_REMOTE_MODELS,
  SYNC_REMOTE_MODELS,
  CLAW3D_STATUS,
  CLAW3D_SETUP,
  CLAW3D_SETUP_PROGRESS,
  CLAW3D_GET_PORT,
  CLAW3D_SET_PORT,
  CLAW3D_GET_WS_URL,
  CLAW3D_SET_WS_URL,
  CLAW3D_START_ALL,
  CLAW3D_STOP_ALL,
  CLAW3D_GET_LOGS,
  CLAW3D_START_DEV,
  CLAW3D_STOP_DEV,
  CLAW3D_START_ADAPTER,
  CLAW3D_STOP_ADAPTER,
  LIST_CRON_JOBS,
  CREATE_CRON_JOB,
  REMOVE_CRON_JOB,
  PAUSE_CRON_JOB,
  RESUME_CRON_JOB,
  TRIGGER_CRON_JOB,
  OPEN_EXTERNAL,
  GET_APP_VERSION,
  CHECK_FOR_UPDATES,
  DOWNLOAD_UPDATE,
  INSTALL_UPDATE,
  UPDATE_AVAILABLE,
  UPDATE_DOWNLOAD_PROGRESS,
  UPDATE_DOWNLOADED,
  UPDATE_ERROR,
  MENU_NEW_CHAT,
  MENU_SEARCH_SESSIONS,
} from "../shared/channels";

// Wave 7: operational safety. Capture crash dumps locally with no upload,
// so M1 users can attach the .dmp file to a bug report. The crashDumps
// path override MUST be set before `crashReporter.start()` — Electron
// captures the current value at reporter-start time, and any later
// `app.setPath("crashDumps", ...)` would be ignored. See
// docs/DEVELOPER_WORKFLOW.md §Collecting crash dumps from user reports.
//
// We also set app.name + AUMID explicitly HERE (not in whenReady) so that
// `app.getPath("userData")` resolves to `%APPDATA%\Pan Desktop` and not
// some package.json-derived fallback. This guarantees the dumps path
// matches the path documented in DEVELOPER_WORKFLOW.md.
app.setName("Pan Desktop");
if (process.platform === "win32") {
  app.setAppUserModelId("net.euraika.pandesktop");
}
app.setPath("crashDumps", join(app.getPath("userData"), "crashes"));
crashReporter.start({
  productName: "Pan Desktop",
  companyName: "Euraika",
  uploadToServer: false,
  compress: false,
  ignoreSystemCrashHandler: false,
});

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
  // Write a human-readable log BEFORE forcing Crashpad capture so users
  // have something attachable to bug reports even if the minidump is
  // unreadable without symbols. See crashReports.ts::persistCrashLog.
  const logPath = persistCrashLog("uncaught", err);
  if (app.isReady()) {
    dialog.showErrorBox(
      "Pan Desktop crashed",
      `An unexpected error occurred. A crash log has been saved to:\n\n` +
        `${logPath}\n\n` +
        `A binary memory dump (.dmp file) is being captured in the same ` +
        `folder.\n\n` +
        `Please attach BOTH files to your bug report.`,
    );
  }
  // DO NOT call process.exit() — that terminates cleanly and bypasses
  // Crashpad entirely (see Electron issue #27602). process.crash() raises
  // a fatal fault that Crashpad's exception handler intercepts and writes
  // as a .dmp alongside the .log we just wrote. Closes M1.1-#004.
  process.crash();
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
  // Log rejections for diagnostics but DO NOT crash on them. Node's
  // default behavior is to warn and continue; promoting rejections to
  // hard crashes would be more disruptive than the original bug.
  persistCrashLog("rejection", reason);
  if (mainWindow === null && app.isReady()) {
    const message =
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason);
    dialog.showErrorBox(
      "Pan Desktop failed during startup",
      formatCrashDumpHelp(message),
    );
  }
});

let mainWindow: BrowserWindow | null = null;
let currentChatAbort: (() => void) | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    return;
  }
  createWindow();
});

function maybeCrashForValidation(): void {
  if (process.env.PAN_DESKTOP_CRASH_ON_STARTUP === "1") {
    console.error("[CRASH TEST] PAN_DESKTOP_CRASH_ON_STARTUP=1");
    process.crash();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
    console.error("[CRASH] Dumps:", getCrashDumpsPath());
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function setupIPC(): void {
  // Installation
  ipcMain.handle(GET_INSTALL_INSTRUCTIONS, () => getInstallInstructions());

  ipcMain.handle(CHECK_INSTALL, () => {
    return checkInstallStatus();
  });

  ipcMain.handle(START_INSTALL, async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send(INSTALL_PROGRESS, progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Hermes engine info
  ipcMain.handle(GET_HERMES_VERSION, async () => getHermesVersion());
  ipcMain.handle(REFRESH_HERMES_VERSION, async () => {
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle(RUN_HERMES_DOCTOR, () => runHermesDoctor());
  ipcMain.handle(RUN_HERMES_UPDATE, async (event) => {
    try {
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send(INSTALL_PROGRESS, progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OpenClaw migration
  ipcMain.handle(CHECK_OPENCLAW, () => checkOpenClawExists());
  ipcMain.handle(RUN_CLAW_MIGRATE, async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        event.sender.send(INSTALL_PROGRESS, progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Configuration (profile-aware)
  ipcMain.handle(GET_ENV, (_event, profile?: string) => readEnv(profile));

  ipcMain.handle(
    SET_ENV,
    (_event, key: string, value: string, profile?: string) => {
      setEnvValue(key, value, profile);
      // Restart gateway so it picks up the new API key
      if (
        (isGatewayRunning() && key.endsWith("_API_KEY")) ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN"
      ) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle(GET_CONFIG, (_event, key: string, profile?: string) =>
    getConfigValue(key, profile),
  );

  ipcMain.handle(
    SET_CONFIG,
    (_event, key: string, value: string, profile?: string) => {
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle(GET_HERMES_HOME, (_event, profile?: string) =>
    getHermesHome(profile),
  );

  ipcMain.handle(GET_MODEL_CONFIG, (_event, profile?: string) =>
    getModelConfig(profile),
  );

  ipcMain.handle(
    SET_MODEL_CONFIG,
    (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (
        isGatewayRunning() &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    SEND_MESSAGE,
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
    ) => {
      // Lazy start: ensure gateway is running on first chat
      if (!isGatewayRunning()) {
        startGateway(profile);
      }

      if (currentChatAbort) {
        currentChatAbort();
      }

      let fullResponse = "";
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            event.sender.send(CHAT_CHUNK, chunk);
          },
          onDone: (sessionId) => {
            currentChatAbort = null;
            event.sender.send(CHAT_DONE, sessionId || "");
            resolveChat({ response: fullResponse, sessionId });
          },
          onError: (error) => {
            currentChatAbort = null;
            event.sender.send(CHAT_ERROR, error);
            rejectChat(new Error(error));
          },
          onToolProgress: (tool) => {
            event.sender.send(CHAT_TOOL_PROGRESS, tool);
          },
          onUsage: (usage) => {
            event.sender.send(CHAT_USAGE, usage);
          },
        },
        profile,
        resumeSessionId,
        history,
      );

      currentChatAbort = handle.abort;
      return promise;
    },
  );

  ipcMain.handle(ABORT_CHAT, () => {
    if (currentChatAbort) {
      currentChatAbort();
      currentChatAbort = null;
    }
  });

  // Gateway
  ipcMain.handle(START_GATEWAY, () => startGateway());
  ipcMain.handle(STOP_GATEWAY, () => {
    stopGateway(true);
    return true;
  });
  ipcMain.handle(GATEWAY_STATUS, () => isGatewayRunning());

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle(GET_PLATFORM_ENABLED, (_event, profile?: string) =>
    getPlatformEnabled(profile),
  );
  ipcMain.handle(
    SET_PLATFORM_ENABLED,
    (_event, platform: string, enabled: boolean, profile?: string) => {
      setPlatformEnabled(platform, enabled, profile);
      // Restart gateway so it picks up the new platform config
      if (isGatewayRunning()) {
        restartGateway(profile);
      }
      return true;
    },
  );

  // Sessions
  ipcMain.handle(LIST_SESSIONS, (_event, limit?: number, offset?: number) => {
    return listSessions(limit, offset);
  });

  ipcMain.handle(GET_SESSION_MESSAGES, (_event, sessionId: string) => {
    return getSessionMessages(sessionId);
  });

  // Profiles
  ipcMain.handle(LIST_PROFILES, async () => listProfiles());
  ipcMain.handle(CREATE_PROFILE, (_event, name: string, clone: boolean) =>
    createProfile(name, clone),
  );
  ipcMain.handle(DELETE_PROFILE, (_event, name: string) => deleteProfile(name));
  ipcMain.handle(SET_ACTIVE_PROFILE, (_event, name: string) => {
    setActiveProfile(name);
    return true;
  });

  // Memory
  ipcMain.handle(READ_MEMORY, (_event, profile?: string) =>
    readMemory(profile),
  );
  ipcMain.handle(
    ADD_MEMORY_ENTRY,
    (_event, content: string, profile?: string) =>
      addMemoryEntry(content, profile),
  );
  ipcMain.handle(
    UPDATE_MEMORY_ENTRY,
    (_event, index: number, content: string, profile?: string) =>
      updateMemoryEntry(index, content, profile),
  );
  ipcMain.handle(
    REMOVE_MEMORY_ENTRY,
    (_event, index: number, profile?: string) =>
      removeMemoryEntry(index, profile),
  );
  ipcMain.handle(
    WRITE_USER_PROFILE,
    (_event, content: string, profile?: string) =>
      writeUserProfile(content, profile),
  );

  // Soul
  ipcMain.handle(READ_SOUL, (_event, profile?: string) => readSoul(profile));
  ipcMain.handle(WRITE_SOUL, (_event, content: string, profile?: string) => {
    return writeSoul(content, profile);
  });
  ipcMain.handle(RESET_SOUL, (_event, profile?: string) => resetSoul(profile));

  // Tools
  ipcMain.handle(GET_TOOLSETS, (_event, profile?: string) =>
    getToolsets(profile),
  );
  ipcMain.handle(
    SET_TOOLSET_ENABLED,
    (_event, key: string, enabled: boolean, profile?: string) => {
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills
  ipcMain.handle(LIST_INSTALLED_SKILLS, (_event, profile?: string) =>
    listInstalledSkills(profile),
  );
  ipcMain.handle(LIST_BUNDLED_SKILLS, () => listBundledSkills());
  ipcMain.handle(GET_SKILL_CONTENT, (_event, skillPath: string) =>
    getSkillContent(skillPath),
  );
  ipcMain.handle(
    INSTALL_SKILL,
    (_event, identifier: string, profile?: string) =>
      installSkill(identifier, profile),
  );
  ipcMain.handle(UNINSTALL_SKILL, (_event, name: string, profile?: string) =>
    uninstallSkill(name, profile),
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    LIST_CACHED_SESSIONS,
    (_event, limit?: number, offset?: number) =>
      listCachedSessions(limit, offset),
  );
  ipcMain.handle(SYNC_SESSION_CACHE, () => syncSessionCache());
  ipcMain.handle(
    UPDATE_SESSION_TITLE,
    (_event, sessionId: string, title: string) =>
      updateSessionTitle(sessionId, title),
  );

  // Session search
  ipcMain.handle(SEARCH_SESSIONS, (_event, query: string, limit?: number) =>
    searchSessions(query, limit),
  );

  // Credential Pool
  ipcMain.handle(GET_CREDENTIAL_POOL, () => getCredentialPool());
  ipcMain.handle(
    SET_CREDENTIAL_POOL,
    (
      _event,
      provider: string,
      entries: Array<{ key: string; label: string }>,
    ) => {
      setCredentialPool(provider, entries);
      return true;
    },
  );

  // Models
  ipcMain.handle(LIST_MODELS, () => listModels());
  ipcMain.handle(
    ADD_MODEL,
    (_event, name: string, provider: string, model: string, baseUrl: string) =>
      addModel(name, provider, model, baseUrl),
  );
  ipcMain.handle(REMOVE_MODEL, (_event, id: string) => removeModel(id));
  ipcMain.handle(
    UPDATE_MODEL,
    (_event, id: string, fields: Record<string, string>) =>
      updateModel(id, fields),
  );
  ipcMain.handle(
    FETCH_REMOTE_MODELS,
    (_event, baseUrl: string, apiKey: string | null) =>
      fetchRemoteModels(baseUrl, apiKey),
  );
  ipcMain.handle(
    SYNC_REMOTE_MODELS,
    (_event, provider: string, baseUrl: string, apiKey?: string) =>
      syncRemoteModels(provider, baseUrl, apiKey),
  );

  // Claw3D
  ipcMain.handle(CLAW3D_STATUS, () => getClaw3dStatus());

  ipcMain.handle(CLAW3D_SETUP, async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        event.sender.send(CLAW3D_SETUP_PROGRESS, progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(CLAW3D_GET_PORT, () => getClaw3dPort());
  ipcMain.handle(CLAW3D_SET_PORT, (_event, port: number) => {
    setClaw3dPort(port);
    return true;
  });
  ipcMain.handle(CLAW3D_GET_WS_URL, () => getClaw3dWsUrl());
  ipcMain.handle(CLAW3D_SET_WS_URL, (_event, url: string) => {
    setClaw3dWsUrl(url);
    return true;
  });

  ipcMain.handle(CLAW3D_START_ALL, () => startClaw3dAll());
  ipcMain.handle(CLAW3D_STOP_ALL, () => {
    stopClaw3d();
    return true;
  });
  ipcMain.handle(CLAW3D_GET_LOGS, () => getClaw3dLogs());

  ipcMain.handle(CLAW3D_START_DEV, () => startDevServer());
  ipcMain.handle(CLAW3D_STOP_DEV, () => {
    stopDevServer();
    return true;
  });
  ipcMain.handle(CLAW3D_START_ADAPTER, () => startAdapter());
  ipcMain.handle(CLAW3D_STOP_ADAPTER, () => {
    stopAdapter();
    return true;
  });

  // Cron Jobs
  ipcMain.handle(
    LIST_CRON_JOBS,
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
    CREATE_CRON_JOB,
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => createCronJob(schedule, prompt, name, deliver, profile),
  );
  ipcMain.handle(REMOVE_CRON_JOB, (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  ipcMain.handle(PAUSE_CRON_JOB, (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  ipcMain.handle(RESUME_CRON_JOB, (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  ipcMain.handle(TRIGGER_CRON_JOB, (_event, jobId: string, profile?: string) =>
    triggerCronJob(jobId, profile),
  );

  // Shell
  ipcMain.handle(OPEN_EXTERNAL, (_event, url: string) => {
    shell.openExternal(url);
  });
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            mainWindow?.webContents.send(MENU_NEW_CHAT);
          },
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: "CmdOrCtrl+K",
          click: (): void => {
            mainWindow?.webContents.send(MENU_SEARCH_SESSIONS);
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Hermes Agent on GitHub",
          click: (): void => {
            shell.openExternal("https://github.com/fathah/Hermes-Agent");
          },
        },
        {
          label: "Report an Issue",
          click: (): void => {
            shell.openExternal("https://github.com/fathah/Hermes-Agent/issues");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupUpdater(): void {
  // IPC handlers must always be registered to avoid invoke errors
  ipcMain.handle(GET_APP_VERSION, () => app.getVersion());

  if (!app.isPackaged) {
    // Skip auto-update in dev mode
    ipcMain.handle(CHECK_FOR_UPDATES, async () => null);
    ipcMain.handle(DOWNLOAD_UPDATE, () => true);
    ipcMain.handle(INSTALL_UPDATE, () => {});
    return;
  }

  // Dynamic import to avoid electron-updater issues in dev mode
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send(UPDATE_AVAILABLE, {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send(UPDATE_DOWNLOAD_PROGRESS, {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send(UPDATE_DOWNLOADED);
  });

  autoUpdater.on("error", (err) => {
    mainWindow?.webContents.send(UPDATE_ERROR, err.message);
  });

  ipcMain.handle(CHECK_FOR_UPDATES, async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle(DOWNLOAD_UPDATE, () => {
    autoUpdater.downloadUpdate();
    return true;
  });

  ipcMain.handle(INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

app.whenReady().then(() => {
  // app.setName + setAppUserModelId moved to module top level (before
  // crashReporter.start) to ensure userData path is correct. Keeping
  // only the dev-time crash-dump log here.
  console.info("[CRASH] Dumps:", getCrashDumpsPath());
  maybeCrashForValidation();

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  buildMenu();
  setupIPC();
  migrateDesktopData(getDesktop(), adapter).catch((err) =>
    console.warn("[dataMigration] Unexpected error:", err),
  );
  createWindow();
  setupUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopGateway();
    stopClaw3d();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopHealthPolling();
  stopGateway();
  stopClaw3d();
});
