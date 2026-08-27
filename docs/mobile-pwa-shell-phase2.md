# Hermes Mobile Mirror — Phase 2 PWA shell

Branch: `cursor/mobile-pwa-shell-40a1`

What this adds:
- A standalone mobile-first route at `/mobile` that works in a browser tab and as an installed PWA.
- Active-profile session list with most-recently-active default selection.
- Transcript loading for any session id, live SSE sync, and delta catch-up via `after_id` without duplicate rows.
- Composer submit backed by the existing gateway/session transport.
- Clean message bubbles with collapsible tool output and mobile-friendly fallback rendering for long artifact/file content.
- Manifest + service worker registration for installability.

Auth and scope:
- Reuses the existing dashboard auth/session gate.
- Does not expose the OpenAI-compatible API server.
- Does not add terminal/tool endpoints to the phone surface.
- Does not change model/provider selection.

Verification targets:
- `tests/hermes_cli/test_session_sync.py`
- `web/src/lib/mobile-session-sync.test.ts`
- `web` typecheck / unit tests / build
