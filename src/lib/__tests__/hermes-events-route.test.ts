import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const prepare = vi.fn()
const logActivity = vi.fn()
const updateAgentStatus = vi.fn()
const broadcast = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: {
    logActivity,
    updateAgentStatus,
  },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast,
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('POST /api/hermes/events', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'api', role: 'admin', workspace_id: 1 },
    })
  })

  it('creates Hermes presence and logs a bound inbound session', async () => {
    const settingsStmt = {
      get: vi.fn((key: string) => {
        if (key === 'chat.hermes_source_bindings') return { value: '{"telegram":"personal"}' }
        if (key === 'chat.hermes_runtime_profile_bindings') return { value: '{"personal":"researcher"}' }
        return undefined
      }),
    }
    const agentSelectStmt = { get: vi.fn(() => undefined) }
    const insertStmt = { run: vi.fn(() => ({ lastInsertRowid: 42 })) }

    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT value FROM settings')) return settingsStmt
      if (sql.startsWith('SELECT id, status, last_activity FROM agents')) return agentSelectStmt
      if (sql.includes('INSERT INTO agents')) return insertStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { POST } = await import('@/app/api/hermes/events/route')
    const request = new NextRequest('http://localhost/api/hermes/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'session:start',
        session_id: 'sess-telegram-1',
        source: 'telegram',
        timestamp: '2026-04-07T12:00:00.000Z',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(broadcast).toHaveBeenCalledWith(
      'agent.created',
      expect.objectContaining({
        id: 42,
        name: 'hermes',
        role: 'Hermes Agent',
        status: 'busy',
      }),
    )
    expect(updateAgentStatus).not.toHaveBeenCalled()
    expect(logActivity).toHaveBeenCalledWith(
      'agent_created',
      'agent',
      42,
      'hermes',
      'Registered Hermes agent from live hook telemetry',
      { source: 'hermes-hook' },
      1,
    )
    expect(logActivity).toHaveBeenCalledWith(
      'hermes_session_started',
      'agent',
      42,
      'hermes',
      'Started Personal session from Telegram inbox',
      expect.objectContaining({
        session_id: 'sess-telegram-1',
        source: 'telegram',
        profile: 'personal',
        profileLabel: 'Personal Hermes profile',
        runtimeProfileName: 'researcher',
        runtimeProfileLabel: 'researcher',
      }),
      1,
    )
    expect(body).toMatchObject({
      received: true,
      sessionId: 'sess-telegram-1',
      source: 'telegram',
      profile: 'personal',
      profileLabel: 'Personal Hermes profile',
      runtimeProfileName: 'researcher',
      runtimeProfileLabel: 'researcher',
    })
  })

  it('updates existing Hermes presence when a new bound source becomes active', async () => {
    const settingsStmt = {
      get: vi.fn((key: string) => {
        if (key === 'chat.hermes_source_bindings') return { value: '{"gateway":"work"}' }
        if (key === 'chat.hermes_runtime_profile_bindings') return { value: '{"work":"ops"}' }
        return undefined
      }),
    }
    const agentSelectStmt = { get: vi.fn(() => ({ id: 7, status: 'idle', last_activity: 'Waiting' })) }

    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT value FROM settings')) return settingsStmt
      if (sql.startsWith('SELECT id, status, last_activity FROM agents')) return agentSelectStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { POST } = await import('@/app/api/hermes/events/route')
    const request = new NextRequest('http://localhost/api/hermes/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'session:start',
        session_id: 'sess-gateway-1',
        source: 'gateway',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(updateAgentStatus).toHaveBeenCalledWith(
      'hermes',
      'busy',
      'Started Work session from Gateway API',
      1,
    )
    expect(logActivity).toHaveBeenCalledWith(
      'hermes_session_started',
      'agent',
      7,
      'hermes',
      'Started Work session from Gateway API',
      expect.objectContaining({
        session_id: 'sess-gateway-1',
        source: 'gateway',
        profile: 'work',
        profileLabel: 'Work Hermes profile',
        runtimeProfileName: 'ops',
        runtimeProfileLabel: 'ops',
      }),
      1,
    )
    expect(body.profile).toBe('work')
    expect(body.runtimeProfileName).toBe('ops')
  })

  it('rejects unsupported or malformed events', async () => {
    prepare.mockImplementation(() => ({ get: vi.fn(() => undefined) }))

    const { POST } = await import('@/app/api/hermes/events/route')
    const request = new NextRequest('http://localhost/api/hermes/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'agent:start',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('Unsupported Hermes event')
  })
})
