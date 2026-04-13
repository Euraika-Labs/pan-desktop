"""Pan Desktop SSE approval event helper.

This module provides the glue between Hermes Agent's check_and_approve()
callback contract (see tools/approval.py) and Pan Desktop's SSE-based
gateway-to-renderer event channel.

Flow:
    1. The agent invokes check_and_approve(command, callback) from a tool
       handler. The callback returned by make_sse_approval_callback() emits
       an `approval_required` SSE event and parks the awaiting coroutine on
       an asyncio.Future stored in _pending_approvals.
    2. The Electron renderer receives the SSE event, presents the approval
       UI, and POSTs the user's decision to /v1/approvals/{id} (see
       pan_desktop_routes.py).
    3. The route handler calls resolve_approval(id, response), which sets
       the future's result. The parked callback wakes up and returns the
       value to check_and_approve(), which then runs its level-specific
       verification logic (e.g. the Level 2 risk-acknowledgement phrase).

This module is overlay-installed at runtime by Pan Desktop and is wired
into the upstream api_server.py by a small patch that mounts the
RouteTableDef returned by pan_desktop_routes.pan_desktop_approval_router()
and passes a stream-delta callback into make_sse_approval_callback() for
each chat request.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Awaitable, Callable, Union

logger = logging.getLogger(__name__)

# Type alias for the value carried by an approval future. The shape is
# dictated by tools/approval.check_and_approve():
#   - True               -> Level 1 approved
#   - False              -> denied (Level 1 or Level 2)
#   - "preview"          -> user requested a dry-run / preview
#   - "<phrase string>"  -> Level 2 risk-acknowledgement phrase to verify
ApprovalResponse = Union[bool, str]

# In-memory registry of pending approvals. Keyed by UUID4 strings handed
# out per-request. Entries are removed in the callback's finally clause.
_pending_approvals: dict[str, asyncio.Future[ApprovalResponse]] = {}

# Maximum time we will park an awaiting tool call before assuming the user
# walked away and falling back to deny. Five minutes matches the upstream
# Hermes Agent default chat-step timeout, so we time out before the gateway
# does and the deny propagates cleanly through check_and_approve().
_APPROVAL_TIMEOUT_SECONDS = 300

# Type alias for the SSE delta sink injected by api_server.py. It accepts
# the JSON-serialisable payload dict and is responsible for marshalling it
# onto the active SSE stream as an `approval_required` event.
StreamDeltaCallback = Callable[[dict[str, Any]], Any]


def make_sse_approval_callback(
    stream_delta_callback: StreamDeltaCallback,
) -> Callable[..., Awaitable[ApprovalResponse]]:
    """Build an async approval callback compatible with check_and_approve().

    Parameters
    ----------
    stream_delta_callback:
        The existing gateway mechanism that pushes deltas to the connected
        SSE client for the current chat request. We piggyback on it to
        emit `approval_required` events; the renderer dispatches them to
        the approval modal.

    Returns
    -------
    An async function with the signature expected by check_and_approve().
    The returned callback is single-use per approval but the factory can
    be called once per chat request and reused for every tool invocation
    in that request.
    """

    async def callback(
        command: str,
        pattern_key: str,
        *,
        level: int = 1,
        description: str = "",
        reason: str = "",
    ) -> ApprovalResponse:
        approval_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future[ApprovalResponse] = loop.create_future()
        _pending_approvals[approval_id] = future

        payload: dict[str, Any] = {
            "type": "approval_required",
            "id": approval_id,
            "level": level,
            "command": command,
            "pattern_key": pattern_key,
            "description": description,
            "reason": reason,
        }

        try:
            # Push the event onto the SSE stream. stream_delta_callback may
            # be sync or async depending on api_server's plumbing; tolerate
            # both by awaiting if it returned a coroutine.
            maybe_awaitable = stream_delta_callback(payload)
            if asyncio.iscoroutine(maybe_awaitable):
                await maybe_awaitable

            return await asyncio.wait_for(
                future, timeout=_APPROVAL_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Approval %s for pattern %r timed out after %ds; denying",
                approval_id,
                pattern_key,
                _APPROVAL_TIMEOUT_SECONDS,
            )
            return False
        except Exception:
            logger.exception(
                "Approval %s for pattern %r raised; denying",
                approval_id,
                pattern_key,
            )
            return False
        finally:
            _pending_approvals.pop(approval_id, None)

    return callback


def resolve_approval(approval_id: str, response: ApprovalResponse) -> bool:
    """Resolve a pending approval future.

    Parameters
    ----------
    approval_id:
        The UUID4 string previously emitted in an `approval_required` SSE
        event.
    response:
        The user's decision. See ApprovalResponse for accepted shapes.

    Returns
    -------
    True if a pending future with this id was found and resolved, False
    otherwise (unknown id, already resolved, or already cancelled).
    """
    future = _pending_approvals.get(approval_id)
    if future is None or future.done():
        return False
    future.set_result(response)
    return True


def has_pending_approval(approval_id: str) -> bool:
    """Return True if approval_id is in the registry and still awaiting."""
    future = _pending_approvals.get(approval_id)
    return future is not None and not future.done()


def list_pending_approvals() -> list[str]:
    """Return the ids of every approval still awaiting a response."""
    return [
        approval_id
        for approval_id, future in _pending_approvals.items()
        if not future.done()
    ]
