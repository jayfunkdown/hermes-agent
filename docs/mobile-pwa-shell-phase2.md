# Hermes Mobile Mirror — Phase 3 message endpoint

Branch: `cursor/mobile-send-endpoint-40a1`

## Endpoint

```http
POST /api/sessions/{session_id}/messages
Content-Type: application/json

{"text":"hello from the phone"}
```

The existing dashboard auth gate applies (session cookie in gated mode or
`X-Hermes-Session-Token` in loopback mode). The endpoint accepts only a
non-empty string up to 20,000 characters and returns `202`-style acceptance:

```json
{"ok":true,"accepted":true,"session_id":"..."}
```

Requests are scoped to a stored session id. The route resumes the session on
the gateway (`session.resume` with `omit_messages` + `defer_history`) before
dispatching `prompt.submit`, so mobile clients do not need a live runtime id.
Rate limit: 20 messages per client IP per 60 seconds. Expired/revoked dashboard sessions are rejected by the normal
auth middleware; session revocation is performed through the existing Hermes
logout/session revocation path. The gateway's `prompt.submit` transport handles
the message; input is never executed as a shell command.

## Safety boundary

The route does not expose `/api/pty`, `/api/console`, shell, tool, or provider
endpoints. It forwards plain text only to the existing authenticated gateway
RPC and uses a sink transport for asynchronous gateway frames; message and SSE
clients receive results through the Phase 1 session store/event stream.

## Phase 2 features retained

- Active-profile session list and responsive Hermes dashboard styling.
- Delta catch-up via `after_id`, SSE reconnect, and ID deduplication.
- Collapsible tool output and installable manifest/service worker.

## Verification

```bash
pytest tests/hermes_cli/test_session_sync.py tests/test_mobile_send_endpoint.py -q
npm run typecheck -w web
npm test -w web
npm run build -w web
npm run lint -w web
```
