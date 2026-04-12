# Product Goal

## Short version

Build a Windows-native Hermes Desktop that makes Hermes Agent usable on Windows without asking the user to manually juggle bash install commands, Python venv internals, or mystery subprocess rituals.

## Product outcome we want

A Windows user should be able to:
- install Hermes Desktop
- let the app detect or install Hermes Agent
- configure providers/settings in the GUI
- chat and manage sessions/profiles/memory/skills/tools
- update the desktop app and Hermes runtime separately but cleanly
- use MCP-related workflows without opening a terminal manually

## Non-goals for the first Windows milestone

Not required for first success:
- pure PowerShell terminal backend inside Hermes Agent
- a literal one-file EXE containing every dependency under the sun
- enterprise-grade MSI/MSIX/GPO story
- perfect support for every optional subsystem on day one

## What “done” means for milestone 1

Milestone 1 is done when:
- Hermes Desktop installs or detects Hermes Agent on Windows
- Windows paths and profile homes are correct
- the app can run Hermes diagnostics and chat-related commands reliably
- desktop app updates and Hermes runtime updates are clearly separated
- the codebase has a platform/runtime adapter structure that future changes can plug into

## Why this matters

Without the Windows port, Hermes Desktop remains a GUI with Unix assumptions wearing a fake moustache. The goal is a real Windows product, not a Linux app that happens to survive on a Windows machine out of stubbornness.
