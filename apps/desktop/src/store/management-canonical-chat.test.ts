import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestGatewayForAgent = vi.fn()

vi.mock('@/store/gateway', () => ({
  requestGatewayForAgent: (...args: unknown[]) => requestGatewayForAgent(...args)
}))

vi.mock('@/store/session', async importActual => {
  const actual = await importActual<typeof import('@/store/session')>()
  return {
    ...actual,
    setSessionOwnerHint: vi.fn()
  }
})

const { $connectionsRegistry } = await import('@/store/connection-registry-state')
const { $connection, setSessionOwnerHint } = await import('@/store/session')
const { $profiles } = await import('@/store/profile')
const {
  findRemoteRouteForProfile,
  hasConnectedRemoteGateway,
  openManagementCanonicalChat,
  resolveManagementCanonicalSession,
  shouldUseManagementCanonicalChat
} = await import('./management-canonical-chat')

describe('management-canonical-chat', () => {
  beforeEach(() => {
    requestGatewayForAgent.mockReset()
    $connectionsRegistry.set({
      version: 2,
      primary: 'local',
      secureTokenStorage: true,
      connections: [
        { id: 'local', kind: 'local', label: 'This device', tokenSet: false, tokenPreview: null },
        { id: 'ovh', kind: 'remote', label: 'OVH', tokenSet: true, tokenPreview: 'tok', url: 'https://ovh.example' }
      ]
    })
    $connection.set({ mode: 'local' } as never)
    $profiles.set([{ name: 'boss-bot' }, { name: 'default' }] as never)
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
      getProfileRoutes: vi.fn(async () => [
        {
          connectionId: 'local',
          mode: 'local',
          profile: 'boss-bot',
          targetProfile: 'boss-bot'
        },
        {
          connectionId: 'ovh',
          mode: 'remote',
          profile: 'boss-bot',
          targetProfile: 'boss-bot'
        }
      ])
    }
  })

  it('detects a connected remote gateway from the registry', () => {
    expect(hasConnectedRemoteGateway()).toBe(true)
  })

  it('prefers the remote route for a bot management profile', async () => {
    const route = await findRemoteRouteForProfile('boss-bot')
    expect(route).toEqual({
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
  })

  it('skips canonical resolution in pure local mode', async () => {
    $connectionsRegistry.set({
      version: 2,
      primary: 'local',
      secureTokenStorage: true,
      connections: [{ id: 'local', kind: 'local', label: 'This device', tokenSet: false, tokenPreview: null }]
    })

    await expect(shouldUseManagementCanonicalChat('boss-bot')).resolves.toBe(false)
  })

  it('adopts the remote canonical Bot Chat when it already exists', async () => {
    requestGatewayForAgent.mockResolvedValueOnce({
      sessions: [{ id: 'cec445da', title: 'Bot Chat', root_title: 'Bot Chat' }]
    })

    const resolved = await resolveManagementCanonicalSession('boss-bot')
    expect(resolved).toEqual({
      route: {
        connectionId: 'ovh',
        mode: 'remote',
        profile: 'boss-bot',
        targetProfile: 'boss-bot'
      },
      storedSessionId: 'cec445da'
    })
    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      'ovh',
      'boss-bot',
      'session.list',
      expect.objectContaining({ title: 'Bot Chat', include_hidden: true, profile: 'boss-bot' })
    )
  })

  it('creates the remote canonical Bot Chat when missing', async () => {
    requestGatewayForAgent
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValueOnce({ stored_session_id: 'new-canonical', session_id: 'runtime-1' })

    const resolved = await resolveManagementCanonicalSession('boss-bot')
    expect(resolved?.storedSessionId).toBe('new-canonical')
    expect(requestGatewayForAgent).toHaveBeenLastCalledWith(
      'ovh',
      'boss-bot',
      'session.create',
      expect.objectContaining({ title: 'Bot Chat', hidden: true, profile: 'boss-bot' })
    )
  })

  it('opens the remote canonical session through resumeSession', async () => {
    requestGatewayForAgent.mockResolvedValueOnce({
      sessions: [{ id: 'cec445da', title: 'Bot Chat' }]
    })
    const resumeSession = vi.fn(async () => undefined)

    const opened = await openManagementCanonicalChat('boss-bot', resumeSession)
    expect(opened).toBe(true)
    expect(setSessionOwnerHint).toHaveBeenCalledWith('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
    expect(resumeSession).toHaveBeenCalledWith('cec445da', false, {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
  })
})
