"""Dangerous command approval -- detection, prompting, and per-session state.

This module is the single source of truth for the dangerous command system:
- Pattern detection (DANGEROUS_PATTERNS, CATASTROPHIC_PATTERNS, detect_dangerous_command)
- Per-session approval state (thread-safe, keyed by session_key)
- Approval prompting (CLI interactive + gateway async)
- Smart approval via auxiliary LLM (auto-approve low-risk commands)
- Permanent allowlist persistence (config.yaml)

===========================================================================
PAN DESKTOP OVERLAY
---------------------------------------------------------------------------
This file is a Pan Desktop post-install overlay applied on top of the
upstream Hermes Agent ``tools/approval.py``. It adds Windows-native
dangerous-command coverage (ransomware, Defender tampering, LOLBINs,
credential-dump tooling, event-log wiping, registry hive deletion, and
persistence primitives) that the Linux-focused upstream pattern list does
not catch.

Changes from upstream (pinned SHA in resources/overlays/manifest.json):

1. NEW: ``CATASTROPHIC_PATTERNS`` — Level 2 patterns that require a
   double-confirmation with an exact phrase. These are irreversible,
   ransomware-adjacent, or anti-forensics actions.

2. EXTENDED: ``DANGEROUS_PATTERNS`` — Windows cmd.exe / PowerShell
   single-confirm (Level 1) entries appended after the existing
   Linux entries. Order preserved; nothing reordered or removed.

3. NEW: ``detect_catastrophic_command(command)`` returning
   ``(is_catastrophic, pattern_key, description)``.

4. NEW: ``check_command_approval(command)`` returning an
   ``ApprovalCheck`` dataclass with the unified level (0/1/2).

The existing ``detect_dangerous_command`` and ``check_dangerous_command``
entry points are preserved unchanged for backwards compatibility with
``terminal_tool`` and other upstream callers.

Overlay source of truth: pan-desktop/resources/overlays/tools/approval.py
Applied by: hermes-desktop/src/main/services/overlayApplicator.ts
Target: <HERMES_AGENT>/tools/approval.py
===========================================================================
"""

import contextvars
import logging
import os
import re
import sys
import threading
import unicodedata
from dataclasses import dataclass
from typing import Optional, Protocol, Union

logger = logging.getLogger(__name__)

# Per-thread/per-task gateway session identity.
# Gateway runs agent turns concurrently in executor threads, so reading a
# process-global env var for session identity is racy. Keep env fallback for
# legacy single-threaded callers, but prefer the context-local value when set.
_approval_session_key: contextvars.ContextVar[str] = contextvars.ContextVar(
    "approval_session_key",
    default="",
)


def set_current_session_key(session_key: str) -> contextvars.Token[str]:
    """Bind the active approval session key to the current context."""
    return _approval_session_key.set(session_key or "")


def reset_current_session_key(token: contextvars.Token[str]) -> None:
    """Restore the prior approval session key context."""
    _approval_session_key.reset(token)


def get_current_session_key(default: str = "default") -> str:
    """Return the active session key, preferring context-local state.

    Resolution order:
    1. approval-specific contextvars (set by gateway before agent.run)
    2. session_context contextvars (set by _set_session_env)
    3. os.environ fallback (CLI, cron, tests)
    """
    session_key = _approval_session_key.get()
    if session_key:
        return session_key
    from gateway.session_context import get_session_env
    return get_session_env("HERMES_SESSION_KEY", default)

# Sensitive write targets that should trigger approval even when referenced
# via shell expansions like $HOME or $HERMES_HOME.
_SSH_SENSITIVE_PATH = r'(?:~|\$home|\$\{home\})/\.ssh(?:/|$)'
_HERMES_ENV_PATH = (
    r'(?:~\/\.hermes/|'
    r'(?:\$home|\$\{home\})/\.hermes/|'
    r'(?:\$hermes_home|\$\{hermes_home\})/)'
    r'\.env\b'
)
_SENSITIVE_WRITE_TARGET = (
    r'(?:/etc/|/dev/sd|'
    rf'{_SSH_SENSITIVE_PATH}|'
    rf'{_HERMES_ENV_PATH})'
)

# =========================================================================
# Dangerous command patterns
# =========================================================================
#
# Two lists:
#   * CATASTROPHIC_PATTERNS -- Level 2 (double-confirm with exact phrase)
#   * DANGEROUS_PATTERNS    -- Level 1 (single yes/no approval)
#
# Ordering convention:
#   * Upstream Linux-focused entries come first (unchanged).
#   * Pan Desktop Windows entries are appended below the Linux block.
#   * No upstream entries have been reordered, rewritten, or removed --
#     the Linux test suite must continue to pass byte-for-byte.
#
# Every pattern is compiled with ``re.IGNORECASE | re.DOTALL`` after the
# command is lowercased in ``_normalize_command_for_detection``. That means
# regex character classes referencing A-Z should use a-z, and the
# ``re.IGNORECASE`` flag still handles mixed-case payloads.
# =========================================================================

DANGEROUS_PATTERNS = [
    (r'\brm\s+(-[^\s]*\s+)*/', "delete in root path"),
    (r'\brm\s+-[^\s]*r', "recursive delete"),
    (r'\brm\s+--recursive\b', "recursive delete (long flag)"),
    (r'\bchmod\s+(-[^\s]*\s+)*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b', "world/other-writable permissions"),
    (r'\bchmod\s+--recursive\b.*(777|666|o\+[rwx]*w|a\+[rwx]*w)', "recursive world/other-writable (long flag)"),
    (r'\bchown\s+(-[^\s]*)?R\s+root', "recursive chown to root"),
    (r'\bchown\s+--recursive\b.*root', "recursive chown to root (long flag)"),
    (r'\bmkfs\b', "format filesystem"),
    (r'\bdd\s+.*if=', "disk copy"),
    (r'>\s*/dev/sd', "write to block device"),
    (r'\bDROP\s+(TABLE|DATABASE)\b', "SQL DROP"),
    (r'\bDELETE\s+FROM\b(?!.*\bWHERE\b)', "SQL DELETE without WHERE"),
    (r'\bTRUNCATE\s+(TABLE)?\s*\w', "SQL TRUNCATE"),
    (r'>\s*/etc/', "overwrite system config"),
    (r'\bsystemctl\s+(stop|disable|mask)\b', "stop/disable system service"),
    (r'\bkill\s+-9\s+-1\b', "kill all processes"),
    (r'\bpkill\s+-9\b', "force kill processes"),
    (r':\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:', "fork bomb"),
    # Any shell invocation via -c or combined flags like -lc, -ic, etc.
    (r'\b(bash|sh|zsh|ksh)\s+-[^\s]*c(\s+|$)', "shell command via -c/-lc flag"),
    (r'\b(python[23]?|perl|ruby|node)\s+-[ec]\s+', "script execution via -e/-c flag"),
    (r'\b(curl|wget)\b.*\|\s*(ba)?sh\b', "pipe remote content to shell"),
    (r'\b(bash|sh|zsh|ksh)\s+<\s*<?\s*\(\s*(curl|wget)\b', "execute remote script via process substitution"),
    (rf'\btee\b.*["\']?{_SENSITIVE_WRITE_TARGET}', "overwrite system file via tee"),
    (rf'>>?\s*["\']?{_SENSITIVE_WRITE_TARGET}', "overwrite system file via redirection"),
    (r'\bxargs\s+.*\brm\b', "xargs with rm"),
    (r'\bfind\b.*-exec\s+(/\S*/)?rm\b', "find -exec rm"),
    (r'\bfind\b.*-delete\b', "find -delete"),
    # Gateway protection: never start gateway outside systemd management
    (r'gateway\s+run\b.*(&\s*$|&\s*;|\bdisown\b|\bsetsid\b)', "start gateway outside systemd (use 'systemctl --user restart hermes-gateway')"),
    (r'\bnohup\b.*gateway\s+run\b', "start gateway outside systemd (use 'systemctl --user restart hermes-gateway')"),
    # Self-termination protection: prevent agent from killing its own process
    (r'\b(pkill|killall)\b.*\b(hermes|gateway|cli\.py)\b', "kill hermes/gateway process (self-termination)"),
    # Self-termination via kill + command substitution (pgrep/pidof).
    # The name-based pattern above catches `pkill hermes` but not
    # `kill -9 $(pgrep -f hermes)` because the substitution is opaque
    # to regex at detection time. Catch the structural pattern instead.
    (r'\bkill\b.*\$\(\s*pgrep\b', "kill process via pgrep expansion (self-termination)"),
    (r'\bkill\b.*`\s*pgrep\b', "kill process via backtick pgrep expansion (self-termination)"),
    # File copy/move/edit into sensitive system paths
    (r'\b(cp|mv|install)\b.*\s/etc/', "copy/move file into /etc/"),
    (r'\bsed\s+-[^\s]*i.*\s/etc/', "in-place edit of system config"),
    (r'\bsed\s+--in-place\b.*\s/etc/', "in-place edit of system config (long flag)"),
    # Script execution via heredoc — bypasses the -e/-c flag patterns above.
    # `python3 << 'EOF'` feeds arbitrary code via stdin without -c/-e flags.
    (r'\b(python[23]?|perl|ruby|node)\s+<<', "script execution via heredoc"),
    # Git destructive operations that can lose uncommitted work or rewrite
    # shared history. Not captured by rm/chmod/etc patterns.
    (r'\bgit\s+reset\s+--hard\b', "git reset --hard (destroys uncommitted changes)"),
    (r'\bgit\s+push\b.*--force\b', "git force push (rewrites remote history)"),
    (r'\bgit\s+push\b.*-f\b', "git force push short flag (rewrites remote history)"),
    (r'\bgit\s+clean\s+-[^\s]*f', "git clean with force (deletes untracked files)"),
    (r'\bgit\s+branch\s+-D\b', "git branch force delete"),
    # Script execution after chmod +x — catches the two-step pattern where
    # a script is first made executable then immediately run. The script
    # content may contain dangerous commands that individual patterns miss.
    (r'\bchmod\s+\+x\b.*[;&|]+\s*\./', "chmod +x followed by immediate execution"),

    # =====================================================================
    # Pan Desktop — Windows (Level 1: single confirm)
    # =====================================================================
    # Recursive Windows delete without /q (interactive prompt in cmd, but
    # agents running non-interactively will still delete). /q-qualified
    # variants targeting a drive root are handled in CATASTROPHIC_PATTERNS.
    (r'\bdel\b[^\n]*\s/s\b', "Windows recursive delete (del /s)"),
    (r'\b(rmdir|rd)\b[^\n]*\s/s\b', "Windows recursive directory remove (rmdir /s)"),
    # Registry modifications under HKLM / HKCU. ``reg add`` touching HKLM
    # can install persistence autoruns; HKCU-Run is classic user persistence.
    (r'\breg\s+add\s+("?hklm\\|hkey_local_machine\\)', "modify HKLM registry"),
    (r'\breg\s+add\s+("?hkcu\\|hkey_current_user\\)', "modify HKCU registry"),
    # Scheduled task / service persistence primitives.
    (r'\bschtasks\s+/create\b', "scheduled task creation (persistence)"),
    # Privilege escalation via runas / Start-Process -Verb RunAs.
    (r'\brunas\s+/user:', "runas privilege escalation"),
    (r'\bstart-process\b[^\n]*-verb\s+runas\b', "PowerShell privilege escalation (Start-Process -Verb RunAs)"),
    # icacls granting full access to broad principals (Everyone/Users/
    # Authenticated Users). ``:F`` == Full control.
    (r'\bicacls\b[^\n]*\/grant(?::r)?\s+(everyone|users|authenticated\s+users):f\b', "icacls grant Full to Everyone/Users"),
    # ``takeown /f`` — take ownership of arbitrary files, often a prelude
    # to tampering with protected system files.
    (r'\btakeown\s+/f\b', "takeown /f (file ownership seizure)"),
    # ``attrib -r -s -h`` — strip read-only/system/hidden flags, classic
    # precursor to modifying or deleting protected files.
    (r'\battrib\s+[^\n]*(-r\b|-s\b|-h\b)', "attrib remove read-only/system/hidden"),
    # WMI process creation — LOLBIN code execution path.
    (r'\bwmic\s+process\s+call\s+create\b', "WMI process create (code execution)"),
    # PowerShell eval primitives. Keep ``iex`` narrow: only when followed
    # by ``(`` so we don't trip on unrelated identifiers ending in ``iex``.
    (r'\binvoke-expression\b', "PowerShell Invoke-Expression (eval)"),
    (r'\biex\s*\(', "PowerShell iex( (eval shorthand)"),
    # Classic PowerShell curl-to-shell pattern.
    (r'\b(iex|invoke-expression)\b[^\n]*\(\s*new-object\s+[^\n]*net\.webclient\b', "PowerShell download-and-execute (IEX New-Object Net.WebClient)"),
    (r'\bdownloadstring\s*\(\s*[\'"]https?://', "PowerShell DownloadString (remote content fetch)"),
    # Disable PowerShell execution policy guard rails.
    (r'\bset-executionpolicy\s+(unrestricted|bypass)\b', "disable PowerShell execution policy"),
    # Firewall changes.
    (r'\bnetsh\s+advfirewall\s+set\b', "Windows firewall modification (netsh advfirewall)"),
    (r'\bnetsh\s+firewall\s+set\b', "Windows firewall modification (legacy netsh firewall)"),
    # Service deletion / stop. ``sc delete`` is destructive and frequently
    # used to remove security agents; ``sc stop`` is reversible but still
    # a common sabotage primitive.
    (r'\bsc(?:\.exe)?\s+delete\b', "delete Windows service (sc delete)"),
    (r'\bsc(?:\.exe)?\s+stop\b', "stop Windows service (sc stop)"),
    # LOLBIN download tools.
    (r'\bcertutil\b[^\n]*-urlcache\b[^\n]*\bhttps?://', "certutil LOLBIN download (-urlcache)"),
    (r'\bcertutil\b[^\n]*-decode\b', "certutil LOLBIN decode"),
    (r'\bbitsadmin\s+/transfer\b', "bitsadmin LOLBIN download (/transfer)"),
    (r'\bmshta\s+https?://', "mshta LOLBIN remote script execution"),
    # rundll32 invoking a specific DLL export is the real attack shape;
    # bare ``rundll32`` with no DLL is rare but we still flag the common
    # ``rundll32 <dll>,<export>`` form to catch hand-typed payloads.
    (r'\brundll32(?:\.exe)?\s+\S+\.dll,', "rundll32 DLL export execution"),
    # Squiblydoo: regsvr32 /s /n /u /i:http://...
    (r'\bregsvr32\b[^\n]*/i:https?://', "regsvr32 squiblydoo (/i:http)"),
    # curl.exe download-and-execute patterns. Catches three shapes:
    #   * curl ... | cmd / powershell         (pipe to shell)
    #   * curl ... > out.exe                  (redirect to executable)
    #   * curl ... -o out.exe / --output .exe (curl's own output flag)
    (r'\bcurl(?:\.exe)?\b[^\n]*\|\s*(cmd|powershell|pwsh)\b', "curl piped to cmd/powershell"),
    (r'\bcurl(?:\.exe)?\b[^\n]*>\s*[\'"]?[^\s\'"|&;]+\.(exe|bat|cmd|ps1|vbs|hta|msi|scr|dll)\b', "curl redirected to executable file"),
    (r'\bcurl(?:\.exe)?\b[^\n]*\s(?:-o|--output)\s+[\'"]?[^\s\'"|&;]+\.(exe|bat|cmd|ps1|vbs|hta|msi|scr|dll)\b', "curl -o to executable file"),
    # Invoke-WebRequest / iwr saving to an executable — PowerShell equivalent
    # of the curl pattern above.
    (r'\b(invoke-webrequest|iwr)\b[^\n]*-outfile\s+[\'"]?[^\s\'"|&;]+\.(exe|bat|cmd|ps1|vbs|hta|msi|scr|dll)\b', "Invoke-WebRequest to executable file"),
    # Exfil staging: compressing known-sensitive Windows paths.
    (r'\bcompress-archive\b[^\n]*(\\\.ssh\b|\\\.hermes\b|\\appdata\\|\\sysvol\b|ntds\.dit|sam\b)', "Compress-Archive of sensitive path (exfil staging)"),
    # Certificate export — private keys leaving the machine.
    (r'\bexport-pfxcertificate\b', "Export-PfxCertificate (private key export)"),
    (r'\bcertutil\b[^\n]*-exportpfx\b', "certutil -exportPFX (private key export)"),
]


# =========================================================================
# CATASTROPHIC_PATTERNS (Level 2 — double-confirm with exact phrase)
# =========================================================================
#
# Criteria for inclusion:
#   * Irreversible OR difficult to recover from within minutes.
#   * Ransomware-adjacent, anti-forensics, or credential-dump tooling.
#   * Tampering with the host's security posture (Defender, boot config).
#
# A Level 2 match should NEVER auto-approve under ``approvals.mode=smart``
# and should NEVER be eligible for the permanent allowlist. Enforcement of
# those UX rules lives in the callers (gateway + CLI prompt); this list
# only identifies them.
# =========================================================================

CATASTROPHIC_PATTERNS = [
    # Volume Shadow Copies — ransomware deletes these first so users can't
    # roll back encrypted files. Both vssadmin and wmic variants.
    (r'\bvssadmin\s+delete\s+shadows\b', "delete Volume Shadow Copies (ransomware primitive)"),
    (r'\bwmic\s+shadowcopy\s+delete\b', "delete Volume Shadow Copies via wmic"),
    (r'\bget-wmiobject\b[^\n]*win32_shadowcopy\b[^\n]*\.delete\(\)', "delete Volume Shadow Copies via Get-WmiObject"),
    # Disk format. ``format C:`` / ``format C: /fs:ntfs`` / ``format /fs``
    # Match ``format`` followed by a single drive letter and colon with a
    # trailing space/EOL. Narrow enough that strings like ``print format:``
    # won't trip (requires a drive letter AND colon).
    (r'\bformat\s+[a-z]:(?:\s|$|/)', "format disk"),
    # Mass Windows delete rooted at a drive. Catches both /s /q and /q /s
    # orderings and accepts single or double backslash after the colon.
    (r'\bdel\b[^\n]*\s/s\b[^\n]*\s/q\b[^\n]*\s[a-z]:\\', "del /s /q against drive root"),
    (r'\bdel\b[^\n]*\s/q\b[^\n]*\s/s\b[^\n]*\s[a-z]:\\', "del /q /s against drive root"),
    (r'\b(rmdir|rd)\b[^\n]*\s/s\b[^\n]*\s/q\b[^\n]*\s[a-z]:\\', "rmdir /s /q against drive root"),
    (r'\b(rmdir|rd)\b[^\n]*\s/q\b[^\n]*\s/s\b[^\n]*\s[a-z]:\\', "rmdir /q /s against drive root"),
    # Windows Defender tampering. Set-MpPreference has dozens of -Disable*
    # switches (RealtimeMonitoring, IntrusionPreventionSystem, IOAVProtection,
    # BehaviorMonitoring, BlockAtFirstSeen, ScriptScanning, ...). Match any
    # of them via the ``-Disable`` prefix.
    (r'\bset-mppreference\b[^\n]*-disable\w+', "disable Windows Defender protection (Set-MpPreference -Disable*)"),
    # Defender exclusion bypass. Attackers add ExclusionPath/Process/
    # Extension to carve a hole for their payloads.
    (r'\badd-mppreference\b[^\n]*-exclusion(path|process|extension)\b', "Defender exclusion bypass (Add-MpPreference -Exclusion*)"),
    # Stop the Defender service itself.
    (r'\bstop-service\b[^\n]*\bwindefend\b', "stop Windows Defender service (Stop-Service)"),
    (r'\bsc(?:\.exe)?\s+stop\s+windefend\b', "stop Windows Defender service (sc stop)"),
    (r'\bsc(?:\.exe)?\s+config\s+windefend\b[^\n]*start=\s*disabled\b', "disable Windows Defender service at boot"),
    # Boot configuration tampering. ``bcdedit /set`` is used to disable
    # signed-driver enforcement, enable safe-mode persistence, or wipe the
    # recovery environment. Any /set (or /deletevalue) is suspicious at
    # this level.
    (r'\bbcdedit\b[^\n]*/set\b', "bcdedit boot configuration modification"),
    (r'\bbcdedit\b[^\n]*/deletevalue\b', "bcdedit boot value deletion"),
    # ``cipher /w`` — free-space wipe. Irreversible data destruction on the
    # targeted volume, typically a ransomware or anti-forensics step.
    (r'\bcipher\s+/w:', "cipher /w (secure-wipe free space)"),
    # Registry hive deletion under HKLM — can brick the OS. ``reg delete
    # HKLM\\SYSTEM`` or similar is not something an agent should ever do
    # without explicit human consent.
    (r'\breg\s+delete\s+("?hklm\\|hkey_local_machine\\)', "delete HKLM registry key"),
    # ``reg delete HKCU`` on the whole hive is also catastrophic; targeted
    # subkey deletes still benefit from the double-confirm given the blast
    # radius of accidental typos.
    (r'\breg\s+delete\s+("?hkcu\\|hkey_current_user\\)', "delete HKCU registry key"),
    # Delete a local user account.
    (r'\bnet\s+user\s+\S+\s+/delete\b', "delete Windows user account (net user /delete)"),
    (r'\bremove-localuser\b', "delete Windows user account (Remove-LocalUser)"),
    # Credential dump tooling. ``mimikatz`` is a literal string match;
    # ``procdump -ma lsass`` is the LSASS-dump primitive used when attackers
    # cannot drop mimikatz directly.
    (r'\bmimikatz\b', "mimikatz credential dumper"),
    (r'\bprocdump(?:\.exe)?\b[^\n]*-ma\b[^\n]*\blsass\b', "procdump LSASS credential dump"),
    (r'\brundll32(?:\.exe)?\s+[^\n]*comsvcs\.dll[^\n]*minidump\b', "comsvcs.dll MiniDump (LSASS dump LOLBIN)"),
    # Active Directory database dump. ``ntdsutil`` is the official tool;
    # it also has legitimate administrative uses, but no AI agent should
    # run it unattended.
    (r'\bntdsutil\b', "ntdsutil (Active Directory database access)"),
    # Anti-forensics: clearing Windows event logs.
    (r'\bwevtutil\s+cl\b', "clear Windows event log (wevtutil cl)"),
    (r'\bclear-eventlog\b', "clear Windows event log (Clear-EventLog)"),
    (r'\bwevtutil\s+sl\b[^\n]*/e:false\b', "disable Windows event log channel (wevtutil sl /e:false)"),
    # Disable the Volume Shadow Copy service so further shadows can't form.
    (r'\bsc(?:\.exe)?\s+(stop|delete|config)\s+vss\b', "disable Volume Shadow Copy service"),
]


def _legacy_pattern_key(pattern: str) -> str:
    """Reproduce the old regex-derived approval key for backwards compatibility."""
    return pattern.split(r'\b')[1] if r'\b' in pattern else pattern[:20]


_PATTERN_KEY_ALIASES: dict[str, set[str]] = {}
for _pattern, _description in DANGEROUS_PATTERNS:
    _legacy_key = _legacy_pattern_key(_pattern)
    _canonical_key = _description
    _PATTERN_KEY_ALIASES.setdefault(_canonical_key, set()).update({_canonical_key, _legacy_key})
    _PATTERN_KEY_ALIASES.setdefault(_legacy_key, set()).update({_legacy_key, _canonical_key})


def _approval_key_aliases(pattern_key: str) -> set[str]:
    """Return all approval keys that should match this pattern.

    New approvals use the human-readable description string, but older
    command_allowlist entries and session approvals may still contain the
    historical regex-derived key.
    """
    return _PATTERN_KEY_ALIASES.get(pattern_key, {pattern_key})


# =========================================================================
# Detection
# =========================================================================

def _normalize_command_for_detection(command: str) -> str:
    """Normalize a command string before dangerous-pattern matching.

    Strips ANSI escape sequences (full ECMA-48 via tools.ansi_strip),
    null bytes, and normalizes Unicode fullwidth characters so that
    obfuscation techniques cannot bypass the pattern-based detection.
    """
    from tools.ansi_strip import strip_ansi

    # Strip all ANSI escape sequences (CSI, OSC, DCS, 8-bit C1, etc.)
    command = strip_ansi(command)
    # Strip null bytes
    command = command.replace('\x00', '')
    # Normalize Unicode (fullwidth Latin, halfwidth Katakana, etc.)
    command = unicodedata.normalize('NFKC', command)
    return command


def detect_dangerous_command(command: str) -> tuple:
    """Check if a command matches any dangerous patterns.

    Returns:
        (is_dangerous, pattern_key, description) or (False, None, None)

    Note: This function matches against DANGEROUS_PATTERNS only. A command
    that matches a CATASTROPHIC_PATTERNS entry but not DANGEROUS_PATTERNS
    will NOT be reported here. Callers that need to distinguish Level 1
    from Level 2 should use ``check_command_approval`` instead. For
    callers that only care about "is this risky at all", use
    ``check_command_approval(...).pattern_key is not None``.
    """
    command_lower = _normalize_command_for_detection(command).lower()
    for pattern, description in DANGEROUS_PATTERNS:
        if re.search(pattern, command_lower, re.IGNORECASE | re.DOTALL):
            pattern_key = description
            return (True, pattern_key, description)
    return (False, None, None)


def detect_catastrophic_command(command: str) -> tuple:
    """Check if a command matches any catastrophic (Level 2) patterns.

    Returns:
        (is_catastrophic, pattern_key, description) or (False, None, None)

    Catastrophic commands require a double-confirmation with an exact
    phrase and are never eligible for the permanent allowlist.
    """
    command_lower = _normalize_command_for_detection(command).lower()
    for pattern, description in CATASTROPHIC_PATTERNS:
        if re.search(pattern, command_lower, re.IGNORECASE | re.DOTALL):
            pattern_key = description
            return (True, pattern_key, description)
    return (False, None, None)


@dataclass
class ApprovalCheck:
    """Unified result of a command risk check.

    Attributes:
        level: 0 = safe, 1 = single-confirm, 2 = double-confirm catastrophic
        pattern_key: Human-readable key used for session/permanent approval
            storage. Same string as ``description`` for current patterns;
            retained as a separate field for parity with the legacy
            ``detect_dangerous_command`` tuple API and for future
            refactors that may split the two.
        description: Human-readable reason shown to the user.
        catastrophic: Convenience shortcut for ``level == 2``.
    """

    level: int
    pattern_key: Optional[str]
    description: Optional[str]
    catastrophic: bool


def check_command_approval(command: str) -> ApprovalCheck:
    """Classify a command into safe / dangerous / catastrophic.

    Catastrophic patterns take precedence: if a command matches both a
    Level 2 pattern and a Level 1 pattern (e.g. ``del /s /q C:\\``, which
    matches ``Windows recursive delete`` AND ``del /s /q against drive
    root``), the Level 2 classification wins.

    This function does NOT perform session/permanent allowlist checks,
    does NOT prompt the user, and does NOT mutate any state. It is a
    pure classifier. Callers are responsible for routing the result
    through the appropriate approval flow.
    """
    catastrophic, cat_key, cat_desc = detect_catastrophic_command(command)
    if catastrophic:
        return ApprovalCheck(
            level=2,
            pattern_key=cat_key,
            description=cat_desc,
            catastrophic=True,
        )

    dangerous, dan_key, dan_desc = detect_dangerous_command(command)
    if dangerous:
        return ApprovalCheck(
            level=1,
            pattern_key=dan_key,
            description=dan_desc,
            catastrophic=False,
        )

    return ApprovalCheck(
        level=0,
        pattern_key=None,
        description=None,
        catastrophic=False,
    )


# =========================================================================
# Per-session approval state (thread-safe)
# =========================================================================

_lock = threading.Lock()
_pending: dict[str, dict] = {}
_session_approved: dict[str, set] = {}
_session_yolo: set[str] = set()
_permanent_approved: set = set()

# =========================================================================
# Blocking gateway approval (mirrors CLI's synchronous input() flow)
# =========================================================================
# Per-session QUEUE of pending approvals.  Multiple threads (parallel
# subagents, execute_code RPC handlers) can block concurrently — each gets
# its own threading.Event.  /approve resolves the oldest, /approve all
# resolves every pending approval in the session.


class _ApprovalEntry:
    """One pending dangerous-command approval inside a gateway session."""
    __slots__ = ("event", "data", "result")

    def __init__(self, data: dict):
        self.event = threading.Event()
        self.data = data          # command, description, pattern_keys, …
        self.result: Optional[str] = None  # "once"|"session"|"always"|"deny"


_gateway_queues: dict[str, list] = {}        # session_key → [_ApprovalEntry, …]
_gateway_notify_cbs: dict[str, object] = {}  # session_key → callable(approval_data)


def register_gateway_notify(session_key: str, cb) -> None:
    """Register a per-session callback for sending approval requests to the user.

    The callback signature is ``cb(approval_data: dict) -> None`` where
    *approval_data* contains ``command``, ``description``, and
    ``pattern_keys``.  The callback bridges sync→async (runs in the agent
    thread, must schedule the actual send on the event loop).
    """
    with _lock:
        _gateway_notify_cbs[session_key] = cb


def unregister_gateway_notify(session_key: str) -> None:
    """Unregister the per-session gateway approval callback.

    Signals ALL blocked threads for this session so they don't hang forever
    (e.g. when the agent run finishes or is interrupted).
    """
    with _lock:
        _gateway_notify_cbs.pop(session_key, None)
        entries = _gateway_queues.pop(session_key, [])
        for entry in entries:
            entry.event.set()


def resolve_gateway_approval(session_key: str, choice: str,
                             resolve_all: bool = False) -> int:
    """Called by the gateway's /approve or /deny handler to unblock
    waiting agent thread(s).

    When *resolve_all* is True every pending approval in the session is
    resolved at once (``/approve all``).  Otherwise only the oldest one
    is resolved (FIFO).

    Returns the number of approvals resolved (0 means nothing was pending).
    """
    with _lock:
        queue = _gateway_queues.get(session_key)
        if not queue:
            return 0
        if resolve_all:
            targets = list(queue)
            queue.clear()
        else:
            targets = [queue.pop(0)]
        if not queue:
            _gateway_queues.pop(session_key, None)

    for entry in targets:
        entry.result = choice
        entry.event.set()
    return len(targets)


def has_blocking_approval(session_key: str) -> bool:
    """Check if a session has one or more blocking gateway approvals waiting."""
    with _lock:
        return bool(_gateway_queues.get(session_key))


def submit_pending(session_key: str, approval: dict):
    """Store a pending approval request for a session."""
    with _lock:
        _pending[session_key] = approval


def approve_session(session_key: str, pattern_key: str):
    """Approve a pattern for this session only."""
    with _lock:
        _session_approved.setdefault(session_key, set()).add(pattern_key)


def enable_session_yolo(session_key: str) -> None:
    """Enable YOLO bypass for a single session key."""
    if not session_key:
        return
    with _lock:
        _session_yolo.add(session_key)


def disable_session_yolo(session_key: str) -> None:
    """Disable YOLO bypass for a single session key."""
    if not session_key:
        return
    with _lock:
        _session_yolo.discard(session_key)


def is_session_yolo_enabled(session_key: str) -> bool:
    """Return True when YOLO bypass is enabled for a specific session."""
    if not session_key:
        return False
    with _lock:
        return session_key in _session_yolo


def is_current_session_yolo_enabled() -> bool:
    """Return True when the active approval session has YOLO bypass enabled."""
    return is_session_yolo_enabled(get_current_session_key(default=""))


def is_approved(session_key: str, pattern_key: str) -> bool:
    """Check if a pattern is approved (session-scoped or permanent).

    Accept both the current canonical key and the legacy regex-derived key so
    existing command_allowlist entries continue to work after key migrations.
    """
    aliases = _approval_key_aliases(pattern_key)
    with _lock:
        if any(alias in _permanent_approved for alias in aliases):
            return True
        session_approvals = _session_approved.get(session_key, set())
        return any(alias in session_approvals for alias in aliases)


def approve_permanent(pattern_key: str):
    """Add a pattern to the permanent allowlist."""
    with _lock:
        _permanent_approved.add(pattern_key)


def load_permanent(patterns: set):
    """Bulk-load permanent allowlist entries from config."""
    with _lock:
        _permanent_approved.update(patterns)


def clear_session(session_key: str):
    """Clear all approvals and pending requests for a session."""
    with _lock:
        _session_approved.pop(session_key, None)
        _session_yolo.discard(session_key)
        _pending.pop(session_key, None)
        _gateway_notify_cbs.pop(session_key, None)
        # Signal ALL blocked threads so they don't hang forever
        entries = _gateway_queues.pop(session_key, [])
        for entry in entries:
            entry.event.set()



# =========================================================================
# Config persistence for permanent allowlist
# =========================================================================

def load_permanent_allowlist() -> set:
    """Load permanently allowed command patterns from config.

    Also syncs them into the approval module so is_approved() works for
    patterns added via 'always' in a previous session.
    """
    try:
        from hermes_cli.config import load_config
        config = load_config()
        patterns = set(config.get("command_allowlist", []) or [])
        if patterns:
            load_permanent(patterns)
        return patterns
    except Exception as e:
        logger.warning("Failed to load permanent allowlist: %s", e)
        return set()


def save_permanent_allowlist(patterns: set):
    """Save permanently allowed command patterns to config."""
    try:
        from hermes_cli.config import load_config, save_config
        config = load_config()
        config["command_allowlist"] = list(patterns)
        save_config(config)
    except Exception as e:
        logger.warning("Could not save allowlist: %s", e)


# =========================================================================
# Approval prompting + orchestration
# =========================================================================

def prompt_dangerous_approval(command: str, description: str,
                              timeout_seconds: int | None = None,
                              allow_permanent: bool = True,
                              approval_callback=None) -> str:
    """Prompt the user to approve a dangerous command (CLI only).

    Args:
        allow_permanent: When False, hide the [a]lways option (used when
            tirith warnings are present, since broad permanent allowlisting
            is inappropriate for content-level security findings).
        approval_callback: Optional callback registered by the CLI for
            prompt_toolkit integration. Signature:
            (command, description, *, allow_permanent=True) -> str.

    Returns: 'once', 'session', 'always', or 'deny'
    """
    if timeout_seconds is None:
        timeout_seconds = _get_approval_timeout()

    if approval_callback is not None:
        try:
            return approval_callback(command, description,
                                     allow_permanent=allow_permanent)
        except Exception as e:
            logger.error("Approval callback failed: %s", e, exc_info=True)
            return "deny"

    os.environ["HERMES_SPINNER_PAUSE"] = "1"
    try:
        while True:
            print()
            print(f"  ⚠️  DANGEROUS COMMAND: {description}")
            print(f"      {command}")
            print()
            if allow_permanent:
                print("      [o]nce  |  [s]ession  |  [a]lways  |  [d]eny")
            else:
                print("      [o]nce  |  [s]ession  |  [d]eny")
            print()
            sys.stdout.flush()

            result = {"choice": ""}

            def get_input():
                try:
                    prompt = "      Choice [o/s/a/D]: " if allow_permanent else "      Choice [o/s/D]: "
                    result["choice"] = input(prompt).strip().lower()
                except (EOFError, OSError):
                    result["choice"] = ""

            thread = threading.Thread(target=get_input, daemon=True)
            thread.start()
            thread.join(timeout=timeout_seconds)

            if thread.is_alive():
                print("\n      ⏱ Timeout - denying command")
                return "deny"

            choice = result["choice"]
            if choice in ('o', 'once'):
                print("      ✓ Allowed once")
                return "once"
            elif choice in ('s', 'session'):
                print("      ✓ Allowed for this session")
                return "session"
            elif choice in ('a', 'always'):
                if not allow_permanent:
                    print("      ✓ Allowed for this session")
                    return "session"
                print("      ✓ Added to permanent allowlist")
                return "always"
            else:
                print("      ✗ Denied")
                return "deny"

    except (EOFError, KeyboardInterrupt):
        print("\n      ✗ Cancelled")
        return "deny"
    finally:
        if "HERMES_SPINNER_PAUSE" in os.environ:
            del os.environ["HERMES_SPINNER_PAUSE"]
        print()
        sys.stdout.flush()


def _normalize_approval_mode(mode) -> str:
    """Normalize approval mode values loaded from YAML/config.

    YAML 1.1 treats bare words like `off` as booleans, so a config entry like
    `approvals:\n  mode: off` is parsed as False unless quoted. Treat that as the
    intended string mode instead of falling back to manual approvals.
    """
    if isinstance(mode, bool):
        return "off" if mode is False else "manual"
    if isinstance(mode, str):
        normalized = mode.strip().lower()
        return normalized or "manual"
    return "manual"


def _get_approval_config() -> dict:
    """Read the approvals config block. Returns a dict with 'mode', 'timeout', etc."""
    try:
        from hermes_cli.config import load_config
        config = load_config()
        return config.get("approvals", {}) or {}
    except Exception as e:
        logger.warning("Failed to load approval config: %s", e)
        return {}


def _get_approval_mode() -> str:
    """Read the approval mode from config. Returns 'manual', 'smart', or 'off'."""
    mode = _get_approval_config().get("mode", "manual")
    return _normalize_approval_mode(mode)


def _get_approval_timeout() -> int:
    """Read the approval timeout from config. Defaults to 60 seconds."""
    try:
        return int(_get_approval_config().get("timeout", 60))
    except (ValueError, TypeError):
        return 60


def _smart_approve(command: str, description: str) -> str:
    """Use the auxiliary LLM to assess risk and decide approval.

    Returns 'approve' if the LLM determines the command is safe,
    'deny' if genuinely dangerous, or 'escalate' if uncertain.

    Inspired by OpenAI Codex's Smart Approvals guardian subagent
    (openai/codex#13860).
    """
    try:
        from agent.auxiliary_client import get_text_auxiliary_client, auxiliary_max_tokens_param

        client, model = get_text_auxiliary_client(task="approval")
        if not client or not model:
            logger.debug("Smart approvals: no aux client available, escalating")
            return "escalate"

        prompt = f"""You are a security reviewer for an AI coding agent. A terminal command was flagged by pattern matching as potentially dangerous.

Command: {command}
Flagged reason: {description}

Assess the ACTUAL risk of this command. Many flagged commands are false positives — for example, `python -c "print('hello')"` is flagged as "script execution via -c flag" but is completely harmless.

Rules:
- APPROVE if the command is clearly safe (benign script execution, safe file operations, development tools, package installs, git operations, etc.)
- DENY if the command could genuinely damage the system (recursive delete of important paths, overwriting system files, fork bombs, wiping disks, dropping databases, etc.)
- ESCALATE if you're uncertain

Respond with exactly one word: APPROVE, DENY, or ESCALATE"""

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            **auxiliary_max_tokens_param(16),
            temperature=0,
        )

        answer = (response.choices[0].message.content or "").strip().upper()

        if "APPROVE" in answer:
            return "approve"
        elif "DENY" in answer:
            return "deny"
        else:
            return "escalate"

    except Exception as e:
        logger.debug("Smart approvals: LLM call failed (%s), escalating", e)
        return "escalate"


def check_dangerous_command(command: str, env_type: str,
                            approval_callback=None) -> dict:
    """Check if a command is dangerous and handle approval.

    This is the main entry point called by terminal_tool before executing
    any command. It orchestrates detection, session checks, and prompting.

    Args:
        command: The shell command to check.
        env_type: Terminal backend type ('local', 'ssh', 'docker', etc.).
        approval_callback: Optional CLI callback for interactive prompts.

    Returns:
        {"approved": True/False, "message": str or None, ...}
    """
    if env_type in ("docker", "singularity", "modal", "daytona"):
        return {"approved": True, "message": None}

    # --yolo: bypass all approval prompts. Gateway /yolo is session-scoped;
    # CLI --yolo remains process-scoped via the env var for local use.
    if os.getenv("HERMES_YOLO_MODE") or is_current_session_yolo_enabled():
        return {"approved": True, "message": None}

    is_dangerous, pattern_key, description = detect_dangerous_command(command)
    if not is_dangerous:
        return {"approved": True, "message": None}

    session_key = get_current_session_key()
    if is_approved(session_key, pattern_key):
        return {"approved": True, "message": None}

    is_cli = os.getenv("HERMES_INTERACTIVE")
    is_gateway = os.getenv("HERMES_GATEWAY_SESSION")

    if not is_cli and not is_gateway:
        return {"approved": True, "message": None}

    if is_gateway or os.getenv("HERMES_EXEC_ASK"):
        submit_pending(session_key, {
            "command": command,
            "pattern_key": pattern_key,
            "description": description,
        })
        return {
            "approved": False,
            "pattern_key": pattern_key,
            "status": "approval_required",
            "command": command,
            "description": description,
            "message": (
                f"⚠️ This command is potentially dangerous ({description}). "
                f"Asking the user for approval.\n\n**Command:**\n```\n{command}\n```"
            ),
        }

    choice = prompt_dangerous_approval(command, description,
                                       approval_callback=approval_callback)

    if choice == "deny":
        return {
            "approved": False,
            "message": f"BLOCKED: User denied this potentially dangerous command (matched '{description}' pattern). Do NOT retry this command - the user has explicitly rejected it.",
            "pattern_key": pattern_key,
            "description": description,
        }

    if choice == "session":
        approve_session(session_key, pattern_key)
    elif choice == "always":
        approve_session(session_key, pattern_key)
        approve_permanent(pattern_key)
        save_permanent_allowlist(_permanent_approved)

    return {"approved": True, "message": None}


# =========================================================================
# Combined pre-exec guard (tirith + dangerous command detection)
# =========================================================================

def _format_tirith_description(tirith_result: dict) -> str:
    """Build a human-readable description from tirith findings.

    Includes severity, title, and description for each finding so users
    can make an informed approval decision.
    """
    findings = tirith_result.get("findings") or []
    if not findings:
        summary = tirith_result.get("summary") or "security issue detected"
        return f"Security scan: {summary}"

    parts = []
    for f in findings:
        severity = f.get("severity", "")
        title = f.get("title", "")
        desc = f.get("description", "")
        if title and desc:
            parts.append(f"[{severity}] {title}: {desc}" if severity else f"{title}: {desc}")
        elif title:
            parts.append(f"[{severity}] {title}" if severity else title)
    if not parts:
        summary = tirith_result.get("summary") or "security issue detected"
        return f"Security scan: {summary}"

    return "Security scan — " + "; ".join(parts)


def check_all_command_guards(command: str, env_type: str,
                             approval_callback=None) -> dict:
    """Run all pre-exec security checks and return a single approval decision.

    Gathers findings from tirith and dangerous-command detection, then
    presents them as a single combined approval request. This prevents
    a gateway force=True replay from bypassing one check when only the
    other was shown to the user.
    """
    # Skip containers for both checks
    if env_type in ("docker", "singularity", "modal", "daytona"):
        return {"approved": True, "message": None}

    # --yolo or approvals.mode=off: bypass all approval prompts.
    # Gateway /yolo is session-scoped; CLI --yolo remains process-scoped.
    approval_mode = _get_approval_mode()
    if os.getenv("HERMES_YOLO_MODE") or is_current_session_yolo_enabled() or approval_mode == "off":
        return {"approved": True, "message": None}

    is_cli = os.getenv("HERMES_INTERACTIVE")
    is_gateway = os.getenv("HERMES_GATEWAY_SESSION")
    is_ask = os.getenv("HERMES_EXEC_ASK")

    # Preserve the existing non-interactive behavior: outside CLI/gateway/ask
    # flows, we do not block on approvals and we skip external guard work.
    if not is_cli and not is_gateway and not is_ask:
        return {"approved": True, "message": None}

    # --- Phase 1: Gather findings from both checks ---

    # Tirith check — wrapper guarantees no raise for expected failures.
    # Only catch ImportError (module not installed).
    tirith_result = {"action": "allow", "findings": [], "summary": ""}
    try:
        from tools.tirith_security import check_command_security
        tirith_result = check_command_security(command)
    except ImportError:
        pass  # tirith module not installed — allow

    # Dangerous command check (detection only, no approval)
    is_dangerous, pattern_key, description = detect_dangerous_command(command)

    # --- Phase 2: Decide ---

    # Collect warnings that need approval
    warnings = []  # list of (pattern_key, description, is_tirith)

    session_key = get_current_session_key()

    # Tirith block/warn → approvable warning with rich findings.
    # Previously, tirith "block" was a hard block with no approval prompt.
    # Now both block and warn go through the approval flow so users can
    # inspect the explanation and approve if they understand the risk.
    if tirith_result["action"] in ("block", "warn"):
        findings = tirith_result.get("findings") or []
        rule_id = findings[0].get("rule_id", "unknown") if findings else "unknown"
        tirith_key = f"tirith:{rule_id}"
        tirith_desc = _format_tirith_description(tirith_result)
        if not is_approved(session_key, tirith_key):
            warnings.append((tirith_key, tirith_desc, True))

    if is_dangerous:
        if not is_approved(session_key, pattern_key):
            warnings.append((pattern_key, description, False))

    # Nothing to warn about
    if not warnings:
        return {"approved": True, "message": None}

    # --- Phase 2.5: Smart approval (auxiliary LLM risk assessment) ---
    # When approvals.mode=smart, ask the aux LLM before prompting the user.
    # Inspired by OpenAI Codex's Smart Approvals guardian subagent
    # (openai/codex#13860).
    if approval_mode == "smart":
        combined_desc_for_llm = "; ".join(desc for _, desc, _ in warnings)
        verdict = _smart_approve(command, combined_desc_for_llm)
        if verdict == "approve":
            # Auto-approve and grant session-level approval for these patterns
            for key, _, _ in warnings:
                approve_session(session_key, key)
            logger.debug("Smart approval: auto-approved '%s' (%s)",
                         command[:60], combined_desc_for_llm)
            return {"approved": True, "message": None,
                    "smart_approved": True,
                    "description": combined_desc_for_llm}
        elif verdict == "deny":
            combined_desc_for_llm = "; ".join(desc for _, desc, _ in warnings)
            return {
                "approved": False,
                "message": f"BLOCKED by smart approval: {combined_desc_for_llm}. "
                           "The command was assessed as genuinely dangerous. Do NOT retry.",
                "smart_denied": True,
            }
        # verdict == "escalate" → fall through to manual prompt

    # --- Phase 3: Approval ---

    # Combine descriptions for a single approval prompt
    combined_desc = "; ".join(desc for _, desc, _ in warnings)
    primary_key = warnings[0][0]
    all_keys = [key for key, _, _ in warnings]
    has_tirith = any(is_t for _, _, is_t in warnings)

    # Gateway/async approval — block the agent thread until the user
    # responds with /approve or /deny, mirroring the CLI's synchronous
    # input() flow.  The agent never sees "approval_required"; it either
    # gets the command output (approved) or a definitive "BLOCKED" message.
    if is_gateway or is_ask:
        notify_cb = None
        with _lock:
            notify_cb = _gateway_notify_cbs.get(session_key)

        if notify_cb is not None:
            # --- Blocking gateway approval (queue-based) ---
            # Each call gets its own _ApprovalEntry so parallel subagents
            # and execute_code threads can block concurrently.
            approval_data = {
                "command": command,
                "pattern_key": primary_key,
                "pattern_keys": all_keys,
                "description": combined_desc,
            }
            entry = _ApprovalEntry(approval_data)
            with _lock:
                _gateway_queues.setdefault(session_key, []).append(entry)

            # Notify the user (bridges sync agent thread → async gateway)
            try:
                notify_cb(approval_data)
            except Exception as exc:
                logger.warning("Gateway approval notify failed: %s", exc)
                with _lock:
                    queue = _gateway_queues.get(session_key, [])
                    if entry in queue:
                        queue.remove(entry)
                    if not queue:
                        _gateway_queues.pop(session_key, None)
                return {
                    "approved": False,
                    "message": "BLOCKED: Failed to send approval request to user. Do NOT retry.",
                    "pattern_key": primary_key,
                    "description": combined_desc,
                }

            # Block until the user responds or timeout (default 5 min)
            timeout = _get_approval_config().get("gateway_timeout", 300)
            try:
                timeout = int(timeout)
            except (ValueError, TypeError):
                timeout = 300
            resolved = entry.event.wait(timeout=timeout)

            # Clean up this entry from the queue
            with _lock:
                queue = _gateway_queues.get(session_key, [])
                if entry in queue:
                    queue.remove(entry)
                if not queue:
                    _gateway_queues.pop(session_key, None)

            choice = entry.result
            if not resolved or choice is None or choice == "deny":
                reason = "timed out" if not resolved else "denied by user"
                return {
                    "approved": False,
                    "message": f"BLOCKED: Command {reason}. Do NOT retry this command.",
                    "pattern_key": primary_key,
                    "description": combined_desc,
                }

            # User approved — persist based on scope (same logic as CLI)
            for key, _, is_tirith in warnings:
                if choice == "session" or (choice == "always" and is_tirith):
                    approve_session(session_key, key)
                elif choice == "always":
                    approve_session(session_key, key)
                    approve_permanent(key)
                    save_permanent_allowlist(_permanent_approved)
                # choice == "once": no persistence — command allowed this
                # single time only, matching the CLI's behavior.

            return {"approved": True, "message": None,
                    "user_approved": True, "description": combined_desc}

        # Fallback: no gateway callback registered (e.g. cron, batch).
        # Return approval_required for backward compat.
        submit_pending(session_key, {
            "command": command,
            "pattern_key": primary_key,
            "pattern_keys": all_keys,
            "description": combined_desc,
        })
        return {
            "approved": False,
            "pattern_key": primary_key,
            "status": "approval_required",
            "command": command,
            "description": combined_desc,
            "message": (
                f"⚠️ {combined_desc}. Asking the user for approval.\n\n**Command:**\n```\n{command}\n```"
            ),
        }

    # CLI interactive: single combined prompt
    # Hide [a]lways when any tirith warning is present
    choice = prompt_dangerous_approval(command, combined_desc,
                                       allow_permanent=not has_tirith,
                                       approval_callback=approval_callback)

    if choice == "deny":
        return {
            "approved": False,
            "message": "BLOCKED: User denied. Do NOT retry.",
            "pattern_key": primary_key,
            "description": combined_desc,
        }

    # Persist approval for each warning individually
    for key, _, is_tirith in warnings:
        if choice == "session" or (choice == "always" and is_tirith):
            # tirith: session only (no permanent broad allowlisting)
            approve_session(session_key, key)
        elif choice == "always":
            # dangerous patterns: permanent allowed
            approve_session(session_key, key)
            approve_permanent(key)
            save_permanent_allowlist(_permanent_approved)

    return {"approved": True, "message": None,
            "user_approved": True, "description": combined_desc}


# =========================================================================
# Pan Desktop — Level 1 / Level 2 callback flow
# =========================================================================
#
# The upstream callback signature is ``(command, description, *,
# allow_permanent=True) -> str`` returning ``"once"|"session"|"always"|
# "deny"``. That is preserved verbatim by ``prompt_dangerous_approval``
# and the existing ``check_dangerous_command`` orchestration above so
# Linux callers and the upstream test suite continue to work unchanged.
#
# Pan Desktop adds a SECOND callback shape — the level-aware
# ``ApprovalCallback`` Protocol below — used exclusively by callers
# that opt in via the new ``check_and_approve`` entry point. This
# preserves backwards compatibility while exposing Level 2 escalation
# (double-confirm with an exact phrase) to new callers.
#
# Why a sibling entry point instead of extending check_dangerous_command:
#   1. ``check_dangerous_command`` returns a dict for the gateway/CLI
#      orchestration loop and is wired into terminal_tool. Changing its
#      shape would ripple into every upstream caller.
#   2. ``check_and_approve`` is a thin synchronous classify-then-call
#      helper for desktop callers and tests that just want the boolean
#      "is this approved" answer with the level signaling already
#      handled. Gateway/CLI integration remains the source of truth for
#      session/permanent allowlist persistence — that flow is untouched.
# =========================================================================

LEVEL_2_CONFIRMATION_PHRASE: str = "YES-I-UNDERSTAND-THE-RISK"
"""Exact phrase a Level 2 callback must echo back to confirm a catastrophic
command. Anything else (including ``True``, ``False``, an empty string, or
a near-miss like ``"yes-i-understand-the-risk"``) is treated as denial."""


class ApprovalCallback(Protocol):
    """Level-aware approval callback signature.

    The legacy CLI callback shape remains
    ``(command, description, *, allow_permanent=True) -> str`` and is still
    consumed by ``prompt_dangerous_approval``. New callers route through
    ``check_and_approve`` and implement THIS protocol instead.

    Implementations must accept all keyword arguments — additional fields
    may be added in future overlay revisions and unknown kwargs should be
    ignored gracefully (use ``**kwargs`` if forward-compat matters).

    Return values:
        * ``True``  — Level 1 user approval (single confirm).
        * ``False`` — Level 1 user denial OR Level 2 user denial.
        * ``LEVEL_2_CONFIRMATION_PHRASE`` (the exact string) — Level 2
          user approval. Any other string is treated as denial.
        * ``"preview"`` — optional preview-request sentinel reserved for
          future UI integration. Currently treated as a non-approval by
          ``check_and_approve``; callers wanting preview semantics must
          handle the result themselves.
    """

    def __call__(
        self,
        command: str,
        pattern_key: str,
        *,
        level: int = 1,
        description: str = "",
        reason: str = "",
    ) -> Union[bool, str]:
        ...


def verify_level_2_approval(callback_result: Union[bool, str]) -> bool:
    """Return True only when the callback echoed the exact Level 2 phrase.

    A bare ``True`` is NOT enough for Level 2 — the callback must return
    the literal :data:`LEVEL_2_CONFIRMATION_PHRASE` string. This forces UI
    layers to render the actual phrase to the user and require them to
    type it back, which is the whole point of the Level 2 escalation.
    """
    return (
        isinstance(callback_result, str)
        and callback_result == LEVEL_2_CONFIRMATION_PHRASE
    )


def check_and_approve(
    command: str,
    callback: ApprovalCallback,
) -> tuple[bool, str]:
    """Single entry point: classify *command* and route to *callback* if needed.

    This is the recommended entry point for Pan Desktop callers (terminal
    tool, code-execution sandbox guard, future automation layers) that
    want unified Level 1 / Level 2 handling without re-implementing the
    classify→prompt→verify flow.

    Args:
        command: The shell command to classify.
        callback: A level-aware :class:`ApprovalCallback`. The callback
            is invoked AT MOST ONCE per call and only when the command
            is dangerous (level >= 1). Safe commands skip the callback
            entirely.

    Returns:
        A ``(approved, reason)`` tuple. When ``approved`` is False the
        ``reason`` field explains why ("user denied", "level 2 denied
        or wrong confirmation phrase", "callback raised") so the caller
        can surface a useful diagnostic. When True, ``reason`` is one
        of ``"safe"``, ``"user approved"``, or
        ``"user approved with phrase confirmation"``.

    Note:
        This helper does NOT consult or mutate the per-session approval
        cache (``_session_approved`` / ``_permanent_approved``). It is
        purely the classify+prompt step. Callers that need session
        persistence should still go through ``check_dangerous_command``
        or ``check_all_command_guards``.
    """
    result: ApprovalCheck = check_command_approval(command)

    if result.level == 0:
        return (True, "safe")

    pattern_key = result.pattern_key or ""
    description = result.description or ""

    try:
        callback_result = callback(
            command,
            pattern_key,
            level=result.level,
            description=description,
            reason=description,
        )
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.error(
            "Level-aware approval callback raised: %s", exc, exc_info=True
        )
        return (False, f"callback raised: {exc}")

    match result.level:
        case 1:
            if bool(callback_result) and not isinstance(callback_result, str):
                return (True, "user approved")
            # A string return at level 1 is unusual — treat the legacy
            # "once"/"session"/"always" answers as approval, anything
            # else (including "deny") as denial.
            if isinstance(callback_result, str):
                if callback_result.lower() in {"once", "session", "always", "yes", "y"}:
                    return (True, "user approved")
                return (False, "user denied")
            return (False, "user denied")
        case 2:
            if verify_level_2_approval(callback_result):
                return (True, "user approved with phrase confirmation")
            return (False, "level 2 denied or wrong confirmation phrase")
        case _:
            # Unknown level — fail closed.
            return (False, f"unknown approval level {result.level}")


# Load permanent allowlist from config on module import
load_permanent_allowlist()
