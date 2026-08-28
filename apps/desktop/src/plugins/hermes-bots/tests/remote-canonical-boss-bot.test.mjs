import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function load() {
  const calls = []
  const context = {
    atom: initial => {
      let value = initial
      return {
        get: () => value,
        set: next => {
          value = typeof next === 'function' ? next(value) : next
        },
        listen: () => undefined
      }
    },
    host: {
      activeConnectionId: () => 'local',
      openSession: async (id, options) => {
        calls.push({ kind: 'openSession', id, options })
      },
      request: async (method, params) => {
        calls.push({ kind: 'ambient', method, params: JSON.parse(JSON.stringify(params ?? null)) })
        if (method === 'session.list') {
          return { sessions: [{ id: '20260823_022120_72b9ab', title: 'Bot Chat' }] }
        }
        return {}
      },
      requestProfile: async (route, method, params) => {
        calls.push({
          kind: 'profile',
          route: JSON.parse(JSON.stringify(route)),
          method,
          params: JSON.parse(JSON.stringify(params ?? null))
        })
        if (method === 'session.list') {
          return route.connectionId === 'ovh'
            ? { sessions: [{ id: 'cec445da', resolved_id: 'cec445da', title: 'Bot Chat' }] }
            : { sessions: [{ id: '20260823_022120_72b9ab', title: 'Bot Chat' }] }
        }
        return {}
      },
      state: {
        connectionId: { get: () => 'local', listen: () => undefined },
        profile: { get: () => 'default', listen: () => undefined }
      }
    },
    document: { createElement: () => ({}), getElementById: () => null, head: { appendChild: () => undefined } },
    window: { setTimeout: callback => callback() }
  }

  const code = source
    .replace(/^import\s+\*\s+as\s+sdk\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^const \{ McpTab, ToolsetConfigPanel \} = sdk\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(`
      globalThis.__remoteCanonical = {
        botConnectionRoute,
        elevateRemoteCanonicalBot,
        openBotCanonicalChat
      }
    `)

  vm.runInNewContext(code, context, { filename: 'plugin.js' })
  return { ...context.__remoteCanonical, calls }
}

test('remote Point Man canonical lookup routes through requestProfile on OVH and opens cec445da', async () => {
  const runtime = load()
  const owner = runtime.elevateRemoteCanonicalBot(
    {
      name: 'boss-bot',
      connectionId: 'local',
      sourceScoped: true,
      route: { connectionId: 'local', mode: 'local', profile: 'boss-bot', targetProfile: 'boss-bot' }
    },
    {
      sources: [
        { connectionId: 'local', kind: 'local' },
        { connectionId: 'ovh', kind: 'remote' }
      ],
      agents: [
        { connectionId: 'local', connectionKind: 'local', profile: 'boss-bot' },
        { connectionId: 'ovh', connectionKind: 'remote', profile: 'boss-bot', connectionLabel: 'OVH' }
      ]
    }
  )

  const opened = await runtime.openBotCanonicalChat(owner)

  assert.equal(opened.registryId, 'cec445da')
  assert.equal(opened.openedId, 'cec445da')
  assert.equal(runtime.calls.some(call => call.kind === 'ambient'), false)
  assert.equal(runtime.calls.filter(call => call.kind === 'profile').length, 1)
  assert.deepEqual(runtime.calls[0].route, {
    connectionId: 'ovh',
    mode: 'remote',
    profile: 'boss-bot',
    targetProfile: 'boss-bot'
  })
  assert.equal(runtime.calls[0].method, 'session.list')
  assert.equal(runtime.calls[0].params.title, 'Bot Chat')
  assert.equal(runtime.calls[0].params.include_hidden, true)
  assert.equal(runtime.calls[0].params.profile, 'boss-bot')
})

test('local-only boss-bot canonical lookup still uses the ambient local request path', async () => {
  const runtime = load()
  const owner = runtime.elevateRemoteCanonicalBot(
    { name: 'boss-bot' },
    { sources: [{ connectionId: 'local', kind: 'local' }], agents: [] }
  )

  const opened = await runtime.openBotCanonicalChat(owner)

  assert.equal(opened.registryId, '20260823_022120_72b9ab')
  assert.equal(runtime.calls[0].kind, 'ambient')
  assert.equal(runtime.calls[0].method, 'session.list')
})
