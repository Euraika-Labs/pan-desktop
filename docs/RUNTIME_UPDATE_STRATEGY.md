# Runtime Update Strategy

## Key distinction

There are two separate update problems:

1. Hermes Desktop app updates
2. Hermes Agent runtime updates

If we mix them, support and rollback become a mess.

## Desktop app updates
Hermes Desktop already has a good basis:
- `electron-updater`
- update IPC handlers
- GitHub publish config

This should remain the app-layer update path.

## Hermes runtime updates
The desktop app should manage Hermes runtime updates through a dedicated runtime service.

## Phase 1 strategy — simplest viable model

Use the installed Hermes runtime and call the runtime’s own update path.

Flow:
- app resolves the correct Hermes CLI path
- app runs `hermes update`
- app streams progress/output into the UI
- app re-checks version/health after update completes

Why this is good:
- minimal duplication of upstream logic
- fastest route to a real product
- easiest to validate against upstream behavior

## Phase 2 strategy — versioned runtime bundles

Later, if we want smoother updates and rollbacks:
- desktop app manages versioned runtime folders
- e.g. `runtime/current` and `runtime/versions/<version>`
- update = download new runtime bundle + switch pointer

Advantages:
- rollback becomes trivial
- desktop app can pin supported versions
- less fragile than live shell-driven updates

## Compatibility model

The desktop app should maintain a simple compatibility contract:
- minimum supported Hermes Agent version
- preferred/tested version
- migration flags if runtime changes require config handling

This can live in a runtime manifest/module.

## Recommended update UX

User should see two separate concepts in the UI:
- Update Desktop App
- Update Hermes Runtime

Each should show:
- current version
- latest available version
- update status/progress
- last successful update time
- failure reason if something breaks

## Failure handling

If runtime update fails:
- do not brick the desktop app
- preserve the existing runtime
- show actionable error text
- allow retry / repair

## What makes future updates easy

Updates stay easy if:
- all runtime pathing lives behind `runtimePaths`
- all update execution lives behind `runtimeUpdate`
- desktop UI only calls high-level services
- there is a compatibility layer between desktop app version and Hermes runtime version

That way upstream Hermes Agent changes mostly hit one layer instead of twenty-seven random files with vibes-based path joins.
