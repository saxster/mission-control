import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const getAllGatewaySessions = vi.fn()
const readIndexedLocalSessions = vi.fn()
const getLocalSessionIndexMeta = vi.fn()
const queueLocalSessionIndexSync = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/sessions', () => ({
  getAllGatewaySessions,
}))

vi.mock('@/lib/local-session-index', () => ({
  readIndexedLocalSessions,
  getLocalSessionIndexMeta,
  queueLocalSessionIndexSync,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
  db_helpers: {
    logActivity: vi.fn(),
  },
}))

vi.mock('@/lib/openclaw-gateway', () => ({
  callOpenClawGateway: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('GET /api/sessions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'viewer', role: 'viewer', workspace_id: 1 },
    })
    getAllGatewaySessions.mockReturnValue([])
    readIndexedLocalSessions.mockReturnValue([
      {
        entry_key: 'codex:session-1',
        source_type: 'codex',
        session_id: 'session-1',
        project_slug: 'proj',
        project_path: '/tmp/proj',
        model: 'codex',
        git_branch: null,
        user_messages: 1,
        assistant_messages: 1,
        tool_uses: 0,
        input_tokens: 120,
        output_tokens: 80,
        total_tokens: 200,
        estimated_cost: 0,
        first_message_at: '2026-04-10T10:00:00.000Z',
        last_message_at: '2026-04-10T10:05:00.000Z',
        last_user_prompt: null,
        session_source: null,
        title: 'proj',
        profile: null,
        profile_label: null,
        runtime_profile_name: null,
        runtime_profile_label: null,
        is_active: 1,
        last_indexed_at: 1_744_280_000,
        is_stale: 0,
      },
    ])
    getLocalSessionIndexMeta.mockReturnValue({
      indexedAt: 1_744_280_000,
      stale: true,
      sources: {
        claude: { indexedAt: 1_744_280_000, status: 'ok', error: null },
        codex: { indexedAt: 1_744_280_000, status: 'ok', error: null },
        hermes: { indexedAt: 1_744_280_000, status: 'ok', error: null },
      },
    })
  })

  it('serves indexed sessions and queues a background refresh when stale', async () => {
    const { GET } = await import('@/app/api/sessions/route')
    const response = await GET(new NextRequest('http://localhost/api/sessions'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(readIndexedLocalSessions).toHaveBeenCalled()
    expect(queueLocalSessionIndexSync).toHaveBeenCalled()
    expect(payload.meta).toMatchObject({
      indexedAt: 1_744_280_000,
      stale: true,
      sources: {
        claude: { indexedAt: 1_744_280_000, status: 'ok', error: null },
        codex: { indexedAt: 1_744_280_000, status: 'ok', error: null },
        hermes: { indexedAt: 1_744_280_000, status: 'ok', error: null },
      },
    })
    expect(payload.sessions[0]).toMatchObject({
      id: 'session-1',
      kind: 'codex-cli',
      key: 'proj',
    })
  })
})
