"""Desktop-equivalent Bot Mode roster for the mobile / dashboard hub.

``profiles.list`` over the dashboard WebSocket already walks every local
profile via ``list_profiles()``. This module is the REST twin used by
``GET /api/mobile/roster`` so the phone can load the same multi-source
descriptors without depending on a live WS connection, and so we can
diagnose default-only responses that are not a healthy Bot Mode hub.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

_log = logging.getLogger("hermes_cli.mobile_roster")

CANONICAL_CHAT_TITLE = "Bot Chat"


def _latest_message_preview(db, session_id: str) -> str:
    try:
        with db._lock:
            row = db._conn.execute(
                "SELECT content FROM messages"
                " WHERE session_id = ? AND role IN ('user', 'assistant')"
                " AND active = 1"
                " AND content IS NOT NULL AND TRIM(content) != ''"
                " ORDER BY id DESC LIMIT 1",
                (session_id,),
            ).fetchone()
    except Exception:
        return ""
    if not row:
        return ""
    text = " ".join(str(row[0] or "").split()).strip()
    if len(text) > 80:
        return text[:80] + "..."
    return text


def _open_profile_session_db(profile_path: Path):
    try:
        db_path = Path(profile_path) / "state.db"
        if not db_path.exists():
            return None
        from hermes_state import SessionDB

        return SessionDB(db_path=db_path, read_only=True)
    except Exception:
        return None


def _canonical_session_row(db, profile_path: Path) -> Optional[Dict[str, Any]]:
    if db is None:
        return None
    try:
        deny = frozenset({"kanban", "tool"})
        row = db.get_session_by_title(CANONICAL_CHAT_TITLE)
        if not row:
            return None
        session_id = str(row.get("id") or "").strip()
        if not session_id:
            return None
        if (row.get("source") or "").strip().lower() in deny:
            return None
        if row.get("archived"):
            return None
        try:
            tip = db.resolve_resume_session_id(session_id) or session_id
        except Exception:
            tip = session_id
        tip_row = db.get_session(tip) or row
        preview = ""
        try:
            preview = _latest_message_preview(db, tip)
        except Exception:
            pass
        return {
            "id": session_id,
            "resolved_id": tip,
            "root_title": row.get("title") or "",
            "title": tip_row.get("title") or "",
            "preview": preview,
            "started_at": tip_row.get("started_at") or row.get("started_at") or 0,
            "last_active": (
                tip_row.get("last_activity_at")
                or tip_row.get("started_at")
                or row.get("started_at")
                or 0
            ),
            "message_count": tip_row.get("message_count") or 0,
        }
    except Exception:
        return None


def _latest_profile_session_rows(db):
    if db is None:
        return None, None
    try:
        deny = frozenset({"kanban", "tool"})
        human = None
        worker = None
        for s in db.list_sessions_rich(
            source=None, limit=20, order_by_last_active=True, compact_rows=True
        ):
            src = (s.get("source") or "").strip().lower()
            if src in deny:
                if worker is None:
                    worker = {
                        "id": s["id"],
                        "source": src,
                        "title": s.get("title") or "",
                        "last_active": s.get("last_active") or s.get("started_at") or 0,
                    }
                continue
            if human is not None:
                continue
            row = {
                "id": s["id"],
                "title": s.get("title") or "",
                "preview": s.get("preview") or "",
                "started_at": s.get("started_at") or 0,
                "last_active": s.get("last_active") or s.get("started_at") or 0,
                "message_count": s.get("message_count") or 0,
            }
            try:
                latest = _latest_message_preview(db, s["id"])
                if latest:
                    row["preview"] = latest
            except Exception:
                pass
            human = row
            if worker is not None:
                break
        return human, worker
    except Exception:
        return None, None


def _read_ui_meta(profile_path: Path) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ui_meta_revisions": {}}
    try:
        import yaml

        meta_path = Path(profile_path) / "profile.yaml"
        if not meta_path.is_file():
            return out
        with open(meta_path, "r", encoding="utf-8") as f:
            raw_meta = yaml.safe_load(f) or {}
        ui_meta = raw_meta.get("ui_meta")
        if isinstance(ui_meta, dict) and ui_meta:
            out["ui_meta"] = ui_meta
        revisions = raw_meta.get("_ui_meta_revisions")
        if isinstance(revisions, dict) and revisions:
            out["ui_meta_revisions"] = {
                str(key): max(0, int(value))
                for key, value in revisions.items()
                if isinstance(value, int) and not isinstance(value, bool)
            }
    except Exception:
        pass
    return out


def _has_avatar(profile_path: Path) -> bool:
    try:
        assets = Path(profile_path) / "assets"
        return any((assets / f"avatar.{ext}").is_file() for ext in ("png", "jpg", "webp"))
    except Exception:
        return False


def _bot_handle(name: str) -> str:
    return "hermes" if (name or "").strip().lower() == "default" else name


def build_mobile_roster(*, include_sessions: bool = True) -> Dict[str, Any]:
    """Return desktop-parity roster descriptors for every local profile."""
    from hermes_cli.profiles import list_profiles

    profiles_out: List[Dict[str, Any]] = []
    for p in list_profiles():
        row: Dict[str, Any] = {
            "name": p.name,
            "handle": _bot_handle(p.name),
            "path": str(p.path),
            "is_default": bool(p.is_default),
            "model": p.model,
            "provider": p.provider,
            "description": getattr(p, "description", "") or "",
            "display_name": getattr(p, "display_name", "") or "",
            "skill_count": getattr(p, "skill_count", 0) or 0,
            "connection_kind": "local",
            "connection_route": "local",
        }
        row.update(_read_ui_meta(p.path))
        row["has_avatar"] = _has_avatar(p.path)
        hidden = False
        ui_meta = row.get("ui_meta")
        if isinstance(ui_meta, dict):
            bots_meta = ui_meta.get("hermes-bots")
            if isinstance(bots_meta, dict):
                hidden = bool(bots_meta.get("hidden"))
                if isinstance(bots_meta.get("title"), str) and bots_meta["title"].strip():
                    row["title"] = bots_meta["title"].strip()
        row["hidden"] = hidden

        if include_sessions:
            db = _open_profile_session_db(p.path)
            try:
                last_row, worker_row = _latest_profile_session_rows(db)
                row["last_session"] = last_row
                row["worker_session"] = worker_row
                row["canonical_session"] = _canonical_session_row(db, p.path)
            finally:
                if db is not None:
                    try:
                        db.close()
                    except Exception:
                        pass

        profiles_out.append(row)

    default_only = len(profiles_out) == 1 and (profiles_out[0].get("name") or "") == "default"
    return {
        "profiles": profiles_out,
        "bot_mode_protocol": True,
        "source": "list_profiles",
        "default_only": default_only,
        "incomplete": default_only,
        "profile_count": len(profiles_out),
    }
