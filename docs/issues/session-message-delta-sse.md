# Upstream issue draft — paste into GitHub

**Title:** Feature: session message delta + SSE feed for mobile mirror clients (Option A)

**Labels:** `type/feature`, `comp/gateway`

---

## Context

Follow-up to #43625 (Desktop live sync from messaging platforms). That issue closed with polling + `sessions.changed` for **messaging-origin** sessions. It does **not** cover a phone PWA mirroring the same boss-bot/desktop session without Telegram, with reconnect catch-up and no duplicate messages.

**Spike:** bsv-ops `docs/hermes-mobile-mirror-option-a-spike.md` (Option A — cloud `state.db` remains source of truth; desktop + mobile are thin clients into the same profile/session).

## Goal (Phase 1 — backend contract)

Dashboard-scoped session sync primitives behind the **existing gateway/dashboard auth gate** (same token path Desktop uses for remote gateway). **No** new auth system. **Do not** expose the OpenAI-compatible API server publicly.

### Endpoints

1. **`GET /api/sessions/{id}/messages`** — keyset delta fetch:
   - `after_id` (message row id), optional `if_revision` short-circuit
   - Response: `revision`, `latest_message_id`, `has_more`
2. **`GET /api/sessions/{id}/events`** — SSE (`hello`, `message.appended`, `ping`)
   - Reconnect with `after_id`; clients delta-fetch rows with `id > after_id` (no duplication)

### Management decisions (Jason)

- **No hardcoded session** — PWA lists sessions for the active profile; default = most recently active; mirror works for any session id.
- **Auth** — reuse existing dashboard/gateway token gate (Desktop remote path); no new auth system.
- **API server** — do **not** expose `:8642` publicly; only these session endpoints behind HTTPS + auth, rate-limited.

### Non-goals

- Mobile PWA shell
- Public API server exposure
- Terminal/tool endpoints on phone surface

## Notes

- `SessionDB.get_messages(after_id=)` exists; export stream already uses keyset pagination.
- `sessions.changed` is global/coarse; per-session SSE complements it for mirror clients.
- Dashboard plugin routes *could* host thin wrappers; contract lands in core (`hermes_cli/web_routers/sessions.py`).

## Prototype

Branch `cursor/session-message-delta-sse-40a1` — `after_id` + SSE hub + tests.

**Tracking issue:** #95573
