# Cursor brief: bind native desktop Bot Chat to OVH canonical session

## Problem

Jason's native desktop Point Man row opens local session `20260823_022120_72b9ab`,
while the OVH canonical boss-bot Bot Chat is `cec445da`. Remote Gateway is
connected, but Bot Mode's native desktop open path is still resolving against the
local primary/profile scope.

Prior mobile-mirror work (`6c2e8082fd` "bind Point Man to active remote gateway
without route lookup") did NOT fix the native desktop bot-chat open path. The
desktop brief below is the remaining gap: the native Point Man row still falls
through to ambient `host.request()` because its source route is not retained /
marked `sourceScoped` when Remote Gateway is merely connected but local remains
primary.

## Non-negotiable identity contract

One bot has one canonical forever chat identified by `(owner profile, exact title
"Bot Chat")`. Do not add a session-id pin or recency fallback. Always resolve
`session.list {title:"Bot Chat", include_hidden:true}` on the bot's owning source;
if absent, create hidden `Bot Chat` using adopt-before-mint. The returned
`canonical_session`/lineage tip is the only opened id.

## Likely root cause

`useRoster()` correctly calls `requestForBot()` and `host.agents()` for union
roster, but the native primary row can be treated as an ambient/local profile.
`requestForBot()` only uses `host.requestProfile()` when the row is
`sourceScoped`; the active primary route otherwise falls through to
`host.request()`. If the Desktop window's active connection remains local while
Remote Gateway is merely configured/connected, `profiles.list` and canonical
open resolve the local `default` registry, producing local
`20260823_022120_72b9ab` instead of OVH `cec445da`.

Inspect the runtime values at the Bot Mode click boundary:

- `host.state.connectionId`
- `host.state.profile`
- `host.activeConnectionId()`
- `botConnectionRoute(bot)`
- `backendTargetProfile(route, bot.name)`
- `host.profileRoutes()` result
- `host.agents()` source/connection descriptors

The decisive fix is routing the Point Man row through the explicit OVH
`{connectionId, profile, targetProfile}` descriptor. Do not fix by copying
`cec445da` into local metadata or pinning that id.

## Implementation path

1. Add a diagnostic/unit fixture with local + OVH sources and profiles
   `boss-bot`/`default`.
2. Ensure the union roster row for `@boss-bot` carries its OVH source descriptor
   (`sourceScoped`, `connectionId`, backend target profile).
3. Ensure `botConnectionRoute()` does not discard the descriptor for the active
   primary remote connection.
4. Ensure `requestForBot(row, 'profiles.list')` calls `host.requestProfile(route,
   ...)`, not ambient `host.request()`.
5. Ensure `findExistingCanonicalChat/openBotCanonicalChat` calls the same
   `requestForBot` route and resolves exact title `Bot Chat` on OVH.
6. On click, if the registry id is absent/stale, adopt/create by name on OVH;
   never open the local id as fallback.
7. Keep local desktop Bot Chat behavior unchanged when the selected owner is
   genuinely local.

## Required regression tests

- Remote-primary Point Man row routes `profiles.list` and canonical session
  lookup through `requestProfile` with the OVH route.
- Local-primary row still routes through the local request path.
- Mixed local + remote same-named profiles remain distinct by
  `(connectionId, profile)`.
- Remote canonical lookup returns `cec445da`/the server-reported OVH registry
  row, never `20260823_022120_72b9ab`.
- Stale/missing canonical id triggers exact-title adopt/create on OVH and does
  not read/write `ui_meta['hermes-bots'].chat`.
- Existing tests:
  - `apps/desktop/src/plugins/hermes-bots/tests/canonical-chat-registry.test.mjs`
  - `canonical-chat-creation.test.mjs`
  - `cross-connection-bots.test.mjs`
  - `multi-source-roster.test.mjs`
  - `apps/desktop/src/sdk/profile-routing.test.ts`
  - `apps/desktop/src/sdk/index.test.ts`

## Acceptance test

With Remote Gateway connected and selected as the active/owning route:

1. Open native desktop Bot Mode.
2. Tap Point Man.
3. Capture the RPC route and canonical lookup source.
4. Confirm the opened conversation is the OVH boss-bot Bot Chat and its
   registry/session identity is `cec445da` (or its resolved lineage tip), not
   local `20260823_022120_72b9ab`.
5. Send a harmless marker and verify it appears in the OVH session via desktop,
   `/mobile`, and read-only session API.
6. Switch away/back and restart the desktop; the same named OVH Bot Chat opens.

## Safety

No secrets in logs or fixtures. Do not alter Telegram polling, BSV, calendar,
Hermes memory, or backend session data during development. Do not open an
upstream PR; return a reviewable branch/commit and route diagnostics.
