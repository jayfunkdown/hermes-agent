import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestGatewayForAgent = vi.fn()
const requestGatewayForProfile = vi.fn()

vi.mock('@/store/gateway', () => ({
  activeGatewayConnectionId: vi.fn(() => 'ovh'),
  requestGatewayForAgent: (...args: unknown[]) => requestGatewayForAgent(...args),
  requestGatewayForProfile: (...args: unknown[]) => requestGatewayForProfile(...args)
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
const {
  hasConnectedRemoteGateway,
  openManagementCanonicalChat,
  rebindManagementCanonicalOnResume,
  resolveManagementCanonicalSession,
  resolveRemoteGatewayRoute,
  shouldUseManagementCanonicalChat
} = await import('./management-canonical-chat')

describe('management-canonical-chat', () => {
  beforeEach(() => {
    requestGatewayForAgent.mockReset()
    requestGatewayForProfile.mockReset()
    $connectionsRegistry.set({
      version: 2,
      primary: 'ovh',
      secureTokenStorage: true,
      connections: [
        { id: 'local', kind: 'local', label: 'This device', tokenSet: false, tokenPreview: null },
        { id: 'ovh', kind: 'remote', label: 'OVH', tokenSet: true, tokenPreview: 'tok', url: 'https://ovh.example' }
      ]
    })
    $connection.set({ mode: 'remote', connectionId: 'ovh' } as never)
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
      getProfileRoutes: vi.fn(async () => [])
    }
  })

  it('detects a connected remote gateway from the active connection', () => {
    expect(hasConnectedRemoteGateway()).toBe(true)
  })

  it('binds Point Man directly to the active remote gateway without per-profile routes', () => {
    expect(resolveRemoteGatewayRoute('boss-bot')).toEqual({
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
    expect(shouldUseManagementCanonicalChat('boss-bot')).toBe(true)
  })

  it('skips canonical resolution in pure local mode', () => {
    $connection.set({ mode: 'local' } as never)
    $connectionsRegistry.set({
      version: 2,
      primary: 'local',
      secureTokenStorage: true,
      connections: [{ id: 'local', kind: 'local', label: 'This device', tokenSet: false, tokenPreview: null }]
    })

    expect(shouldUseManagementCanonicalChat('boss-bot')).toBe(false)
  })

  it('resolves via active remote gateway when getProfileRoutes has no boss-bot entry', async () => {
    requestGatewayForProfile.mockResolvedValueOnce({
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
    expect(requestGatewayForProfile).toHaveBeenCalledWith(
      'boss-bot',
      'session.list',
      expect.objectContaining({ title: 'Bot Chat', include_hidden: true, profile: 'boss-bot' })
    )
    expect(requestGatewayForAgent).not.toHaveBeenCalled()
  })

  it('uses a registered secondary remote gateway when local is active', async () => {
    $connection.set({ mode: 'local' } as never)
    requestGatewayForAgent.mockResolvedValueOnce({
      sessions: [{ id: 'cec445da', title: 'Bot Chat' }]
    })

    const resolved = await resolveManagementCanonicalSession('boss-bot')
    expect(resolved?.storedSessionId).toBe('cec445da')
    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      'ovh',
      'boss-bot',
      'session.list',
      expect.objectContaining({ profile: 'boss-bot' })
    )
  })

  it('creates the remote canonical Bot Chat when missing', async () => {
    requestGatewayForProfile
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValueOnce({ stored_session_id: 'new-canonical', session_id: 'runtime-1' })

    const resolved = await resolveManagementCanonicalSession('boss-bot')
    expect(resolved?.storedSessionId).toBe('new-canonical')
    expect(requestGatewayForProfile).toHaveBeenLastCalledWith(
      'boss-bot',
      'session.create',
      expect.objectContaining({ title: 'Bot Chat', hidden: true, profile: 'boss-bot' })
    )
  })

  it('rebinds resume from a local stored id to the remote canonical session', async () => {
    requestGatewayForProfile.mockResolvedValueOnce({
      sessions: [{ id: 'cec445da', title: 'Bot Chat' }]
    })

    const rebound = await rebindManagementCanonicalOnResume('boss-bot', '20260823_022120_72b9ab')
    expect(rebound).toEqual({
      storedSessionId: 'cec445da',
      owner: {
        connectionId: 'ovh',
        mode: 'remote',
        profile: 'boss-bot',
        targetProfile: 'boss-bot'
      }
    })
    expect(setSessionOwnerHint).toHaveBeenCalledWith('cec445da', {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
  })

  it('opens the remote canonical session through resumeSession', async () => {
    requestGatewayForProfile.mockResolvedValueOnce({
      sessions: [{ id: 'cec445da', title: 'Bot Chat' }]
    })
    const resumeSession = vi.fn(async () => undefined)

    const opened = await openManagementCanonicalChat('boss-bot', resumeSession)
    expect(opened).toBe(true)
    expect(resumeSession).toHaveBeenCalledWith('cec445da', false, {
      connectionId: 'ovh',
      mode: 'remote',
      profile: 'boss-bot',
      targetProfile: 'boss-bot'
    })
  })
})
