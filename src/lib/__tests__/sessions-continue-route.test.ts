import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const runCommand = vi.fn()
const prepare = vi.fn()
const logActivity = vi.fn()
const scanHermesSessions = vi.fn()
const getEffectiveEnvValue = vi.fn()
const loggerError = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/command', () => ({
  runCommand,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: {
    logActivity,
  },
}))

vi.mock('@/lib/hermes-sessions', () => ({
  scanHermesSessions,
}))

vi.mock('@/lib/runtime-env', () => ({
  getEffectiveEnvValue,
}))

vi.mock('@/lib/config', () => ({
  config: {
    homeDir: '/tmp/test-home',
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('POST /api/sessions/continue', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'operator', role: 'operator', workspace_id: 1 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('continues a Hermes session through the Hermes gateway and logs bound routing metadata', async () => {
    const settingsStmt = {
      get: vi.fn((key: string) => {
        if (key === 'chat.hermes_source_bindings') return { value: '{"telegram":"personal"}' }
        if (key === 'chat.hermes_runtime_profile_bindings') return { value: '{"personal":"researcher"}' }
        return undefined
      }),
    }
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT value FROM settings')) return settingsStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    scanHermesSessions.mockReturnValue([
      { sessionId: 'hermes-1', source: 'telegram' },
    ])

    getEffectiveEnvValue
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('8642')
      .mockResolvedValueOnce('secret-key')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === 'X-Hermes-Session-Id' ? 'hermes-1' : null),
      },
      json: async () => ({
        choices: [{ message: { content: 'Hermes resumed reply' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/sessions/continue/route')
    const request = new NextRequest('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'hermes',
        id: 'hermes-1',
        prompt: 'Continue this thread',
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(getEffectiveEnvValue).toHaveBeenCalledWith(
      'API_SERVER_HOST',
      expect.objectContaining({
        envFilePath: expect.stringMatching(/\/\.hermes\/profiles\/researcher\/\.env$/),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8642/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
          'X-Hermes-Session-Id': 'hermes-1',
        }),
      }),
    )
    expect(logActivity).toHaveBeenCalledWith(
      'hermes_session_continued',
      'agent',
      0,
      'operator',
      'Continued Personal Hermes session from Telegram inbox',
      expect.objectContaining({
        session_id: 'hermes-1',
        source: 'telegram',
        profile: 'personal',
        profileLabel: 'Personal Hermes profile',
        runtimeProfileName: 'researcher',
        runtimeProfileLabel: 'researcher',
      }),
      1,
    )
    expect(payload).toMatchObject({
      ok: true,
      reply: 'Hermes resumed reply',
      sessionId: 'hermes-1',
      source: 'telegram',
      profile: 'personal',
      profileLabel: 'Personal Hermes profile',
    })
  })

  it('continues Codex sessions via the existing CLI path', async () => {
    runCommand.mockResolvedValue({ stdout: 'codex reply', stderr: '', code: 0 })

    const { POST } = await import('@/app/api/sessions/continue/route')
    const request = new NextRequest('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'codex-cli',
        id: 'codex-1',
        prompt: 'Resume work',
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
  })
})
