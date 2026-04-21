import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const prepare = vi.fn()
const runCommand = vi.fn()
const getHermesCommandContext = vi.fn()
const resolveHermesBinary = vi.fn()
const discoverHermesRuntimeProfiles = vi.fn()
const resolveHermesRuntimeProfileByName = vi.fn()
const hasHermesCliBinary = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
}))

vi.mock('@/lib/command', () => ({
  runCommand,
}))

vi.mock('@/lib/hermes-bootstrap', () => ({
  getHermesCommandContext,
  loadHermesBootstrapData: vi.fn(),
  resolveHermesBinary,
}))

vi.mock('@/lib/hermes-routing', () => ({
  HERMES_ROUTING_BINDINGS_SETTING_KEY: 'chat.hermes_source_bindings',
  buildHermesRoutingSummary: vi.fn(),
  parseHermesRoutingBindings: vi.fn(() => ({})),
  resolveHermesProfileLabel: vi.fn((value: string) => {
    if (value === 'work') return 'Work Hermes profile'
    if (value === 'personal') return 'Personal Hermes profile'
    if (value === 'automation') return 'Automation Hermes profile'
    if (value === 'research') return 'Research Hermes profile'
    return 'Primary Hermes profile'
  }),
}))

vi.mock('@/lib/hermes-runtime-profiles', () => ({
  HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY: 'chat.hermes_runtime_profile_bindings',
  buildHermesRuntimeBindingTargets: vi.fn(() => []),
  discoverHermesRuntimeProfiles,
  isHermesRuntimeSplitActive: vi.fn(() => false),
  listHermesRuntimeProfilesForPersonas: vi.fn(() => []),
  parseHermesRuntimeProfileBindings: vi.fn((raw?: string) => {
    try {
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }),
  resolveHermesRuntimeProfileByName,
  resolveHermesRuntimeBindingForSource: vi.fn(),
}))

vi.mock('@/lib/hermes-sessions', () => ({
  hasHermesCliBinary,
  isHermesInstalled: vi.fn(() => true),
  isHermesGatewayRunning: vi.fn(() => false),
  scanHermesSessions: vi.fn(() => []),
}))

vi.mock('@/lib/hermes-tasks', () => ({
  getHermesTasks: vi.fn(() => ({
    cronJobs: [],
    summary: { total: 0, enabled: 0, paused: 0, failing: 0, healthy: 0, scheduled: 0 },
  })),
}))

vi.mock('@/lib/hermes-memory', () => ({
  getHermesMemory: vi.fn(() => ({ agentMemoryEntries: 0 })),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

type RuntimeProfile = {
  name: string
  label: string
  description: string
  hermesHome: string
  exists: boolean
}

function profile(name: string, exists = true): RuntimeProfile {
  const isDefault = name === 'default'
  return {
    name,
    label: name,
    description: isDefault ? 'Default Hermes home' : `Named Hermes profile (${name})`,
    hermesHome: isDefault ? '/tmp/test-home/.hermes' : `/tmp/test-home/.hermes/profiles/${name}`,
    exists,
  }
}

describe('POST /api/hermes runtime profile actions', () => {
  let runtimeProfiles: RuntimeProfile[]

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    runtimeProfiles = [profile('default'), profile('researcher')]

    requireRole.mockReturnValue({
      user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 },
    })
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT value FROM settings')) {
        return {
          get: vi.fn((key: string) => {
            if (key === 'chat.hermes_runtime_profile_bindings') return undefined
            if (key === 'chat.hermes_source_bindings') return undefined
            return undefined
          }),
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    getHermesCommandContext.mockReturnValue({
      homeDir: '/tmp/test-home',
      hermesHome: '/tmp/test-home/.hermes',
      pathPrefix: '/tmp/test-home/bin',
    })
    resolveHermesBinary.mockReturnValue('/tmp/test-home/bin/hermes')
    discoverHermesRuntimeProfiles.mockImplementation(() => runtimeProfiles.map((entry) => ({ ...entry })))
    resolveHermesRuntimeProfileByName.mockImplementation((name: string | null | undefined, profiles?: RuntimeProfile[]) => {
      const pool = Array.isArray(profiles) && profiles.length > 0 ? profiles : runtimeProfiles
      const normalized = String(name || 'default').trim().toLowerCase() || 'default'
      return pool.find((entry) => entry.name === normalized) || profile(normalized, false)
    })
    hasHermesCliBinary.mockReturnValue(true)
  })

  it('creates a blank Hermes runtime profile through the Hermes CLI', async () => {
    runCommand.mockImplementation(async () => {
      runtimeProfiles = [profile('default'), profile('researcher'), profile('ops')]
      return { code: 0, stdout: 'created ops', stderr: '' }
    })

    const { POST } = await import('@/app/api/hermes/route')
    const request = new NextRequest('http://localhost/api/hermes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create-profile',
        profileName: 'ops',
        cloneMode: 'blank',
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/test-home/bin/hermes',
      ['profile', 'create', 'ops', '--no-alias'],
      expect.objectContaining({
        timeoutMs: 30_000,
        env: expect.objectContaining({
          HOME: '/tmp/test-home',
          HERMES_HOME: '/tmp/test-home/.hermes',
          HERMES_NONINTERACTIVE: '1',
        }),
      }),
    )
    expect(payload).toMatchObject({
      success: true,
      profileName: 'ops',
      selectedRuntimeProfile: {
        name: 'ops',
        hermesHome: '/tmp/test-home/.hermes/profiles/ops',
        exists: true,
      },
    })
    expect(payload.runtimeProfiles.map((entry: RuntimeProfile) => entry.name)).toEqual(['default', 'researcher', 'ops'])
  })

  it('creates a cloned Hermes runtime profile from the selected source profile', async () => {
    runCommand.mockImplementation(async () => {
      runtimeProfiles = [profile('default'), profile('researcher'), profile('ops')]
      return { code: 0, stdout: 'cloned ops', stderr: '' }
    })

    const { POST } = await import('@/app/api/hermes/route')
    const request = new NextRequest('http://localhost/api/hermes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create-profile',
        profileName: 'ops',
        cloneMode: 'clone',
        cloneFromProfileName: 'researcher',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/test-home/bin/hermes',
      ['profile', 'create', 'ops', '--no-alias', '--clone', '--clone-from', 'researcher'],
      expect.any(Object),
    )
  })

  it('rejects deleting a Hermes runtime profile that is still bound to a persona', async () => {
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT value FROM settings')) {
        return {
          get: vi.fn((key: string) => {
            if (key === 'chat.hermes_runtime_profile_bindings') return { value: '{"work":"researcher"}' }
            return undefined
          }),
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { POST } = await import('@/app/api/hermes/route')
    const request = new NextRequest('http://localhost/api/hermes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'delete-profile',
        profileName: 'researcher',
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(runCommand).not.toHaveBeenCalled()
    expect(payload.error).toContain('Work Hermes profile')
  })

  it('deletes an unbound Hermes runtime profile through the Hermes CLI', async () => {
    runtimeProfiles = [profile('default'), profile('researcher'), profile('ops')]
    runCommand.mockImplementation(async () => {
      runtimeProfiles = [profile('default'), profile('researcher')]
      return { code: 0, stdout: 'deleted ops', stderr: '' }
    })

    const { POST } = await import('@/app/api/hermes/route')
    const request = new NextRequest('http://localhost/api/hermes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'delete-profile',
        profileName: 'ops',
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith(
      '/tmp/test-home/bin/hermes',
      ['profile', 'delete', 'ops', '--yes'],
      expect.any(Object),
    )
    expect(payload).toMatchObject({
      success: true,
      profileName: 'ops',
      selectedRuntimeProfile: {
        name: 'default',
        exists: true,
      },
    })
    expect(payload.runtimeProfiles.map((entry: RuntimeProfile) => entry.name)).toEqual(['default', 'researcher'])
  })
})
