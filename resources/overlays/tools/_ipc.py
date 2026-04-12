#!/usr/bin/env python3
"""
Cross-platform IPC helpers for Hermes Agent tool channels.

This module is part of the Pan Desktop post-install overlay applied on
Windows to work around POSIX-only assumptions in upstream Hermes Agent's
``tools/code_execution_tool.py`` and ``tools/browser_tool.py``.

Upstream uses ``socket.AF_UNIX`` for in-process <-> child-process IPC,
which does not exist on Windows. This module provides a thin wrapper
around the stdlib's ``multiprocessing.connection`` primitives, which
transparently map to Unix domain sockets on POSIX and to named pipes
(``AF_PIPE``) on Windows.

Contract:
    make_ipc_address(name) -> address suitable for both Listener and Client
    ipc_family()           -> 'AF_UNIX' on POSIX, 'AF_PIPE' on Windows

Authentication:
    The ``multiprocessing.connection`` machinery does HMAC handshakes when
    an ``authkey`` is provided.  Callers should generate a random
    ``authkey`` per sandbox invocation, pass it to ``Listener``/``Client``,
    and propagate it to child processes via the ``HERMES_IPC_AUTHKEY``
    environment variable (never on the command line — argv is world-
    readable on both platforms).

Why not raw sockets:
    ``socket.AF_UNIX`` trips an ``AttributeError`` on Windows at import
    time for older CPython builds and a runtime ``OSError`` on newer ones
    (Windows 10 1803+ technically supports AF_UNIX, but the surrounding
    tooling -- pickling, fd inheritance, concurrent binds -- is fragile
    and not worth the portability risk).  ``multiprocessing.connection``
    is the documented stdlib abstraction for this pattern and has worked
    on Windows since Python 3.4.
"""

from __future__ import annotations

import os
import sys
import tempfile
import uuid
from typing import Literal


_IS_WINDOWS = sys.platform == "win32"


def ipc_family() -> Literal["AF_UNIX", "AF_PIPE"]:
    """Return the multiprocessing.connection family name for the current OS.

    On Windows this is ``AF_PIPE`` (named pipes). On POSIX it is
    ``AF_UNIX`` (Unix domain sockets). The result can be passed directly
    to ``multiprocessing.connection.Listener(family=...)``.
    """
    return "AF_PIPE" if _IS_WINDOWS else "AF_UNIX"


def make_ipc_address(name: str) -> str:
    """Build a platform-appropriate listener address for *name*.

    Args:
        name: A short identifier for the channel (e.g. ``"hermes_rpc"``).
            Must be filesystem-safe on POSIX and pipe-name-safe on
            Windows (ASCII, no backslashes).

    Returns:
        On POSIX: an absolute filesystem path to a unique ``.sock`` file
        under ``tempfile.gettempdir()`` (shortened on macOS to stay under
        the 104-byte AF_UNIX limit).

        On Windows: a named pipe path of the form
        ``\\\\.\\pipe\\<name>-<uuid>`` which is valid for both Listener
        and Client without any filesystem side effects.

    The returned address is unique per call — callers do not need to
    add their own nonce.
    """
    unique = uuid.uuid4().hex[:12]

    if _IS_WINDOWS:
        # Named pipe addresses must start with \\.\pipe\ on the local host.
        # No length budget to worry about (16-bit, ~256 char typical cap),
        # no filesystem cleanup required — the pipe disappears when the
        # Listener is closed.
        return rf"\\.\pipe\{name}-{unique}"

    # POSIX: use /tmp directly on macOS so we never exceed the 104-byte
    # AF_UNIX limit (Darwin sets TMPDIR to /var/folders/... ~51 chars
    # before we even add the filename).  Linux's tempfile.gettempdir()
    # already returns /tmp, so this is a no-op there.
    tmp_root = "/tmp" if sys.platform == "darwin" else tempfile.gettempdir()
    return os.path.join(tmp_root, f"{name}_{unique}.sock")


def new_authkey() -> bytes:
    """Generate a cryptographically-random 32-byte authkey for a channel.

    Callers should pass the result to both the ``Listener`` and ``Client``
    in the same execution, and propagate it to child processes via the
    ``HERMES_IPC_AUTHKEY`` environment variable (hex-encoded).
    """
    return os.urandom(32)
