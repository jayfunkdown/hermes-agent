import {
  CANONICAL_BOT_CHAT_TITLE,
  canonicalSessionCreateParams,
  canonicalSessionListParams
} from '@/lib/bot-chat-canonical'
import { $connectionsRegistry } from '@/store/connection-registry-state'
import { activeGatewayConnectionId, requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'
import { normalizeProfileKey } from '@/store/profile'
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

export const MANAGEMENT_REMOTE_CANONICAL_PROFILE = 'boss-bot'

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

/** Point Man management chat binds to the active/registered remote gateway directly. */
export function resolveRemoteGatewayRoute(profileName: string): SessionProfileRoute | null {
  const key = normalizeProfileKey(profileName)
  if (!key || key === 'default') {
    return null
  }

  const connection = $connection.get()
  if (connection?.mode === 'remote') {
    return {
      connectionId: String(connection.connectionId ?? activeGatewayConnectionId() ?? '').trim(),
      mode: 'remote',
      profile: key,
      targetProfile: key
    }
  }

  const registry = $connectionsRegistry.get()
  const remoteEntry = registry?.connections.find(entry => entry.kind !== 'local')
  if (!remoteEntry) {
    return null
  }

  return {
    connectionId: remoteEntry.id,
    mode: 'remote',
    profile: key,
    targetProfile: key
  }
}

export function shouldUseManagementCanonicalChat(profileName: string): boolean {
  if (!hasConnectedRemoteGateway()) {
    return false
  }

  return normalizeProfileKey(profileName) === MANAGEMENT_REMOTE_CANONICAL_PROFILE
}

async function remoteGatewayRequest<T>(
  route: SessionProfileRoute,
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const backendProfile = normalizeProfileKey(route.targetProfile || route.profile)

  // App-global remote gateway: the active primary socket serves every profile.
  if ($connection.get()?.mode === 'remote') {
    return requestGatewayForProfile<T>(backendProfile, method, params)
  }

  if (route.connectionId) {
    return requestGatewayForAgent<T>(route.connectionId, route.profile, method, params)
  }

  return requestGatewayForProfile<T>(backendProfile, method, params)
}

export async function resolveManagementCanonicalSession(
  profileName: string
): Promise<ManagementCanonicalSession | null> {
  if (!shouldUseManagementCanonicalChat(profileName)) {
    return null
  }

  const route = resolveRemoteGatewayRoute(profileName)
  if (!route) {
    return null
  }

  const backendProfile = normalizeProfileKey(route.targetProfile || route.profile)
  const ownerRoute: SessionProfileRoute = {
    ...route,
    targetProfile: backendProfile
  }

  const listed = await remoteGatewayRequest<{ sessions?: SessionListRow[] }>(
    ownerRoute,
    'session.list',
    canonicalSessionListParams(backendProfile)
  )

  const existing = (listed.sessions ?? []).find(isCanonicalBotChatRow)
  const storedSessionId = String(existing?.resolved_id || existing?.id || '').trim()
  if (storedSessionId) {
    return { route: ownerRoute, storedSessionId }
  }

  const created = await remoteGatewayRequest<SessionCreateResponse>(
    ownerRoute,
    'session.create',
    canonicalSessionCreateParams(backendProfile)
  )

  const createdStored = String(created.stored_session_id || created.session_id || '').trim()
  if (!createdStored) {
    return null
  }

  return { route: ownerRoute, storedSessionId: createdStored }
}

export async function rebindManagementCanonicalOnResume(
  profileName: string,
  storedSessionId: string,
  capturedOwner?: SessionProfileRoute
): Promise<{ storedSessionId: string; owner?: SessionProfileRoute }> {
  if (!shouldUseManagementCanonicalChat(profileName)) {
    return { storedSessionId, owner: capturedOwner }
  }

  const canonical = await resolveManagementCanonicalSession(profileName)
  if (!canonical) {
    return { storedSessionId, owner: capturedOwner }
  }

  if (canonical.storedSessionId === storedSessionId) {
    setSessionOwnerHint(storedSessionId, canonical.route)
    return { storedSessionId, owner: capturedOwner ?? canonical.route }
  }

  setSessionOwnerHint(canonical.storedSessionId, canonical.route)
  return { storedSessionId: canonical.storedSessionId, owner: canonical.route }
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
