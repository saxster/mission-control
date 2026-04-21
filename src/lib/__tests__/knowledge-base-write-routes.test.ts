import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const performGovernedKnowledgeBaseWrite = vi.fn()
const getKnowledgeBaseContext = vi.fn()
const isKnowledgeBaseWikiPathAllowed = vi.fn(() => true)
const isKnowledgeBaseWikiPathWritable = vi.fn(() => true)
const isKnowledgeBaseStructuredPathAllowed = vi.fn(() => true)
const readKnowledgeBaseContent = vi.fn()
const resolveKnowledgeBaseContentPath = vi.fn()
const getEffectiveKnowledgeBaseGovernanceRecord = vi.fn()

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
  },
}))

vi.mock('@/lib/knowledge-base', () => ({
  getKnowledgeBaseContext,
  getKnowledgeBaseTree: vi.fn(),
  isKnowledgeBaseWikiPathAllowed,
  isKnowledgeBaseWikiPathWritable,
  isKnowledgeBaseStructuredPathAllowed,
  readKnowledgeBaseContent,
  resolveKnowledgeBaseContentPath,
  searchKnowledgeBase: vi.fn(),
}))

vi.mock('@/lib/knowledge-base-governance', () => ({
  getEffectiveKnowledgeBaseGovernanceRecord,
}))

vi.mock('@/lib/knowledge-base-content-write', () => ({
  performGovernedKnowledgeBaseWrite,
}))

vi.mock('@/lib/db', () => ({
  db_helpers: {
    logActivity: vi.fn(),
  },
}))

vi.mock('@/lib/memory-utils', () => ({
  validateSchema: vi.fn(() => ({ valid: true, errors: [] })),
}))

describe('governed knowledge base write routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'operator', role: 'operator', workspace_id: 1 },
    })
    getKnowledgeBaseContext.mockReturnValue({
      wikiExists: true,
      firstRunReason: null,
      runtimeProfile: { name: 'default' },
      wikiRoots: ['entities', 'queries'],
      writableWikiRoots: ['entities', 'queries'],
    })
  })

  it('returns governance details for canonical write blocks', async () => {
    performGovernedKnowledgeBaseWrite.mockResolvedValue({
      status: 422,
      context: getKnowledgeBaseContext(),
      governance: {
        reviewStatus: 'override_required',
      },
      body: {
        error: 'Source quality review requires acknowledgement before this page can be written.',
        governance: {
          reviewStatus: 'override_required',
          warnings: [{ code: 'missing-authoritative-source', severity: 'critical', message: 'Missing authoritative source' }],
        },
      },
    })

    const { POST } = await import('@/app/api/knowledge-base/content/route')
    const response = await POST(new NextRequest('http://localhost/api/knowledge-base/content', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        path: 'queries/example.md',
        content: '# Example',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(422)
    expect(payload.governance.reviewStatus).toBe('override_required')
  })

  it('forwards the loaded Obsidian content hash for conflict-aware saves', async () => {
    performGovernedKnowledgeBaseWrite.mockResolvedValue({
      status: 200,
      context: getKnowledgeBaseContext(),
      governance: { reviewStatus: 'approved' },
      body: {
        success: true,
        message: 'File saved successfully',
        schemaWarnings: [],
        governance: { reviewStatus: 'approved', warnings: [] },
      },
    })

    const { POST } = await import('@/app/api/knowledge-base/content/route')
    const response = await POST(new NextRequest('http://localhost/api/knowledge-base/content', {
      method: 'POST',
      body: JSON.stringify({
        action: 'save',
        path: 'entities/example.md',
        content: '# Example',
        obsidianBaseHash: 'abc123',
      }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(response.status).toBe(200)
    expect(performGovernedKnowledgeBaseWrite).toHaveBeenCalledWith(expect.objectContaining({
      path: 'entities/example.md',
      expectedObsidianContentHash: 'abc123',
    }))
  })

  it('keeps legacy memory writes on the same governed response shape', async () => {
    performGovernedKnowledgeBaseWrite.mockResolvedValue({
      status: 200,
      context: getKnowledgeBaseContext(),
      governance: {
        reviewStatus: 'approved_with_warnings',
      },
      body: {
        success: true,
        message: 'File saved successfully',
        schemaWarnings: ['Missing required field: source'],
        governance: {
          reviewStatus: 'approved_with_warnings',
          warnings: [{ code: 'missing-date', severity: 'warning', message: 'Missing date' }],
        },
      },
    })

    const { POST } = await import('@/app/api/memory/route')
    const response = await POST(new NextRequest('http://localhost/api/memory', {
      method: 'POST',
      body: JSON.stringify({
        action: 'save',
        path: 'queries/example.md',
        content: '# Example',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.legacy).toBe(true)
    expect(payload.governance.reviewStatus).toBe('approved_with_warnings')
    expect(payload.schemaWarnings).toEqual(['Missing required field: source'])
  })
})
