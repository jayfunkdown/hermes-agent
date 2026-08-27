import type { DesktopPluginProfileRoute } from '@/global'
import {
  CANONICAL_BOT_CHAT_TITLE,
  canonicalSessionCreateParams,
  canonicalSessionListParams
} from '@/lib/bot-chat-canonical'
import { $connectionsRegistry } from '@/store/connection-registry-state'
import { requestGatewayForAgent } from '@/store/gateway'
import { $profiles, normalizeProfileKey } from '@/store/profile'
import { $connection, setSessionOwnerHint } from '@/store/session'
import type { SessionProfileRoute } from '@/store/session-request-router'

interface SessionListRow {
  id?: string
  resolved_id?: string
  title?: string
  root_title?: string
}

interface SessionCreateResponse {
  session_id?: string
  stored_session_id?: string
}

export interface ManagementCanonicalSession {
  route: SessionProfileRoute
  storedSessionId: string
}

function isCanonicalBotChatRow(row: SessionListRow | undefined): boolean {
  if (!row) return false
  const rootTitle = String(row.root_title ?? '').trim()
  const title = String(row.title ?? '').trim()
  return rootTitle === CANONICAL_BOT_CHAT_TITLE || (!rootTitle && title === CANONICAL_BOT_CHAT_TITLE)
}

/** True when a non-local gateway is registered or the active connection is remote. */
export function hasConnectedRemoteGateway(): boolean {
  if ($connection.get()?.mode === 'remote') {
    return true
  }

  const registry = $connectionsRegistry.get()
  return Boolean(registry?.connections.some(connection => connection.kind !== 'local'))
}

export async function findRemoteRouteForProfile(profileName: string): Promise<DesktopPluginProfileRoute | null> {
  const getProfileRoutes = window.hermesDesktop?.getProfileRoutes
  if (!getProfileRoutes) {
    return null
  }

  const key = normalizeProfileKey(profileName)
  if (!key || key === 'default') {
    return null
  }

  let routes: DesktopPluginProfileRoute[]
  try {
    routes = await getProfileRoutes($profiles.get().map(profile => profile.name))
  } catch {
    return null
  }

  const remoteRoutes = routes.filter(route => {
    if (route.mode !== 'remote') {
      return false
    }

    const routeProfile = normalizeProfileKey(route.profile)
    const targetProfile = normalizeProfileKey(route.targetProfile)
    return routeProfile === key || targetProfile === key
  })

  if (remoteRoutes.length === 0) {
    return null
  }

  const registry = $connectionsRegistry.get()
  if (registry) {
    const registryMatch = remoteRoutes.find(route => {
      const connection = registry.connections.find(entry => entry.id === route.connectionId)
      return connection && connection.kind !== 'local'
    })
    if (registryMatch) {
      return registryMatch
    }
  }

  return remoteRoutes[0] ?? null
}

export async function shouldUseManagementCanonicalChat(profileName: string): Promise<boolean> {
  if (!hasConnectedRemoteGateway()) {
    return false
  }

  return (await findRemoteRouteForProfile(profileName)) !== null
}

function backendTargetProfile(route: DesktopPluginProfileRoute): string {
  return normalizeProfileKey(route.targetProfile || route.profile)
}

export async function resolveManagementCanonicalSession(
  profileName: string
): Promise<ManagementCanonicalSession | null> {
  const route = await findRemoteRouteForProfile(profileName)
  if (!route) {
    return null
  }

  const backendProfile = backendTargetProfile(route)
  const ownerRoute: SessionProfileRoute = {
    connectionId: route.connectionId,
    mode: route.mode,
    profile: normalizeProfileKey(route.profile),
    targetProfile: backendProfile
  }

  const listed = await requestGatewayForAgent<{ sessions?: SessionListRow[] }>(
    route.connectionId,
    route.profile,
    'session.list',
    canonicalSessionListParams(backendProfile)
  )

  const existing = (listed.sessions ?? []).find(isCanonicalBotChatRow)
  const storedSessionId = String(existing?.resolved_id || existing?.id || '').trim()
  if (storedSessionId) {
    return { route: ownerRoute, storedSessionId }
  }

  const created = await requestGatewayForAgent<SessionCreateResponse>(
    route.connectionId,
    route.profile,
    'session.create',
    canonicalSessionCreateParams(backendProfile)
  )

  const createdStored = String(created.stored_session_id || created.session_id || '').trim()
  if (!createdStored) {
    return null
  }

  return { route: ownerRoute, storedSessionId: createdStored }
}

export async function openManagementCanonicalChat(
  profileName: string,
  resumeSession: (storedSessionId: string, replaceRoute?: boolean, ownerRoute?: SessionProfileRoute) => Promise<unknown>
): Promise<boolean> {
  const resolved = await resolveManagementCanonicalSession(profileName)
  if (!resolved) {
    return false
  }

  setSessionOwnerHint(resolved.storedSessionId, resolved.route)
  await resumeSession(resolved.storedSessionId, false, resolved.route)
  return true
}
