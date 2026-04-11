# Windows Port Docs

This folder captures the repo-level plan for making `hermes-desktop` a real native Windows product instead of an Electron app that still thinks everyone owns a bash shell and a mild dependency addiction.

## Files

- `WINDOWS_PORT_ANALYSIS_REPORT.md`
  - concrete audit of current Unix-only blockers in the repo
- `WINDOWS_PORT_ROADMAP.md`
  - architecture-first roadmap for the Windows port
- `WINDOWS_TASK_BREAKDOWN.md`
  - concrete implementation tasks grouped by wave

## Current objective

Make Hermes Desktop work on Windows by replacing Unix-only Hermes runtime assumptions with a maintainable platform/runtime adapter layer.

## Source context

The roadmap assumes:
- `hermes-desktop` already builds for Windows as an Electron app
- the real blockers are in runtime integration and installer/update orchestration
- Hermes Agent now has a meaningful native Windows path via PowerShell + Git for Windows Bash backend
