/**
 * Shared IPC channel names — single source of truth.
 *
 * Both main/index.ts and preload/index.ts import from here.
 * Renderer code never sees these — it uses the typed panAPI wrapper.
 *
 * Adding a new channel: add the const here first, then wire up
 * the handler in main and the wrapper method in preload.
 */

// ── Installation ──────────────────────────────────────────────
export const GET_INSTALL_INSTRUCTIONS = "get-install-instructions" as const;
export const CHECK_INSTALL = "check-install" as const;
export const START_INSTALL = "start-install" as const;
export const INSTALL_PROGRESS = "install-progress" as const;

// ── Hermes engine ─────────────────────────────────────────────
export const GET_HERMES_VERSION = "get-hermes-version" as const;
export const REFRESH_HERMES_VERSION = "refresh-hermes-version" as const;
export const RUN_HERMES_DOCTOR = "run-hermes-doctor" as const;
export const RUN_HERMES_UPDATE = "run-hermes-update" as const;

// ── OpenClaw migration ────────────────────────────────────────
export const CHECK_OPENCLAW = "check-openclaw" as const;
export const RUN_CLAW_MIGRATE = "run-claw-migrate" as const;

// ── Configuration ─────────────────────────────────────────────
export const GET_ENV = "get-env" as const;
export const SET_ENV = "set-env" as const;
export const GET_CONFIG = "get-config" as const;
export const SET_CONFIG = "set-config" as const;
export const GET_HERMES_HOME = "get-hermes-home" as const;
export const GET_MODEL_CONFIG = "get-model-config" as const;
export const SET_MODEL_CONFIG = "set-model-config" as const;

// ── Chat ──────────────────────────────────────────────────────
export const SEND_MESSAGE = "send-message" as const;
export const ABORT_CHAT = "abort-chat" as const;
export const CHAT_CHUNK = "chat-chunk" as const;
export const CHAT_DONE = "chat-done" as const;
export const CHAT_ERROR = "chat-error" as const;
export const CHAT_TOOL_PROGRESS = "chat-tool-progress" as const;
export const CHAT_USAGE = "chat-usage" as const;

// ── Gateway ───────────────────────────────────────────────────
export const START_GATEWAY = "start-gateway" as const;
export const STOP_GATEWAY = "stop-gateway" as const;
export const GATEWAY_STATUS = "gateway-status" as const;

// ── Platform toggles ──────────────────────────────────────────
export const GET_PLATFORM_ENABLED = "get-platform-enabled" as const;
export const SET_PLATFORM_ENABLED = "set-platform-enabled" as const;

// ── Sessions ──────────────────────────────────────────────────
export const LIST_SESSIONS = "list-sessions" as const;
export const GET_SESSION_MESSAGES = "get-session-messages" as const;
export const SEARCH_SESSIONS = "search-sessions" as const;

// ── Profiles ──────────────────────────────────────────────────
export const LIST_PROFILES = "list-profiles" as const;
export const CREATE_PROFILE = "create-profile" as const;
export const DELETE_PROFILE = "delete-profile" as const;
export const SET_ACTIVE_PROFILE = "set-active-profile" as const;

// ── Memory ────────────────────────────────────────────────────
export const READ_MEMORY = "read-memory" as const;
export const ADD_MEMORY_ENTRY = "add-memory-entry" as const;
export const UPDATE_MEMORY_ENTRY = "update-memory-entry" as const;
export const REMOVE_MEMORY_ENTRY = "remove-memory-entry" as const;
export const WRITE_USER_PROFILE = "write-user-profile" as const;

// ── Soul ──────────────────────────────────────────────────────
export const READ_SOUL = "read-soul" as const;
export const WRITE_SOUL = "write-soul" as const;
export const RESET_SOUL = "reset-soul" as const;

// ── Tools ─────────────────────────────────────────────────────
export const GET_TOOLSETS = "get-toolsets" as const;
export const SET_TOOLSET_ENABLED = "set-toolset-enabled" as const;

// ── Skills ────────────────────────────────────────────────────
export const LIST_INSTALLED_SKILLS = "list-installed-skills" as const;
export const LIST_BUNDLED_SKILLS = "list-bundled-skills" as const;
export const GET_SKILL_CONTENT = "get-skill-content" as const;
export const INSTALL_SKILL = "install-skill" as const;
export const UNINSTALL_SKILL = "uninstall-skill" as const;

// ── Session cache ─────────────────────────────────────────────
export const LIST_CACHED_SESSIONS = "list-cached-sessions" as const;
export const SYNC_SESSION_CACHE = "sync-session-cache" as const;
export const UPDATE_SESSION_TITLE = "update-session-title" as const;

// ── Credential pool ───────────────────────────────────────────
export const GET_CREDENTIAL_POOL = "get-credential-pool" as const;
export const SET_CREDENTIAL_POOL = "set-credential-pool" as const;

// ── Models ────────────────────────────────────────────────────
export const LIST_MODELS = "list-models" as const;
export const ADD_MODEL = "add-model" as const;
export const REMOVE_MODEL = "remove-model" as const;
export const UPDATE_MODEL = "update-model" as const;
export const FETCH_REMOTE_MODELS = "fetch-remote-models" as const;
export const SYNC_REMOTE_MODELS = "sync-remote-models" as const;

// ── Claw3D ────────────────────────────────────────────────────
export const CLAW3D_STATUS = "claw3d-status" as const;
export const CLAW3D_SETUP = "claw3d-setup" as const;
export const CLAW3D_SETUP_PROGRESS = "claw3d-setup-progress" as const;
export const CLAW3D_GET_PORT = "claw3d-get-port" as const;
export const CLAW3D_SET_PORT = "claw3d-set-port" as const;
export const CLAW3D_GET_WS_URL = "claw3d-get-ws-url" as const;
export const CLAW3D_SET_WS_URL = "claw3d-set-ws-url" as const;
export const CLAW3D_START_ALL = "claw3d-start-all" as const;
export const CLAW3D_STOP_ALL = "claw3d-stop-all" as const;
export const CLAW3D_GET_LOGS = "claw3d-get-logs" as const;
export const CLAW3D_START_DEV = "claw3d-start-dev" as const;
export const CLAW3D_STOP_DEV = "claw3d-stop-dev" as const;
export const CLAW3D_START_ADAPTER = "claw3d-start-adapter" as const;
export const CLAW3D_STOP_ADAPTER = "claw3d-stop-adapter" as const;

// ── Cron jobs ─────────────────────────────────────────────────
export const LIST_CRON_JOBS = "list-cron-jobs" as const;
export const CREATE_CRON_JOB = "create-cron-job" as const;
export const REMOVE_CRON_JOB = "remove-cron-job" as const;
export const PAUSE_CRON_JOB = "pause-cron-job" as const;
export const RESUME_CRON_JOB = "resume-cron-job" as const;
export const TRIGGER_CRON_JOB = "trigger-cron-job" as const;

// ── Shell ─────────────────────────────────────────────────────
export const OPEN_EXTERNAL = "open-external" as const;

// ── App updates ───────────────────────────────────────────────
export const GET_APP_VERSION = "get-app-version" as const;
export const CHECK_FOR_UPDATES = "check-for-updates" as const;
export const DOWNLOAD_UPDATE = "download-update" as const;
export const INSTALL_UPDATE = "install-update" as const;
export const UPDATE_AVAILABLE = "update-available" as const;
export const UPDATE_DOWNLOAD_PROGRESS = "update-download-progress" as const;
export const UPDATE_DOWNLOADED = "update-downloaded" as const;
export const UPDATE_ERROR = "update-error" as const;

// ── Menu events ───────────────────────────────────────────────
export const MENU_NEW_CHAT = "menu-new-chat" as const;
export const MENU_SEARCH_SESSIONS = "menu-search-sessions" as const;
