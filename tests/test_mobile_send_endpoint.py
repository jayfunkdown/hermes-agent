import json

import pytest
from starlette.requests import Request

from hermes_cli.web_routers import sessions


def request_with_json(payload, *, profile=None):
    body = json.dumps(payload).encode()
    sent = False
    query_string = f"profile={profile}".encode() if profile else b""

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/sessions/s1/messages",
            "headers": [],
            "client": ("127.0.0.1", 1),
            "query_string": query_string,
        },
        receive,
    )


@pytest.mark.asyncio
async def test_mobile_send_resumes_before_prompt(monkeypatch):
    calls = []

    def fake_gateway(method, params):
        calls.append((method, params))
        if method == "session.resume":
            return {"result": {"session_id": "runtime-s1"}}
        if method == "prompt.submit":
            return {"result": {"status": "streaming"}}
        return None

    async def fake_poll(profile, session_id, after_id, text):
        return "runtime-s1", 9, {
            "id": 9,
            "role": "user",
            "content": text,
        }

    monkeypatch.setattr(sessions, "_mobile_gateway_request", fake_gateway)
    monkeypatch.setattr(sessions, "_poll_submitted_user_message", fake_poll)
    monkeypatch.setattr(
        sessions,
        "_read_session_message_revision",
        lambda profile, session_id: ("runtime-s1", 8),
    )
    result = await sessions.submit_session_message("stored-s1", request_with_json({"text": "hello"}))
    assert result == {
        "ok": True,
        "session_id": "runtime-s1",
        "accepted": True,
        "revision": 9,
        "latest_message_id": 9,
        "message": {"id": 9, "role": "user", "content": "hello"},
    }
    assert calls == [
        (
            "session.resume",
            {
                "session_id": "stored-s1",
                "omit_messages": True,
                "defer_history": True,
            },
        ),
        ("prompt.submit", {"session_id": "runtime-s1", "text": "hello"}),
    ]


@pytest.mark.asyncio
async def test_mobile_send_passes_profile_to_resume(monkeypatch):
    captured = {}

    def fake_gateway(method, params):
        captured[method] = params
        if method == "session.resume":
            return {"result": {"session_id": "runtime-s1"}}
        return {"result": {"status": "streaming"}}

    async def fake_poll(profile, session_id, after_id, text):
        return "runtime-s1", 2, {"id": 2, "role": "user", "content": text}

    monkeypatch.setattr(sessions, "_mobile_gateway_request", fake_gateway)
    monkeypatch.setattr(sessions, "_poll_submitted_user_message", fake_poll)
    monkeypatch.setattr(
        sessions,
        "_read_session_message_revision",
        lambda profile, session_id: ("runtime-s1", 1),
    )
    await sessions.submit_session_message(
        "stored-s1",
        request_with_json({"text": "hello"}, profile="boss-bot"),
        profile="boss-bot",
    )
    assert captured["session.resume"]["profile"] == "boss-bot"


@pytest.mark.asyncio
async def test_mobile_send_rejects_empty_text(monkeypatch):
    with pytest.raises(Exception) as exc:
        await sessions.submit_session_message("s1", request_with_json({"text": "  "}))
    assert getattr(exc.value, "status_code", None) == 422


@pytest.mark.asyncio
async def test_mobile_send_surfaces_resume_failure(monkeypatch):
    def fake_gateway(method, params):
        if method == "session.resume":
            return {"error": {"message": "session not found"}}
        return None

    monkeypatch.setattr(sessions, "_mobile_gateway_request", fake_gateway)
    with pytest.raises(Exception) as exc:
        await sessions.submit_session_message("missing", request_with_json({"text": "hello"}))
    assert getattr(exc.value, "status_code", None) == 404
