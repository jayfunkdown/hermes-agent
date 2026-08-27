"""Tests for cloud-first Bot Chat mirror helpers."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from hermes_cli.bot_chat_mirror import (
    CANONICAL_BOT_CHAT_TITLE,
    canonical_session_create_params,
    canonical_session_list_params,
    export_local_canonical_chat,
    fetch_remote_canonical_sessions,
    seed_profile_to_remote,
)
from hermes_state import SessionDB


def test_canonical_title_matches_mobile_roster():
    from hermes_cli.mobile_roster import CANONICAL_CHAT_TITLE

    assert CANONICAL_BOT_CHAT_TITLE == CANONICAL_CHAT_TITLE == "Bot Chat"


def test_canonical_session_list_params_match_desktop_contract():
    assert canonical_session_list_params("boss-bot") == {
        "profile": "boss-bot",
        "title": "Bot Chat",
        "include_hidden": True,
    }
    assert canonical_session_list_params("default") == {
        "title": "Bot Chat",
        "include_hidden": True,
    }


def test_canonical_session_create_params_include_hidden_flag():
    assert canonical_session_create_params("dev") == {
        "profile": "dev",
        "title": "Bot Chat",
        "include_hidden": True,
        "hidden": True,
    }


def test_export_local_canonical_chat_reads_profile_state_db(tmp_path):
    profile_dir = tmp_path / "profiles" / "dev"
    profile_dir.mkdir(parents=True)
    db = SessionDB(db_path=profile_dir / "state.db")
    try:
        db.create_session(session_id="bot-chat-dev", source="cli")
        db.set_session_title("bot-chat-dev", CANONICAL_BOT_CHAT_TITLE)
        db.set_session_hidden("bot-chat-dev", True)
        db.append_message(session_id="bot-chat-dev", role="user", content="hello from pc")
        db.append_message(session_id="bot-chat-dev", role="assistant", content="hi from bot")
    finally:
        db.close()

    exported = export_local_canonical_chat("dev", hermes_home=tmp_path)
    assert exported is not None
    assert exported["title"] == CANONICAL_BOT_CHAT_TITLE
    assert len(exported["messages"]) == 2


def test_fetch_remote_canonical_sessions_parses_mobile_roster_payload():
    payload = {
        "profiles": [
            {
                "name": "boss-bot",
                "canonical_session": {
                    "id": "s1",
                    "resolved_id": "s1-live",
                    "message_count": 0,
                },
            }
        ]
    }

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(payload).encode("utf-8")

    with patch("urllib.request.urlopen", return_value=_Response()):
        rows = fetch_remote_canonical_sessions(
            "https://hermes.example.com",
            {"Authorization": "Bearer test"},
        )

    assert len(rows) == 1
    assert rows[0].profile == "boss-bot"
    assert rows[0].resolved_id == "s1-live"
    assert rows[0].message_count == 0


def test_seed_profile_to_remote_skips_when_remote_already_has_messages(tmp_path):
    profile_dir = tmp_path / "profiles" / "dev"
    profile_dir.mkdir(parents=True)
    db = SessionDB(db_path=profile_dir / "state.db")
    try:
        db.create_session(session_id="bot-chat-dev", source="cli")
        db.set_session_title("bot-chat-dev", CANONICAL_BOT_CHAT_TITLE)
        db.set_session_hidden("bot-chat-dev", True)
        db.append_message(session_id="bot-chat-dev", role="user", content="seed me")
    finally:
        db.close()

    with patch(
        "hermes_cli.bot_chat_mirror.fetch_remote_canonical_sessions",
        return_value=[
            type(
                "Row",
                (),
                {
                    "profile": "dev",
                    "session_id": "remote",
                    "resolved_id": "remote",
                    "message_count": 3,
                },
            )()
        ],
    ):
        result = seed_profile_to_remote(
            "dev",
            "https://hermes.example.com",
            {"Authorization": "Bearer test"},
            hermes_home=tmp_path,
            dry_run=False,
        )

    assert result["status"] == "skipped"
    assert result["reason"] == "remote canonical already has messages"
