import { getLatestSessionMessages, getSessionMessagesSince } from '@/hermes'
import { reconcileResumeMessages } from '@/app/session/hooks/use-session-actions/utils'
import { $workspaceMode, $workspaceNewSessionTarget } from '@/components/pane-shell/workspace-scope'
import { type ChatMessage, toChatMessages } from '@/lib/chat-messages'
import {
  MANAGEMENT_REMOTE_CANONICAL_PROFILE,
  hasConnectedRemoteGateway,
  resolveRemoteGatewayRoute
} from '@/store/management-canonical-chat'
import type { SessionOwnerRoute } from '@/store/session-request-router'
import { getSessionOwnerHints, lineageAliases } from '@/store/session'
import { $sessions } from '@/store/session'
import { $sessionTiles, knownOwnerForSession, sessionTileOwnerRoute } from '@/store/session-states'

import type { ClientSessionState } from '@/app/types'

/** Poll cadence for cross-surface mirror reconcile (phone → desktop). */
export const ACTIVE_MIRROR_SESSION_POLL_INTERVAL_MS = 2_000

const mirrorRevisionByKey = new Map<string, number>()

/** @internal Tests: reset revision cache between cases. */
export function _resetMirrorRevisionCacheForTests(): void {
  mirrorRevisionByKey.clear()
}

export function isRemoteMirrorRoute(route: SessionOwnerRoute | null | undefined): route is SessionOwnerRoute {
  if (!route) {
    return false
  }

  const connectionId = String(route.connectionId ?? '').trim()

  return Boolean(connectionId && connectionId !== 'local' && route.mode !== 'local')
}

function mirrorScopeKey(storedSessionId: string, route: SessionOwnerRoute): string {
  return `${storedSessionId}::${route.connectionId}::${route.targetProfile || route.profile}`
}

function mirrorSessionAliases(storedSessionId: string): string[] {
  return lineageAliases(storedSessionId, $sessions.get())
}

function remoteRouteFromHints(sessionId: string): SessionOwnerRoute | null {
  const hints = getSessionOwnerHints(sessionId)
  const remote = hints.filter(isRemoteMirrorRoute)

  return remote.length === 1 ? remote[0] : remote[0] ?? null
}

function routeFromKnownOwner(owner: ReturnType<typeof knownOwnerForSession>): SessionOwnerRoute | null {
  if (!owner || typeof owner === 'string') {
    return null
  }

  const connectionId = String(owner.connectionId ?? '').trim()

  return connectionId ? owner : null
}

function collectMirrorOwnerRouteCandidates(storedSessionId: string): SessionOwnerRoute[] {
  const candidates: SessionOwnerRoute[] = []
  const seen = new Set<string>()

  const remember = (route: SessionOwnerRoute | null | undefined) => {
    if (!route) {
      return
    }

    const key = `${route.connectionId}::${route.targetProfile || route.profile}`

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    candidates.push(route)
  }

  for (const alias of mirrorSessionAliases(storedSessionId)) {
    remember(sessionTileOwnerRoute(alias))
    remember(remoteRouteFromHints(alias))
    remember(routeFromKnownOwner(knownOwnerForSession(alias)))
  }

  if ($workspaceMode.get() === 'bots') {
    const workspaceTarget = $workspaceNewSessionTarget.get()

    if (workspaceTarget?.kind === 'route') {
      remember(workspaceTarget.route)
    }

    for (const tile of $sessionTiles.get()) {
      if (tile.workspaceMode !== 'bots' || !tile.ownerRoute) {
        continue
      }

      if (mirrorSessionAliases(storedSessionId).includes(tile.storedSessionId)) {
        remember(tile.ownerRoute)
      }
    }
  }

  const aliases = mirrorSessionAliases(storedSessionId)
  const inBotsWorkspace =
    $workspaceMode.get() === 'bots' ||
    $sessionTiles.get().some(
      tile => tile.workspaceMode === 'bots' && aliases.includes(tile.storedSessionId)
    )

  if (!candidates.some(isRemoteMirrorRoute) && inBotsWorkspace && hasConnectedRemoteGateway()) {
    remember(resolveRemoteGatewayRoute(MANAGEMENT_REMOTE_CANONICAL_PROFILE))
  }

  return candidates
}

export function resolveMirrorOwnerRoute(storedSessionId: string): SessionOwnerRoute | null {
  const id = String(storedSessionId || '').trim()

  if (!id) {
    return null
  }

  const candidates = collectMirrorOwnerRouteCandidates(id)
  const remote = candidates.find(isRemoteMirrorRoute)

  return remote ?? null
}

export function mirrorProfileScope(route: SessionOwnerRoute): { connectionId: string; profile: string } {
  return {
    connectionId: route.connectionId,
    profile: route.targetProfile || route.profile
  }
}

export function latestPersistedRowId(messages: readonly ChatMessage[]): number {
  let latest = 0

  for (const message of messages) {
    if (typeof message.rowId === 'number' && Number.isFinite(message.rowId) && message.rowId > latest) {
      latest = message.rowId
    }
  }

  return latest
}

/** Append persisted rows the live transcript does not already hold. */
export function mergeDeltaTranscriptMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) {
    return existing
  }

  const seenRowIds = new Set<number>()
  const seenIds = new Set<string>()

  for (const message of existing) {
    if (typeof message.rowId === 'number') {
      seenRowIds.add(message.rowId)
    }

    seenIds.add(message.id)
  }

  const fresh = incoming.filter(message => {
    if (typeof message.rowId === 'number' && seenRowIds.has(message.rowId)) {
      return false
    }

    return !seenIds.has(message.id)
  })

  if (!fresh.length) {
    return existing
  }

  return [...existing, ...fresh]
}

export interface ActiveMirrorReconcileDeps {
  activeSessionIdRef: { current: string | null }
  requestSequenceRef: { current: number }
  selectedStoredSessionIdRef: { current: string | null }
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
  readSessionState: (runtimeSessionId: string) => ClientSessionState | undefined
}

/** Keyset-fetch new persisted rows for a remote-owned open chat and merge them. */
export async function reconcileActiveMirrorDelta({
  activeSessionIdRef,
  readSessionState,
  requestSequenceRef,
  selectedStoredSessionIdRef,
  updateSessionState
}: ActiveMirrorReconcileDeps): Promise<void> {
  const storedSessionId = selectedStoredSessionIdRef.current
  const runtimeSessionId = activeSessionIdRef.current

  if (!storedSessionId || !runtimeSessionId) {
    return
  }

  const ownerRoute = resolveMirrorOwnerRoute(storedSessionId)

  if (!ownerRoute) {
    return
  }

  const state = readSessionState(runtimeSessionId)

  if (!state) {
    return
  }

  const profileScope = mirrorProfileScope(ownerRoute)
  const afterId = latestPersistedRowId(state.messages)
  const revisionKey = mirrorScopeKey(storedSessionId, ownerRoute)
  const ifRevision = mirrorRevisionByKey.get(revisionKey)
  const requestId = requestSequenceRef.current + 1
  requestSequenceRef.current = requestId

  try {
    const page =
      afterId === 0 && state.messages.length > 0
        ? await getLatestSessionMessages(storedSessionId, profileScope)
        : await getSessionMessagesSince(storedSessionId, afterId, profileScope, ifRevision)

    if (
      requestId !== requestSequenceRef.current ||
      selectedStoredSessionIdRef.current !== storedSessionId ||
      activeSessionIdRef.current !== runtimeSessionId
    ) {
      return
    }

    if (typeof page.revision === 'number' && Number.isFinite(page.revision)) {
      mirrorRevisionByKey.set(revisionKey, page.revision)
    }

    if (page.unchanged || !page.messages?.length) {
      return
    }

    const incoming = toChatMessages(page.messages)
    const withDelta =
      afterId === 0 && state.messages.length > 0
        ? reconcileResumeMessages(incoming, state.messages)
        : mergeDeltaTranscriptMessages(state.messages, incoming)
    const reconciled = reconcileResumeMessages(withDelta, state.messages)

    if (reconciled === state.messages) {
      return
    }

    updateSessionState(runtimeSessionId, current => ({ ...current, messages: reconciled }), storedSessionId)
  } catch {
    // Non-fatal: the next poll or a sessions.changed tick can catch up.
  }
}
