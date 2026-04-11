import { createPlatformAdapter } from "../platform/platformAdapter";
import { createProcessRunner } from "../platform/processRunner";
import { getRuntimePaths } from "./runtimePaths";
import { getDesktopPaths, type DesktopPaths } from "./desktopPaths";

/**
 * Shared singleton instances of the platform adapter, runtime paths, and
 * process runner. Every file in src/main/ should import from here rather
 * than calling `createPlatformAdapter()` / `getRuntimePaths()` individually
 * — otherwise each importer builds its own adapter snapshot, and process
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
 *
 * This file is imported by every service in Wave 2 and by installer.ts
 * in Wave 1 (via a follow-up edit) so the whole main process shares one
 * view. Tests that need a specific adapter fixture should import the
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
