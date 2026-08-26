"""Tests for session delta fetch and SSE event hub."""

import asyncio
import json

import pytest
from starlette.testclient import TestClient

from hermes_cli.session_event_hub import SessionEventHub
from hermes_state import SessionDB


@pytest.fixture
def authed_client():
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client


class TestSessionMessageDelta:
    def test_after_id_returns_only_new_rows(self, _isolate_hermes_home, authed_client):
        db = SessionDB()
        try:
            db.create_session(session_id="delta-session", source="cli")
            ids = []
            for i in range(5):
                ids.append(
                    db.append_message(
                        session_id="delta-session", role="user", content=f"msg {i}"
                    )
                )
        finally:
            db.close()

        resp = authed_client.get("/api/sessions/delta-session/messages?after_id=2")
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["session_id"] == "delta-session"
        assert payload["revision"] == ids[-1]
        assert payload["latest_message_id"] == ids[-1]
        assert [m["id"] for m in payload["messages"]] == ids[2:]
        assert payload["pagination"]["order"] == "oldest"
        assert payload["pagination"]["has_more"] is False

    def test_if_revision_short_circuits(self, _isolate_hermes_home, authed_client):
        db = SessionDB()
        try:
            db.create_session(session_id="rev-session", source="cli")
            last_id = db.append_message(session_id="rev-session", role="user", content="hi")
        finally:
            db.close()

        resp = authed_client.get(f"/api/sessions/rev-session/messages?if_revision={last_id}")
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["unchanged"] is True
        assert payload["messages"] == []
        assert payload["revision"] == last_id

    def test_after_id_rejects_incompatible_params(self, _isolate_hermes_home, authed_client):
        db = SessionDB()
        try:
            db.create_session(session_id="bad-delta", source="cli")
            db.append_message(session_id="bad-delta", role="user", content="hi")
        finally:
            db.close()

        for qs in (
            "after_id=1&offset=1",
            "after_id=1&order=latest",
            "after_id=1&include_compacted=true",
        ):
            resp = authed_client.get(f"/api/sessions/bad-delta/messages?{qs}")
            assert resp.status_code == 400, qs


class TestSessionEventsSSE:
    def test_events_stream_404_for_missing_session(self, _isolate_hermes_home, authed_client):
        resp = authed_client.get("/api/sessions/no-such-session/events?after_id=0")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_stream_events_emits_hello():
    async def reader(_profile, _session_id: str) -> int:
        return 7

    hub = SessionEventHub(revision_reader=reader)
    await hub.start()
    try:
        gen = hub.stream_events(None, "sse-session", after_id=3, initial_revision=7)
        payload = json.loads(await asyncio.wait_for(gen.__anext__(), timeout=1.0))
        assert payload["type"] == "hello"
        assert payload["session_id"] == "sse-session"
        assert payload["latest_message_id"] == 7
        assert payload["after_id"] == 3
        await gen.aclose()
    finally:
        await hub.stop()


@pytest.mark.asyncio
async def test_hub_notifies_subscriber_on_revision_bump():
    async def reader(_profile, session_id: str) -> int:
        return revisions.get(session_id, 0)

    revisions = {"s1": 0}
    hub = SessionEventHub(revision_reader=reader)
    await hub.start()
    queue, ok = await hub.subscribe(None, "s1", after_id=0)
    assert ok is True
    try:
        revisions["s1"] = 3
        await hub.notify_session_revision(None, "s1", 3, message_ids=[1, 2, 3])
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event["type"] == "message.appended"
        assert event["revision"] == 3
    finally:
        await hub.stop()
