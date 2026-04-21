import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireRole = vi.fn()
const readLimiter = vi.fn()
const getKnowledgeBaseContext = vi.fn()
const searchKnowledgeBase = vi.fn()
const loggerWarn = vi.fn()
const loggerError = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter,
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: loggerWarn,
    error: loggerError,
  },
}))

vi.mock('@/lib/knowledge-base', () => ({
  getKnowledgeBaseContext,
  searchKnowledgeBase,
}))

describe('legacy memory route hardening', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'viewer', role: 'viewer', workspace_id: 1 },
    })
    readLimiter.mockReturnValue(null)
    getKnowledgeBaseContext.mockReturnValue({
      wikiExists: true,
      firstRunReason: null,
      runtimeProfile: { name: 'default' },
    })
    searchKnowledgeBase.mockResolvedValue([{ path: 'queries/example.md', name: 'example.md', matches: 1 }])
  })

  it('adds deprecation headers and telemetry to successful responses', async () => {
    const { GET } = await import('@/app/api/memory/search/route')
    const { LEGACY_MEMORY_API_SUNSET } = await import('@/lib/legacy-memory-route')

    const response = await GET(new NextRequest('http://localhost/api/memory/search?q=example'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.legacy).toBe(true)
    expect(response.headers.get('Deprecation')).toBe('true')
    expect(response.headers.get('Sunset')).toBe(LEGACY_MEMORY_API_SUNSET)
    expect(response.headers.get('Link')).toBe('</api/knowledge-base/search>; rel="successor-version"')
    expect(response.headers.get('X-Hermes-Legacy-Route')).toBe('memory')
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        route: '/api/memory/search',
        method: 'GET',
        canonicalPath: '/api/knowledge-base/search',
        action: 'search',
        username: 'viewer',
      }),
      'Deprecated /api/memory route hit',
    )
  })

  it('keeps deprecation headers on auth failures', async () => {
    requireRole.mockReturnValueOnce({ error: 'Unauthorized', status: 401 })
    const { GET } = await import('@/app/api/memory/search/route')

    const response = await GET(new NextRequest('http://localhost/api/memory/search?q=example'))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.deprecated).toBe(true)
    expect(response.headers.get('Deprecation')).toBe('true')
    expect(response.headers.get('Link')).toBe('</api/knowledge-base/search>; rel="successor-version"')
  })

  it('decorates rate-limited responses too', async () => {
    readLimiter.mockReturnValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }))
    const { GET } = await import('@/app/api/memory/search/route')

    const response = await GET(new NextRequest('http://localhost/api/memory/search?q=example'))
    const payload = await response.json()

    expect(response.status).toBe(429)
    expect(payload.error).toBe('Too many requests')
    expect(response.headers.get('Deprecation')).toBe('true')
    expect(response.headers.get('X-Hermes-Legacy-Route')).toBe('memory')
  })
})
