"""HTTP route handlers for the Pan Desktop approval flow.

These routes are mounted by api_server.py via pan_desktop_approval_router().
They translate the Electron renderer's REST POST into a resolve_approval()
call against the in-memory future registry maintained by
pan_desktop_approval.py.

Endpoints
---------
POST /v1/approvals/{id}
    Resolve a pending approval. Body schema:
        {
            "response": "approved" | "denied" | "preview" | "level2_approved",
            "phrase":   "<risk-acknowledgement string>"  # only when response is level2_approved
        }
    Returns 200 {"resolved": true} on success, 404 if the approval id is
    unknown or already resolved, 400 if the body is malformed.

GET /v1/approvals/{id}
    Poll fallback for clients that miss the SSE event. Returns
    {"pending": bool}.

GET /v1/approvals
    Diagnostic endpoint that lists every pending approval id. Returns
    {"pending": [<id>, ...]}.
"""

from __future__ import annotations

import json

from aiohttp import web

from . import pan_desktop_approval as pda

routes = web.RouteTableDef()


@routes.post("/v1/approvals/{approval_id}")
async def resolve_approval_handler(request: web.Request) -> web.Response:
    approval_id = request.match_info["approval_id"]

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid JSON"}, status=400)

    if not isinstance(body, dict):
        return web.json_response(
            {"error": "request body must be a JSON object"}, status=400
        )

    response_str = body.get("response", "denied")
    phrase = body.get("phrase")

    # Translate the renderer's enum into the type that check_and_approve()
    # expects from its callback. See pan_desktop_approval.ApprovalResponse.
    resolved: pda.ApprovalResponse
    if response_str == "approved":
        resolved = True
    elif response_str == "denied":
        resolved = False
    elif response_str == "preview":
        resolved = "preview"
    elif response_str == "level2_approved":
        if not isinstance(phrase, str) or not phrase:
            return web.json_response(
                {"error": "level2_approved requires a 'phrase' string"},
                status=400,
            )
        # Pass the phrase through verbatim. check_and_approve() runs the
        # exact-string comparison against the expected risk-acknowledgement
        # phrase, so we deliberately do not validate it here.
        resolved = phrase
    else:
        return web.json_response(
            {"error": f"unknown response type: {response_str!r}"},
            status=400,
        )

    ok = pda.resolve_approval(approval_id, resolved)
    if not ok:
        return web.json_response(
            {"error": "no such pending approval"}, status=404
        )
    return web.json_response({"resolved": True})


@routes.get("/v1/approvals/{approval_id}")
async def get_approval_handler(request: web.Request) -> web.Response:
    approval_id = request.match_info["approval_id"]
    return web.json_response(
        {"pending": pda.has_pending_approval(approval_id)}
    )


@routes.get("/v1/approvals")
async def list_approvals_handler(_request: web.Request) -> web.Response:
    return web.json_response({"pending": pda.list_pending_approvals()})


def pan_desktop_approval_router() -> web.RouteTableDef:
    """Return the RouteTableDef for api_server.py to mount.

    api_server.py is expected to call this once during application setup
    and pass the result to its aiohttp Application.add_routes().
    """
    return routes
