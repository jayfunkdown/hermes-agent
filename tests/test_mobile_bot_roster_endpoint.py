"""Tests for mobile roster REST helpers and avatar endpoint."""

from hermes_cli.web_routers import profiles


def test_bot_roster_revision_tracks_session_activity():
    revision = profiles._bot_roster_revision(
        [
            {
                "canonical_session": {"last_active": 120, "message_count": 4},
                "ui_meta_revisions": {"hermes-bots": 2},
            },
            {"worker_session": {"last_active": 90}},
        ]
    )
    assert revision == 120


def test_profile_avatar_returns_asset(monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.web_routers.sessions._mobile_gateway_request",
        lambda method, params: {
            "result": {
                "found": True,
                "data": "data:image/png;base64,abc",
                "mime": "image/png",
            }
        }
        if method == "profiles.get_asset"
        else None,
    )

    payload = profiles.get_profile_avatar("default")
    assert payload["found"] is True
    assert payload["data"].startswith("data:image/png")
