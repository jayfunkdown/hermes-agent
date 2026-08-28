import { getSessionMessagesSince } from '@/hermes'
import { reconcileResumeMessages } from '@/app/session/hooks/use-session-actions/utils'
import { type ChatMessage, toChatMessages } from '@/lib/chat-messages'
import { getSessionOwnerHint } from '@/store/session'
import { sessionTileOwnerRoute } from '@/store/session-states'
import type { SessionOwnerRoute } from '@/store/session-request-router'

import type { ClientSessionState } from '@/app/types'

/** Poll cadence for cross-surface mirror reconcile (phone → desktop). */
export const ACTIVE_MIRROR_SESSION_POLL_INTERVAL_MS = 2_000

export function resolveMirrorOwnerRoute(storedSessionId: string): SessionOwnerRoute | null {
  const id = String(storedSessionId || '').trim()

  if (!id) {
    return null
  }

  const route = getSessionOwnerHint(id) ?? sessionTileOwnerRoute(id)

  if (!route) {
    return null
  }

  const connectionId = String(route.connectionId ?? '').trim()

  if (!connectionId || connectionId === 'local' || route.mode === 'local') {
    return null
  }

  return route
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

  const afterId = latestPersistedRowId(state.messages)
  const requestId = requestSequenceRef.current + 1
  requestSequenceRef.current = requestId

  try {
    const page = await getSessionMessagesSince(storedSessionId, afterId, mirrorProfileScope(ownerRoute))

    if (
      requestId !== requestSequenceRef.current ||
      selectedStoredSessionIdRef.current !== storedSessionId ||
      activeSessionIdRef.current !== runtimeSessionId
    ) {
      return
    }

    if (page.unchanged || !page.messages?.length) {
      return
    }

    const incoming = toChatMessages(page.messages)
    const withDelta = mergeDeltaTranscriptMessages(state.messages, incoming)
    const reconciled = reconcileResumeMessages(withDelta, state.messages)

    if (reconciled === state.messages) {
      return
    }

    updateSessionState(runtimeSessionId, current => ({ ...current, messages: reconciled }), storedSessionId)
  } catch {
    // Non-fatal: the next poll or a sessions.changed tick can catch up.
  }
}
