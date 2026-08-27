"""Cloud-first PC⇄phone Bot Chat mirror helpers.

Desktop and mobile already share the same canonical ``Bot Chat`` contract when
they talk to the **same** ``hermes serve`` backend (OVH). This module documents
that contract in code and provides an optional one-way history seed from a local
profile store into an empty remote canonical chat.

Preferred mirror path: point Hermes Desktop at the remote dashboard (Settings →
Gateways → Remote gateway, or ``HERMES_DESKTOP_REMOTE_URL``). No sync daemon
is required for live two-way mirroring once both clients share OVH ``state.db``.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from hermes_cli.mobile_roster import CANONICAL_CHAT_TITLE

_log = logging.getLogger("hermes_cli.bot_chat_mirror")

CANONICAL_BOT_CHAT_TITLE = CANONICAL_CHAT_TITLE


def canonical_session_list_params(profile: Optional[str]) -> Dict[str, Any]:
    """Gateway ``session.list`` params used by desktop Bot Mode and mobile hub."""
    name = (profile or "").strip()
    params: Dict[str, Any] = {
        "title": CANONICAL_BOT_CHAT_TITLE,
        "include_hidden": True,
    }
    if name and name != "default":
        params["profile"] = name
    return params


def canonical_session_create_params(profile: Optional[str]) -> Dict[str, Any]:
    """Gateway ``session.create`` params for a new canonical Bot Chat."""
    return {
        **canonical_session_list_params(profile),
        "hidden": True,
    }


@dataclass
class RemoteCanonicalSession:
    profile: str
    session_id: str
    resolved_id: str
    message_count: int


def _request_json(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    body: Optional[dict] = None,
    timeout: float = 30.0,
) -> Any:
    data = None
    req_headers = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed ({exc.code}): {detail}") from exc


def fetch_remote_canonical_sessions(
    remote_base_url: str,
    auth_headers: Dict[str, str],
) -> List[RemoteCanonicalSession]:
    """Read canonical Bot Chat rows from ``GET /api/mobile/roster``."""
    base = remote_base_url.rstrip("/")
    payload = _request_json(
        f"{base}/api/mobile/roster?include_sessions=true",
        headers=auth_headers,
    )
    rows: List[RemoteCanonicalSession] = []
    for profile in payload.get("profiles") or []:
        if not isinstance(profile, dict):
            continue
        name = str(profile.get("name") or "").strip() or "default"
        canonical = profile.get("canonical_session")
        if not isinstance(canonical, dict):
            continue
        session_id = str(canonical.get("id") or "").strip()
        if not session_id:
            continue
        resolved_id = str(canonical.get("resolved_id") or session_id).strip()
        rows.append(
            RemoteCanonicalSession(
                profile=name,
                session_id=session_id,
                resolved_id=resolved_id,
                message_count=int(canonical.get("message_count") or 0),
            )
        )
    return rows


def export_local_canonical_chat(profile: str, hermes_home: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Export the local profile's canonical Bot Chat via ``SessionDB.export_session``."""
    from hermes_cli.main import get_hermes_home
    from hermes_state import SessionDB

    home = hermes_home or get_hermes_home()
    profile_name = (profile or "").strip() or "default"
    profile_dir = home / "profiles" / profile_name
    db_path = profile_dir / "state.db"
    if not db_path.exists():
        return None

    db = SessionDB(db_path=db_path, read_only=True)
    try:
        row = db.get_session_by_title(CANONICAL_BOT_CHAT_TITLE)
        if not row:
            return None
        session_id = db.resolve_resume_session_id(row["id"]) or row["id"]
        exported = db.export_session(session_id)
        if not exported or not exported.get("messages"):
            return None
        exported["title"] = CANONICAL_BOT_CHAT_TITLE
        exported["hidden"] = True
        return exported
    finally:
        db.close()


def seed_profile_to_remote(
    profile: str,
    remote_base_url: str,
    auth_headers: Dict[str, str],
    *,
    hermes_home: Optional[Path] = None,
    dry_run: bool = True,
) -> Dict[str, Any]:
    """One-way seed: copy a local canonical Bot Chat into an empty remote one.

    Only runs when the remote canonical exists with ``message_count == 0``.
    The empty remote row is deleted first so the imported session can keep the
    canonical title without violating UNIQUE(title). Remote rows that already
    have messages are never overwritten.
    """
    profile_name = (profile or "").strip() or "default"
    local_export = export_local_canonical_chat(profile_name, hermes_home=hermes_home)
    if not local_export:
        return {"profile": profile_name, "status": "skipped", "reason": "no local canonical messages"}

    remote_rows = fetch_remote_canonical_sessions(remote_base_url, auth_headers)
    remote = next((row for row in remote_rows if row.profile == profile_name), None)
    if remote is None:
        return {"profile": profile_name, "status": "skipped", "reason": "remote profile missing canonical chat"}
    if remote.message_count > 0:
        return {
            "profile": profile_name,
            "status": "skipped",
            "reason": "remote canonical already has messages",
            "remote_session_id": remote.resolved_id,
            "remote_message_count": remote.message_count,
        }

    result: Dict[str, Any] = {
        "profile": profile_name,
        "status": "dry_run" if dry_run else "seeded",
        "remote_session_id": remote.resolved_id,
        "local_message_count": len(local_export.get("messages") or []),
    }
    if dry_run:
        return result

    base = remote_base_url.rstrip("/")
    delete_query = urllib.parse.urlencode(
        {"profile": profile_name} if profile_name != "default" else {}
    )
    delete_url = f"{base}/api/sessions/{remote.resolved_id}"
    if delete_query:
        delete_url = f"{delete_url}?{delete_query}"
    _request_json(delete_url, method="DELETE", headers=auth_headers)
    import_payload = {"profile": profile_name if profile_name != "default" else None, "sessions": [local_export]}
    import_result = _request_json(
        f"{base}/api/sessions/import",
        method="POST",
        headers=auth_headers,
        body=import_payload,
    )
    result["import"] = import_result
    return result
