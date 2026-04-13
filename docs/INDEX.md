# Developer Docs Index

This folder exists so the Windows desktop effort does not dissolve into a cloud of half-remembered assumptions and heroic guesses.

## Core docs

- `PRODUCT_GOAL.md`
  - what we are building and what "done" means
- `ARCHITECTURE_OVERVIEW.md`
  - target layered architecture and boundaries
- `REFACTOR_ORDER_AND_WAVES.md`
  - which files move first and why (Waves 0–4)
- `WAVE_5_TO_9_PLAN.md`
  - closing the 13 Windows-readiness gaps surfaced by the 2026-04-11 smoke test; extends Waves 5–9 past Wave 4
- `RUNTIME_UPDATE_STRATEGY.md`
  - how Hermes Agent updates should flow into the desktop app
- `DEVELOPER_WORKFLOW.md`
  - how to work on this effort without creating chaos
- `DECISIONS_M1.md`
  - locked-in decisions for Milestone 1 (rebrand, signing, CI, abstractions); source of truth for M1 scope
- `DECISION_LOG.md`
  - architectural decisions and rationale
- `OPEN_QUESTIONS.md`
  - unresolved questions, risks, and follow-up topics

## Source plan

- `../HERMES_DESKTOP_WINDOWS_ARCHITECTURE_PLAN.md`
  - full long-form source plan from the initial architecture write-up

## Reading order for new contributors

1. `PRODUCT_GOAL.md`
2. `ARCHITECTURE_OVERVIEW.md`
3. `DECISIONS_M1.md` ← load this early; it supersedes anything below that contradicts it
4. `REFACTOR_ORDER_AND_WAVES.md`
5. `WAVE_5_TO_9_PLAN.md`
6. `RUNTIME_UPDATE_STRATEGY.md`
7. `DEVELOPER_WORKFLOW.md`
8. `DECISION_LOG.md`
9. `OPEN_QUESTIONS.md`

- [M1.1 Ticket List](./M1_1_TICKETS.md)
