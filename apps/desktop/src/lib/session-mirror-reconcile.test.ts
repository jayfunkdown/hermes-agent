import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileResumeMessages } from '@/app/session/hooks/use-session-actions/utils'
import { $workspaceMode, $workspaceNewSessionTarget } from '@/components/pane-shell/workspace-scope'
import type { ChatMessage } from '@/lib/chat-messages'
import {
  _resetMirrorRevisionCacheForTests,
  latestPersistedRowId,
  mergeDeltaTranscriptMessages,
  mirrorProfileScope,
  reconcileActiveMirrorDelta,
  resolveMirrorOwnerRoute
} from '@/lib/session-mirror-reconcile'
import { _resetSessionOwnerHintsForTests, setSessionOwnerHint, setSessions } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal()),
  getLatestSessionMessages: vi.fn(),
  getSessionMessagesSince: vi.fn()
}))

vi.mock('@/store/management-canonical-chat', () => ({
  MANAGEMENT_REMOTE_CANONICAL_PROFILE: 'boss-bot',
  hasConnectedRemoteGateway: vi.fn(() => true),
  resolveRemoteGatewayRoute: vi.fn(() => ({
    connectionId: 'ovh',
    mode: 'remote',
    profile: 'boss-bot',
    targetProfile: 'boss-bot'
  }))
}))

const { getLatestSessionMessages, getSessionMessagesSince } = await import('@/hermes')

describe('resolveMirrorOwnerRoute', () => {
  beforeEach(() => {
    _resetSessionOwnerHintsForTests()
    _resetMirrorRevisionCacheForTests()
    $sessionTiles.set([])
    setSessions([])
    $workspaceMode.set('sessions')
    $workspaceNewSessionTarget.set(null)
  })

  it('returns a remote owner route from session owner hints', () => {
    setSessionOwnerHint('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })

    expect(resolveMirrorOwnerRoute('cec445da')).toEqual({
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
  })

  it('prefers a remote owner route when local and remote hints coexist', () => {
    setSessionOwnerHint('cec445da', {
      connectionId: 'local',
      mode: 'local',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
    setSessionOwnerHint('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })

    expect(resolveMirrorOwnerRoute('cec445da')?.connectionId).toBe('ovh')
  })

  it('ignores local-only owner routes', () => {
    setSessionOwnerHint('local-chat', {
      connectionId: 'local',
      mode: 'local',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })

    expect(resolveMirrorOwnerRoute('local-chat')).toBeNull()
  })

  it('falls back to the open session tile owner route', () => {
    $sessionTiles.set([
      {
        storedSessionId: 'cec445da',
        ownerRoute: {
          connectionId: 'ovh',
          mode: 'remote',
          profile: 'boss-bot',
          targetProfile: 'boss-bot'
        }
      } as never
    ])

    expect(resolveMirrorOwnerRoute('cec445da')?.connectionId).toBe('ovh')
  })

  it('resolves owner routes across compression lineage aliases', () => {
    setSessions([
      {
        id: '20260823_022120_72b9ab',
        _lineage_root_id: 'cec445da',
        profile: 'boss-bot'
      } as never
    ])
    setSessionOwnerHint('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })

    expect(resolveMirrorOwnerRoute('20260823_022120_72b9ab')?.connectionId).toBe('ovh')
  })

  it('uses the bots workspace route when hints are absent', () => {
    $workspaceMode.set('bots')
    $workspaceNewSessionTarget.set({
      kind: 'route',
      route: {
        connectionId: 'ovh',
        mode: 'remote',
        profile: 'boss-bot',
        targetProfile: 'boss-bot'
      }
    })

    expect(resolveMirrorOwnerRoute('cec445da')?.connectionId).toBe('ovh')
  })
})

describe('mergeDeltaTranscriptMessages', () => {
  const user = (rowId: number, text: string): ChatMessage => ({
    id: `${rowId}-user`,
    parts: [{ text, type: 'text' }],
    role: 'user',
    rowId
  })

  it('appends only unseen persisted rows', () => {
    const existing = [user(4, 'desktop')]
    const incoming = [user(5, 'phone to desktop verify')]

    const merged = mergeDeltaTranscriptMessages(existing, incoming)

    expect(merged).toHaveLength(2)
    expect(merged[1]?.parts[0]).toMatchObject({ text: 'phone to desktop verify' })
  })

  it('does not duplicate rows when poll and websocket deliver the same id', () => {
    const existing = [user(5, 'phone to desktop verify')]
    const incoming = [user(5, 'phone to desktop verify')]

    expect(mergeDeltaTranscriptMessages(existing, incoming)).toBe(existing)
  })

  it('preserves streaming assistant state via reconcileResumeMessages', () => {
    const existing: ChatMessage[] = [
      user(4, 'question'),
      {
        id: 'assistant-live',
        parts: [{ text: 'partial', type: 'text' }],
        pending: true,
        role: 'assistant'
      }
    ]
    const incoming: ChatMessage[] = [user(5, 'phone to desktop verify')]

    const withDelta = mergeDeltaTranscriptMessages(existing, incoming)
    const reconciled = reconcileResumeMessages(withDelta, existing)

    expect(reconciled.map(message => chatMessageText(message))).toEqual([
      'question',
      'partial',
      'phone to desktop verify'
    ])
    expect(reconciled[1]?.pending).toBe(true)
  })
})

function chatMessageText(message: ChatMessage): string {
  return message.parts
    .filter(part => part.type === 'text')
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('')
}

describe('latestPersistedRowId', () => {
  it('tracks the highest row id in the transcript', () => {
    expect(
      latestPersistedRowId([
        { id: '1', parts: [], role: 'user', rowId: 4 },
        { id: '2', parts: [], role: 'assistant', rowId: 9 }
      ])
    ).toBe(9)
  })
})

describe('mirrorProfileScope', () => {
  it('routes REST reads through the remote backend profile', () => {
    expect(
      mirrorProfileScope({
        connectionId: 'ovh',
        mode: 'remote',
        profile: 'boss-bot',
        targetProfile: 'boss-bot'
      })
    ).toEqual({ connectionId: 'ovh', profile: 'boss-bot' })
  })
})

describe('reconcileActiveMirrorDelta', () => {
  beforeEach(() => {
    _resetSessionOwnerHintsForTests()
    _resetMirrorRevisionCacheForTests()
    vi.mocked(getSessionMessagesSince).mockReset()
    vi.mocked(getLatestSessionMessages).mockReset()
  })

  it('fetches after_id rows and merges them into the active transcript', async () => {
    vi.mocked(getSessionMessagesSince).mockResolvedValue({
      messages: [{ content: 'phone to desktop verify', id: 12, role: 'user', timestamp: 3 }],
      revision: 12,
      session_id: 'cec445da'
    } as never)

    const activeSessionIdRef = { current: 'runtime-1' }
    const selectedStoredSessionIdRef = { current: 'cec445da' }
    const requestSequenceRef = { current: 0 }
    let state = {
      messages: [{ id: '4-user', parts: [{ text: 'desktop', type: 'text' }], role: 'user', rowId: 4 }],
      storedSessionId: 'cec445da'
    }
    const updateSessionState = vi.fn((_, updater) => {
      state = updater(state as never)

      return state as never
    })

    setSessionOwnerHint('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })

    await reconcileActiveMirrorDelta({
      activeSessionIdRef,
      readSessionState: () => state as never,
      requestSequenceRef,
      selectedStoredSessionIdRef,
      updateSessionState
    })

    expect(getSessionMessagesSince).toHaveBeenCalledWith('cec445da', 4, {
      connectionId: 'ovh',
      profile: 'boss-bot'
    }, undefined)
    expect(getLatestSessionMessages).not.toHaveBeenCalled()
    expect(updateSessionState).toHaveBeenCalled()
    expect(state.messages.at(-1)?.parts[0]).toMatchObject({ text: 'phone to desktop verify' })
  })

  it('tail-fetches when the live transcript has no persisted row ids yet', async () => {
    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: [
        { content: 'desktop', id: 4, role: 'user', timestamp: 1 },
        { content: 'phone to desktop verify', id: 5, role: 'user', timestamp: 2 }
      ],
      revision: 5,
      session_id: 'cec445da'
    } as never)

    const activeSessionIdRef = { current: 'runtime-1' }
    const selectedStoredSessionIdRef = { current: 'cec445da' }
    const requestSequenceRef = { current: 0 }
    let state = {
      messages: [{ id: 'live-user', parts: [{ text: 'desktop', type: 'text' }], role: 'user' }],
      storedSessionId: 'cec445da'
    }
    const updateSessionState = vi.fn((_, updater) => {
      state = updater(state as never)

      return state as never
    })

    setSessionOwnerHint('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })

    await reconcileActiveMirrorDelta({
      activeSessionIdRef,
      readSessionState: () => state as never,
      requestSequenceRef,
      selectedStoredSessionIdRef,
      updateSessionState
    })

    expect(getLatestSessionMessages).toHaveBeenCalledWith('cec445da', {
      connectionId: 'ovh',
      profile: 'boss-bot'
    })
    expect(getSessionMessagesSince).not.toHaveBeenCalled()
    expect(state.messages.at(-1)?.parts[0]).toMatchObject({ text: 'phone to desktop verify' })
  })
})
