import json

import pytest
from starlette.requests import Request

from hermes_cli.web_routers import sessions


def request_with_json(payload):
    body = json.dumps(payload).encode()
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({"type": "http", "method": "POST", "path": "/api/sessions/s1/messages", "headers": [], "client": ("127.0.0.1", 1), "query_string": b""}, receive)


@pytest.mark.asyncio
async def test_mobile_send_dispatches_prompt_without_pty(monkeypatch):
    from tui_gateway import server
    captured = {}
    monkeypatch.setitem(server._sessions, "s1", {"session_id": "s1"})

    def fake_dispatch(req, transport):
        captured.update(req)
        return None

    monkeypatch.setattr(server, "dispatch", fake_dispatch)
    result = await sessions.submit_session_message("s1", request_with_json({"text": "hello"}))
    assert result == {"ok": True, "session_id": "s1", "accepted": True}
    assert captured["method"] == "prompt.submit"
    assert captured["params"] == {"session_id": "s1", "text": "hello"}


@pytest.mark.asyncio
async def test_mobile_send_rejects_empty_text(monkeypatch):
    with pytest.raises(Exception) as exc:
        await sessions.submit_session_message("s1", request_with_json({"text": "  "}))
    assert getattr(exc.value, "status_code", None) == 422
