# Approval System — api_server.py Integration Guide

**Status:** Overlay modules created. Integration into upstream `api_server.py` pending.

## What exists

The approval system has three overlay components:

1. **`resources/overlays/tools/approval.py`** — Pattern detection with DANGEROUS_PATTERNS (Level 1) and CATASTROPHIC_PATTERNS (Level 2). Applied to `<HERMES_HOME>/hermes-agent/tools/approval.py`.

2. **`resources/overlays/gateway/platforms/pan_desktop_approval.py`** — SSE event helper. Creates async futures for pending approvals, emits `approval_required` SSE events, provides `resolve_approval()` to unblock parked tool calls.

3. **`resources/overlays/gateway/platforms/pan_desktop_routes.py`** — HTTP routes (`POST/GET /v1/approvals/{id}`, `GET /v1/approvals`). Exports `pan_desktop_approval_router()` returning an aiohttp `RouteTableDef`.

## What's missing

The upstream `api_server.py` in the Hermes Agent needs a small patch to:

1. **Import** the gateway platform modules:
   ```python
   from gateway.platforms.pan_desktop_routes import pan_desktop_approval_router
   from gateway.platforms.pan_desktop_approval import make_sse_approval_callback
   ```

2. **Mount the routes** during app setup:
   ```python
   app.router.add_routes(pan_desktop_approval_router())
   ```

3. **Inject the stream-delta callback** per chat request:
   ```python
   approval_callback = make_sse_approval_callback(stream_delta)
   # Pass approval_callback to the agent tool context so check_and_approve() uses it
   ```

## How to implement

Create a new overlay file `resources/overlays/gateway/api_server.py` that patches the upstream `api_server.py` to add the three integrations above. Add a corresponding entry to `resources/overlays/manifest.json` with the upstream SHA256 pin.

The overlay should be minimal — import the two modules and add two function calls. The existing `pan_desktop_approval.py` and `pan_desktop_routes.py` handle all the complex logic.

## Testing

After the overlay is applied:
1. Start the gateway: `npm run dev` (auto-starts on launch)
2. Send a dangerous command via chat (e.g., "delete all files in C:\temp")
3. The gateway should emit an `approval_required` SSE event
4. The renderer should show the ApprovalModal
5. Approving should POST to `/v1/approvals/{id}` and the command should execute
6. Denying should POST with `"denied"` and the command should be rejected
