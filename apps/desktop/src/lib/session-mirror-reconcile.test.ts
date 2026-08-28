import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileResumeMessages } from '@/app/session/hooks/use-session-actions/utils'
import type { ChatMessage } from '@/lib/chat-messages'
import {
  latestPersistedRowId,
  mergeDeltaTranscriptMessages,
  mirrorProfileScope,
  reconcileActiveMirrorDelta,
  resolveMirrorOwnerRoute
} from '@/lib/session-mirror-reconcile'
import { _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal()),
  getSessionMessagesSince: vi.fn()
}))

const { getSessionMessagesSince } = await import('@/hermes')

describe('resolveMirrorOwnerRoute', () => {
  beforeEach(() => {
    _resetSessionOwnerHintsForTests()
    $sessionTiles.set([])
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
    vi.mocked(getSessionMessagesSince).mockReset()
  })

  it('fetches after_id rows and merges them into the active transcript', async () => {
    vi.mocked(getSessionMessagesSince).mockResolvedValue({
      messages: [{ content: 'phone to desktop verify', id: 12, role: 'user', timestamp: 3 }],
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
    })
    expect(updateSessionState).toHaveBeenCalled()
    expect(state.messages.at(-1)?.parts[0]).toMatchObject({ text: 'phone to desktop verify' })
  })
})
