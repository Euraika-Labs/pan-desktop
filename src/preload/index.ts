import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import {
  isChatApprovalRequest,
  isChatUsage,
  isSetupProgress,
  isUpdateAvailableInfo,
  isUpdateDownloadProgress,
  type ChatApprovalRequest,
  type ChatUsage,
  type SetupProgress,
  type UpdateAvailableInfo,
  type UpdateDownloadProgress,
} from "../shared/ipc-types";
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
  CHAT_APPROVAL_REQUEST,
  APPROVAL_RESPOND,
} from "../shared/channels";

const panAPI = {
  // Installation
  getInstallInstructions: (): Promise<{
    supported: boolean;
    heading: string;
    body: string;
    manualCommand?: string;
  }> => ipcRenderer.invoke(GET_INSTALL_INSTRUCTIONS),

  checkInstall: (): Promise<{
    installed: boolean;
    configured: boolean;
    hasApiKey: boolean;
  }> => ipcRenderer.invoke(CHECK_INSTALL),

  startInstall: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(START_INSTALL),

  onInstallProgress: (
    callback: (progress: SetupProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void => {
      if (!isSetupProgress(progress)) {
        console.error("[IPC] onInstallProgress: unexpected payload", progress);
        return;
      }
      callback(progress);
    };
    ipcRenderer.on(INSTALL_PROGRESS, handler);
    return () => ipcRenderer.removeListener(INSTALL_PROGRESS, handler);
  },

  // Hermes engine info
  getHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke(GET_HERMES_VERSION),
  refreshHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke(REFRESH_HERMES_VERSION),
  runHermesDoctor: (): Promise<string> => ipcRenderer.invoke(RUN_HERMES_DOCTOR),
  runHermesUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(RUN_HERMES_UPDATE),

  // OpenClaw migration
  checkOpenClaw: (): Promise<{ found: boolean; path: string | null }> =>
    ipcRenderer.invoke(CHECK_OPENCLAW),
  runClawMigrate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(RUN_CLAW_MIGRATE),

  // Configuration (profile-aware)
  getEnv: (profile?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke(GET_ENV, profile),

  setEnv: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke(SET_ENV, key, value, profile),

  getConfig: (key: string, profile?: string): Promise<string | null> =>
    ipcRenderer.invoke(GET_CONFIG, key, profile),

  setConfig: (key: string, value: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke(SET_CONFIG, key, value, profile),

  getHermesHome: (profile?: string): Promise<string> =>
    ipcRenderer.invoke(GET_HERMES_HOME, profile),

  getModelConfig: (
    profile?: string,
  ): Promise<{ provider: string; model: string; baseUrl: string }> =>
    ipcRenderer.invoke(GET_MODEL_CONFIG, profile),

  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(SET_MODEL_CONFIG, provider, model, baseUrl, profile),

  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
  ): Promise<{ response: string; sessionId?: string }> =>
    ipcRenderer.invoke(
      SEND_MESSAGE,
      message,
      profile,
      resumeSessionId,
      history,
    ),

  abortChat: (): Promise<void> => ipcRenderer.invoke(ABORT_CHAT),

  onChatChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string): void =>
      callback(chunk);
    ipcRenderer.on(CHAT_CHUNK, handler);
    return () => ipcRenderer.removeListener(CHAT_CHUNK, handler);
  },

  onChatDone: (callback: (sessionId?: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      sessionId?: string,
    ): void => callback(sessionId);
    ipcRenderer.on(CHAT_DONE, handler);
    return () => ipcRenderer.removeListener(CHAT_DONE, handler);
  },

  onChatToolProgress: (callback: (tool: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tool: string): void =>
      callback(tool);
    ipcRenderer.on(CHAT_TOOL_PROGRESS, handler);
    return () => ipcRenderer.removeListener(CHAT_TOOL_PROGRESS, handler);
  },

  onChatUsage: (callback: (usage: ChatUsage) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      usage: unknown,
    ): void => {
      if (!isChatUsage(usage)) {
        console.error("[IPC] onChatUsage: unexpected payload", usage);
        return;
      }
      callback(usage);
    };
    ipcRenderer.on(CHAT_USAGE, handler);
    return () => ipcRenderer.removeListener(CHAT_USAGE, handler);
  },

  onChatError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void =>
      callback(error);
    ipcRenderer.on(CHAT_ERROR, handler);
    return () => ipcRenderer.removeListener(CHAT_ERROR, handler);
  },

  // Approval (dangerous command confirmation)
  onChatApprovalRequest: (
    callback: (request: ChatApprovalRequest) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: unknown,
    ): void => {
      if (!isChatApprovalRequest(request)) {
        console.error(
          "[IPC] onChatApprovalRequest: unexpected payload",
          request,
        );
        return;
      }
      callback(request);
    };
    ipcRenderer.on(CHAT_APPROVAL_REQUEST, handler);
    return () => ipcRenderer.removeListener(CHAT_APPROVAL_REQUEST, handler);
  },

  approvalRespond: (
    approvalId: string,
    response: "approved" | "denied" | "preview" | "level2_approved",
    phrase?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(APPROVAL_RESPOND, approvalId, response, phrase),

  // Gateway
  startGateway: (): Promise<boolean> => ipcRenderer.invoke(START_GATEWAY),
  stopGateway: (): Promise<boolean> => ipcRenderer.invoke(STOP_GATEWAY),
  gatewayStatus: (): Promise<boolean> => ipcRenderer.invoke(GATEWAY_STATUS),

  // Platform toggles
  getPlatformEnabled: (profile?: string): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke(GET_PLATFORM_ENABLED, profile),
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(SET_PLATFORM_ENABLED, platform, enabled, profile),

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
  ): Promise<
    Array<{
      id: string;
      source: string;
      startedAt: number;
      endedAt: number | null;
      messageCount: number;
      model: string;
      title: string | null;
      preview: string;
    }>
  > => ipcRenderer.invoke(LIST_SESSIONS, limit, offset),

  getSessionMessages: (
    sessionId: string,
  ): Promise<
    Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>
  > => ipcRenderer.invoke(GET_SESSION_MESSAGES, sessionId),

  // Profiles
  listProfiles: (): Promise<
    Array<{
      name: string;
      path: string;
      isDefault: boolean;
      isActive: boolean;
      model: string;
      provider: string;
      hasEnv: boolean;
      hasSoul: boolean;
      skillCount: number;
      gatewayRunning: boolean;
    }>
  > => ipcRenderer.invoke(LIST_PROFILES),

  createProfile: (
    name: string,
    clone: boolean,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CREATE_PROFILE, name, clone),

  deleteProfile: (
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(DELETE_PROFILE, name),

  setActiveProfile: (name: string): Promise<boolean> =>
    ipcRenderer.invoke(SET_ACTIVE_PROFILE, name),

  // Memory
  readMemory: (
    profile?: string,
  ): Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }> => ipcRenderer.invoke(READ_MEMORY, profile),

  addMemoryEntry: (
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(ADD_MEMORY_ENTRY, content, profile),
  updateMemoryEntry: (
    index: number,
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(UPDATE_MEMORY_ENTRY, index, content, profile),
  removeMemoryEntry: (index: number, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke(REMOVE_MEMORY_ENTRY, index, profile),
  writeUserProfile: (
    content: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(WRITE_USER_PROFILE, content, profile),

  // Soul
  readSoul: (profile?: string): Promise<string> =>
    ipcRenderer.invoke(READ_SOUL, profile),
  writeSoul: (content: string, profile?: string): Promise<boolean> =>
    ipcRenderer.invoke(WRITE_SOUL, content, profile),
  resetSoul: (profile?: string): Promise<string> =>
    ipcRenderer.invoke(RESET_SOUL, profile),

  // Tools
  getToolsets: (
    profile?: string,
  ): Promise<
    Array<{ key: string; label: string; description: string; enabled: boolean }>
  > => ipcRenderer.invoke(GET_TOOLSETS, profile),
  setToolsetEnabled: (
    key: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(SET_TOOLSET_ENABLED, key, enabled, profile),

  // Skills
  listInstalledSkills: (
    profile?: string,
  ): Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  > => ipcRenderer.invoke(LIST_INSTALLED_SKILLS, profile),
  listBundledSkills: (): Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  > => ipcRenderer.invoke(LIST_BUNDLED_SKILLS),
  getSkillContent: (skillPath: string): Promise<string> =>
    ipcRenderer.invoke(GET_SKILL_CONTENT, skillPath),
  installSkill: (
    identifier: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(INSTALL_SKILL, identifier, profile),
  uninstallSkill: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(UNINSTALL_SKILL, name, profile),

  // Session cache (fast local cache with generated titles)
  listCachedSessions: (
    limit?: number,
    offset?: number,
  ): Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
    }>
  > => ipcRenderer.invoke(LIST_CACHED_SESSIONS, limit, offset),

  syncSessionCache: (): Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
    }>
  > => ipcRenderer.invoke(SYNC_SESSION_CACHE),

  updateSessionTitle: (sessionId: string, title: string): Promise<void> =>
    ipcRenderer.invoke(UPDATE_SESSION_TITLE, sessionId, title),

  // Session search
  searchSessions: (
    query: string,
    limit?: number,
  ): Promise<
    Array<{
      sessionId: string;
      title: string | null;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      snippet: string;
    }>
  > => ipcRenderer.invoke(SEARCH_SESSIONS, query, limit),

  // Credential Pool
  getCredentialPool: (): Promise<
    Record<string, Array<{ key: string; label: string }>>
  > => ipcRenderer.invoke(GET_CREDENTIAL_POOL),
  setCredentialPool: (
    provider: string,
    entries: Array<{ key: string; label: string }>,
  ): Promise<boolean> =>
    ipcRenderer.invoke(SET_CREDENTIAL_POOL, provider, entries),

  // Models
  listModels: (): Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
    }>
  > => ipcRenderer.invoke(LIST_MODELS),

  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
  ): Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    createdAt: number;
  }> => ipcRenderer.invoke(ADD_MODEL, name, provider, model, baseUrl),

  removeModel: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(REMOVE_MODEL, id),

  updateModel: (id: string, fields: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke(UPDATE_MODEL, id, fields),

  fetchRemoteModels: (
    baseUrl: string,
    apiKey: string | null,
  ): Promise<{ ok: boolean; models: string[]; error?: string }> =>
    ipcRenderer.invoke(FETCH_REMOTE_MODELS, baseUrl, apiKey),

  syncRemoteModels: (
    provider: string,
    baseUrl: string,
    apiKey?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
    }>
  > => ipcRenderer.invoke(SYNC_REMOTE_MODELS, provider, baseUrl, apiKey),

  // Claw3D
  claw3dStatus: (): Promise<{
    cloned: boolean;
    installed: boolean;
    devServerRunning: boolean;
    adapterRunning: boolean;
    port: number;
    portInUse: boolean;
    wsUrl: string;
    running: boolean;
    error: string;
  }> => ipcRenderer.invoke(CLAW3D_STATUS),

  claw3dSetup: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLAW3D_SETUP),

  onClaw3dSetupProgress: (
    callback: (progress: SetupProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void => {
      if (!isSetupProgress(progress)) {
        console.error(
          "[IPC] onClaw3dSetupProgress: unexpected payload",
          progress,
        );
        return;
      }
      callback(progress);
    };
    ipcRenderer.on(CLAW3D_SETUP_PROGRESS, handler);
    return () => ipcRenderer.removeListener(CLAW3D_SETUP_PROGRESS, handler);
  },

  claw3dGetPort: (): Promise<number> => ipcRenderer.invoke(CLAW3D_GET_PORT),
  claw3dSetPort: (port: number): Promise<boolean> =>
    ipcRenderer.invoke(CLAW3D_SET_PORT, port),
  claw3dGetWsUrl: (): Promise<string> => ipcRenderer.invoke(CLAW3D_GET_WS_URL),
  claw3dSetWsUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke(CLAW3D_SET_WS_URL, url),

  claw3dStartAll: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLAW3D_START_ALL),
  claw3dStopAll: (): Promise<boolean> => ipcRenderer.invoke(CLAW3D_STOP_ALL),
  claw3dGetLogs: (): Promise<string> => ipcRenderer.invoke(CLAW3D_GET_LOGS),

  claw3dStartDev: (): Promise<boolean> => ipcRenderer.invoke(CLAW3D_START_DEV),
  claw3dStopDev: (): Promise<boolean> => ipcRenderer.invoke(CLAW3D_STOP_DEV),
  claw3dStartAdapter: (): Promise<boolean> =>
    ipcRenderer.invoke(CLAW3D_START_ADAPTER),
  claw3dStopAdapter: (): Promise<boolean> =>
    ipcRenderer.invoke(CLAW3D_STOP_ADAPTER),

  // Updates
  checkForUpdates: (): Promise<string | null> =>
    ipcRenderer.invoke(CHECK_FOR_UPDATES),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke(DOWNLOAD_UPDATE),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(INSTALL_UPDATE),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(GET_APP_VERSION),

  onUpdateAvailable: (
    callback: (info: UpdateAvailableInfo) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: unknown,
    ): void => {
      if (!isUpdateAvailableInfo(info)) {
        console.error("[IPC] onUpdateAvailable: unexpected payload", info);
        return;
      }
      callback(info);
    };
    ipcRenderer.on(UPDATE_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(UPDATE_AVAILABLE, handler);
  },

  onUpdateDownloadProgress: (
    callback: (info: UpdateDownloadProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: unknown,
    ): void => {
      if (!isUpdateDownloadProgress(info)) {
        console.error(
          "[IPC] onUpdateDownloadProgress: unexpected payload",
          info,
        );
        return;
      }
      callback(info);
    };
    ipcRenderer.on(UPDATE_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(UPDATE_DOWNLOAD_PROGRESS, handler);
  },

  onUpdateDownloaded: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on(UPDATE_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(UPDATE_DOWNLOADED, handler);
  },

  onUpdateError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void =>
      callback(error);
    ipcRenderer.on(UPDATE_ERROR, handler);
    return () => ipcRenderer.removeListener(UPDATE_ERROR, handler);
  },

  // Menu events (from native menu bar)
  onMenuNewChat: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on(MENU_NEW_CHAT, handler);
    return () => ipcRenderer.removeListener(MENU_NEW_CHAT, handler);
  },

  onMenuSearchSessions: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on(MENU_SEARCH_SESSIONS, handler);
    return () => ipcRenderer.removeListener(MENU_SEARCH_SESSIONS, handler);
  },

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      schedule: string;
      prompt: string;
      state: "active" | "paused" | "completed";
      enabled: boolean;
      next_run_at: string | null;
      last_run_at: string | null;
      last_status: string | null;
      last_error: string | null;
      repeat: { times: number | null; completed: number } | null;
      deliver: string[];
      skills: string[];
      script: string | null;
    }>
  > => ipcRenderer.invoke(LIST_CRON_JOBS, includeDisabled, profile),

  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(
      CREATE_CRON_JOB,
      schedule,
      prompt,
      name,
      deliver,
      profile,
    ),

  removeCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(REMOVE_CRON_JOB, jobId, profile),

  pauseCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(PAUSE_CRON_JOB, jobId, profile),

  resumeCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(RESUME_CRON_JOB, jobId, profile),

  triggerCronJob: (
    jobId: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(TRIGGER_CRON_JOB, jobId, profile),

  // Shell
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(OPEN_EXTERNAL, url),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("panAPI", panAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.panAPI = panAPI;
}
