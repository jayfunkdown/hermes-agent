# PC⇄phone Bot Chat mirror (cloud-first)

OVH is the single source of truth for Bot Mode. Both Hermes Desktop and the
mobile `/mobile` PWA must talk to the **same** `hermes serve` dashboard so they
read and write the same canonical **Bot Chat** sessions in OVH `state.db`.

## Why mirroring failed before

- The phone authenticates against **OVH** (`https://hermes.brownsugarvillas.com`).
- The PC desktop talked to **local Hermes** (`C:\Users\jason\AppData\Local\hermes\…`).
- Each machine had its own `state.db`, so Bot Chat history never crossed over.

## Recommended approach: remote gateway (no sync daemon)

Hermes Desktop already supports remote backends. Bot Mode resolves each bot's
forever-chat by exact title lookup (`"Bot Chat"`, hidden) on whichever backend
owns that bot — the same contract mobile uses via `ensureCanonicalChat`.

### 1. OVH prerequisites

- `hermes serve` running on OVH with dashboard auth enabled (OAuth recommended
  for public HTTPS).
- Bot profiles exist on OVH (`boss-bot`, `dev`, `bsv-ops`, `assistant`,
  `mainline`, …).
- Mobile `/mobile` already loads the OVH roster and opens canonical Bot Chats.

### 2. Point the PC desktop at OVH

**Option A — make OVH the primary backend (simplest mirror)**

1. Open **Settings → Gateways**.
2. Choose **Remote gateway**.
3. Set URL to `https://hermes.brownsugarvillas.com` (or your OVH dashboard URL).
4. Sign in with the same auth the phone uses.
5. Restart Desktop if prompted.

**Option B — keep local primary, add OVH as a second connection**

1. **Settings → Gateways → Registered gateways → Add connection → Remote gateway**.
2. Name it `OVH` (or similar), paste the OVH dashboard URL, authenticate.
3. Open bots from the OVH row in the Bots roster — Desktop routes Bot Chat RPCs
   to OVH via `requestProfile` without switching your local Sessions workspace.

**Environment override (app-wide)**

```powershell
setx HERMES_DESKTOP_REMOTE_URL "https://hermes.brownsugarvillas.com"
```

Optional token if not using in-app OAuth sign-in:

```powershell
setx HERMES_DESKTOP_REMOTE_TOKEN "<dashboard-session-token>"
```

Restart Hermes Desktop after setting env vars.

### 3. Verify two-way mirror

1. On PC (connected to OVH): open **Bots → Point man** (or any agent).
2. Send: `mirror test from desktop`.
3. On phone: open `/mobile` → same agent → message should appear within seconds
   (REST delta + SSE).
4. Reply from phone: `mirror test from phone`.
5. Desktop Bot Chat should show the phone message on the next delta/event.

Both sides must resolve the **same session id** for that profile's canonical
`Bot Chat` row on OVH.

## Mobile path (already built)

- Roster: `GET /api/mobile/roster` (falls back to gateway `profiles.list`).
- Open chat: `ensureCanonicalChat` → `session.list` / `session.create` with
  `title: "Bot Chat"`, `include_hidden: true`, `hidden: true` on create.
- Live feed: `GET /api/sessions/{id}/messages` + SSE `/api/sessions/{id}/events`.
- Send: `POST /api/sessions/{id}/messages` (auth required, 20k cap, rate limit).

Shared contract lives in:

- `web/src/lib/bot-chat-canonical.ts` (mobile)
- `hermes_cli/bot_chat_mirror.py` (Python mirror helpers)

## Optional one-way seed (PC history → empty OVH chat)

Use only when OVH has **empty** canonical Bot Chats and you want to copy existing
**local** history once. This does **not** replace live mirroring — configure the
remote gateway for that.

```python
from hermes_cli.bot_chat_mirror import seed_profile_to_remote

seed_profile_to_remote(
    "boss-bot",
    "https://hermes.brownsugarvillas.com",
    {"Authorization": "Bearer <token>"},
    dry_run=True,  # inspect plan first
)
```

Rules:

- Skips profiles with no local canonical messages.
- Skips when remote canonical already has messages (never overwrites).
- Deletes only an **empty** remote canonical row, then imports the local export.
- Does not copy secrets, `auth.json`, or raw `.db` files.

## What not to do

- Do not expose the OpenAI API server (`:8642`) publicly — Desktop and mobile
  need the dashboard WebSocket (`/api/ws`) and REST session endpoints.
- Do not delete or overwrite Jason's PC session history without a backup.
- Do not run two OVH dashboard instances against the same data directory.

## Related docs

- [Multi-connection desktop](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/multi-connection-desktop.md)
- [Desktop remote backend](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/desktop.md)
- [Bot Mode](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/bot-mode.md)
- [Session delta + SSE issue draft](issues/session-message-delta-sse.md)
