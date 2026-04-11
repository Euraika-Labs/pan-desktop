import { createPlatformAdapter } from "../platform/platformAdapter";
import { createProcessRunner } from "../platform/processRunner";
import { getRuntimePaths } from "./runtimePaths";
import { getDesktopPaths, type DesktopPaths } from "./desktopPaths";
import {
  createRuntimeInstaller,
  type RuntimeInstaller,
} from "./runtimeInstaller";
import { createRuntimeUpdate, type RuntimeUpdate } from "./runtimeUpdate";

/**
 * Shared singleton instances of the platform adapter, runtime paths,
 * process runner, and the Wave 4 runtime installer + update services.
 * Every file in src/main/ should import from here rather than calling
 * `createPlatformAdapter()` / `getRuntimePaths()` individually —
 * otherwise each importer builds its own adapter snapshot, and process
 * lifetime caches diverge.
 *
 * Why a singleton:
 *   1. `createPlatformAdapter()` captures `envPathOverride` at call time
 *      (undefined for production callers, so they read process.env.PATH
 *      lazily). One adapter per process means one consistent view.
 *   2. `getRuntimePaths(adapter)` runs `existsSync` in `resolveHermesCli`
 *      to pick the correct CLI extension. That check should happen once,
 *      not per-import.
 *   3. `createProcessRunner({adapter})` is pure closures over the adapter;
 *      constructing multiple instances is harmless but redundant.
 *   4. The Wave 4 installer/update services each hold a version cache
 *      and a strategy-selection decision. Sharing them process-wide
 *      keeps the cache coherent.
 *
 * Tests that need a specific adapter fixture should import the
 * `create*` factories directly and build their own instances, not touch
 * this singleton.
 */
export const adapter = createPlatformAdapter();
export const runtime = getRuntimePaths(adapter);
export const processRunner = createProcessRunner({ adapter });

/**
 * Lazy accessor for desktop-owned paths.
 *
 * Electron's `app.getPath('userData')` throws if called before the
 * `ready` event. Module-load-time evaluation of `getDesktopPaths()` would
 * therefore crash the main process during import. Instead we expose a
 * function that resolves the paths on demand. Callers use it like:
 *
 *     const desktopPaths = getDesktop();
 *     const cache = desktopPaths.sessionCache;
 *
 * The return value is cached after the first successful call so
 * subsequent calls don't reconstruct the path set.
 */
let _desktopPaths: DesktopPaths | null = null;
export function getDesktop(): DesktopPaths {
  if (_desktopPaths === null) {
    _desktopPaths = getDesktopPaths(adapter);
  }
  return _desktopPaths;
}

// ─── Wave 4: runtime installer + update services ──────────────────────────
//
// These are lazy singletons because they both need `buildHermesEnv` from
// installer.ts, which would create a circular import if we constructed
// them at module-load time. The first call wires everything up.

let _runtimeInstaller: RuntimeInstaller | null = null;
let _runtimeUpdate: RuntimeUpdate | null = null;

/**
 * Build the environment bag passed to every Hermes Agent subprocess.
 * Lifted from installer.ts's `buildHermesEnv` so runtime services can
 * use it without reaching into a file that depends on them. Keeping
 * this here also avoids the circular import between installer.ts and
 * the Wave 4 runtime modules.
 *
 * The venv bin/Scripts path comes from `runtime.venvBinDir` (added to
 * RuntimePaths in the Wave 4 review fix), not from an inline ternary.
 * That way the Windows-vs-Unix split lives in exactly one place in
 * runtimePaths.ts — see the review finding that flagged duplication.
 */
function buildHermesEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const path = adapter.buildEnhancedPath([
    runtime.venvBinDir,
    ...adapter.systemPathExtras(),
  ]);
  return {
    ...process.env,
    PATH: path,
    HOME: adapter.homeDir(),
    HERMES_HOME: runtime.hermesHome,
    ...overrides,
  };
}

/**
 * Return the process-wide RuntimeInstaller. Picks Unix or Windows
 * strategy based on the adapter. Safe to call repeatedly — returns the
 * same instance every time.
 */
export function getRuntimeInstaller(): RuntimeInstaller {
  if (_runtimeInstaller === null) {
    _runtimeInstaller = createRuntimeInstaller({
      adapter,
      runtime,
      processRunner,
      buildEnv: buildHermesEnv,
    });
  }
  return _runtimeInstaller;
}

/**
 * Return the process-wide RuntimeUpdate service. Holds the `hermes
 * --version` cache so repeated calls don't re-spawn the CLI.
 */
export function getRuntimeUpdate(): RuntimeUpdate {
  if (_runtimeUpdate === null) {
    _runtimeUpdate = createRuntimeUpdate({
      adapter,
      runtime,
      processRunner,
      buildEnv: buildHermesEnv,
    });
  }
  return _runtimeUpdate;
}

/**
 * Re-export `buildHermesEnv` as a module export so existing callers in
 * installer.ts / hermes.ts / claw3d.ts can keep importing from the
 * instance file. Used by those files for spawning Hermes subprocesses
 * with the correct PATH/HOME/HERMES_HOME layering.
 */
export { buildHermesEnv };
