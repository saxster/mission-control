import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()

const knowledgeBaseContentRouteState = vi.hoisted(() => ({
  hermesHome: '',
  homeDir: '',
}))

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
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

vi.mock('@/lib/hermes-bootstrap', () => ({
  getHermesCommandContext: vi.fn(() => ({
    hermesHome: knowledgeBaseContentRouteState.hermesHome,
    homeDir: knowledgeBaseContentRouteState.homeDir,
    binCandidates: ['hermes'],
    pathPrefix: '',
  })),
}))

describe('knowledge base content route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'operator', role: 'operator', workspace_id: 1 },
    })
  })

  it('blocks write attempts to raw wiki pages', async () => {
    const { POST } = await import('@/app/api/knowledge-base/content/route')
    const request = new NextRequest('http://localhost/api/knowledge-base/content', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        path: 'raw/test.md',
        content: '# blocked',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('Path not allowed')
  })
})
