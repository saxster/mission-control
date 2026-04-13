import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const getKnowledgeBaseContext = vi.fn()
const getKnowledgeBaseTree = vi.fn()
const readKnowledgeBaseContent = vi.fn()
const searchKnowledgeBase = vi.fn()
const isKnowledgeBaseWikiPathAllowed = vi.fn()
const validateSchema = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('@/lib/knowledge-base', () => ({
  getKnowledgeBaseContext,
  getKnowledgeBaseTree,
  readKnowledgeBaseContent,
  searchKnowledgeBase,
  isKnowledgeBaseWikiPathAllowed,
}))

vi.mock('@/lib/memory-utils', () => ({
  validateSchema,
}))

describe('legacy docs knowledge compatibility routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'viewer', role: 'viewer', workspace_id: 1 },
    })
    getKnowledgeBaseContext.mockReturnValue({
      wikiRoots: ['entities', 'concepts'],
      wikiExists: true,
      firstRunReason: null,
      runtimeProfile: { name: 'default' },
    })
    validateSchema.mockReturnValue({ errors: [] })
  })

  it('serves the docs tree route from the knowledge base backend', async () => {
    getKnowledgeBaseTree.mockResolvedValue([{ path: 'entities', name: 'entities', type: 'directory', children: [] }])
    const { GET } = await import('@/app/api/docs/tree/route')

    const response = await GET(new NextRequest('http://localhost/api/docs/tree'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.legacy).toBe(true)
    expect(payload.runtimeProfileName).toBe('default')
    expect(payload.tree).toHaveLength(1)
  })

  it('serves docs content from knowledge base wiki content', async () => {
    isKnowledgeBaseWikiPathAllowed.mockReturnValue(true)
    readKnowledgeBaseContent.mockResolvedValue({
      path: 'entities/example.md',
      content: '# Example',
      size: 9,
      modified: 123,
      wikiLinks: [],
      pageType: 'entities',
      readOnly: false,
    })
    const { GET } = await import('@/app/api/docs/content/route')

    const response = await GET(new NextRequest('http://localhost/api/docs/content?path=entities%2Fexample.md'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.legacy).toBe(true)
    expect(payload.scope).toBe('wiki')
    expect(payload.path).toBe('entities/example.md')
  })

  it('serves docs search from knowledge base search', async () => {
    searchKnowledgeBase.mockResolvedValue([{ path: 'queries/example.md', name: 'example.md', matches: 2, pageType: 'queries', snippet: 'example' }])
    const { GET } = await import('@/app/api/docs/search/route')

    const response = await GET(new NextRequest('http://localhost/api/docs/search?q=example'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.legacy).toBe(true)
    expect(payload.count).toBe(1)
    expect(payload.results[0]?.path).toBe('queries/example.md')
  })
})
