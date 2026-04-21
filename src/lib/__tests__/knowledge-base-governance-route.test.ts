import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const getKnowledgeBaseContext = vi.fn()
const listKnowledgeBaseGovernanceQueue = vi.fn()
const backfillKnowledgeBaseGovernanceRecords = vi.fn()

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
}))

vi.mock('@/lib/knowledge-base-governance', () => ({
  listKnowledgeBaseGovernanceQueue,
  backfillKnowledgeBaseGovernanceRecords,
}))

describe('knowledge base governance route', () => {
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
    })
  })

  it('lists governance queue items', async () => {
    listKnowledgeBaseGovernanceQueue.mockResolvedValue({
      items: [
        {
          path: 'queries/example.md',
          pageType: 'queries',
          current: false,
          record: {
            id: 0,
            runtimeProfileName: 'default',
            path: 'queries/example.md',
            contentHash: null,
            actor: 'system',
            createdAt: 0,
            domain: 'general',
            riskLevel: 'low',
            qualityScore: 0,
            qualityLabel: 'low-confidence',
            reviewStatus: 'unreviewed',
            sourceCount: 0,
            warnings: [{ code: 'unreviewed', severity: 'warning', message: 'Needs review' }],
            recommendedSourceTypes: ['official_docs'],
            hasAuthoritativeSource: false,
            hasLowQualitySources: true,
            requiresUserOverride: false,
            overrideUsed: false,
            overrideReason: null,
            sources: [],
            sourceAssessments: [],
            verificationResults: [],
            ingestionMethod: 'system_derived',
          },
        },
      ],
      totalPages: 1,
      stats: {
        unreviewed: 1,
        overridden: 0,
        highRisk: 0,
        warnings: 1,
        backfillEligible: 1,
      },
    })

    const { GET } = await import('@/app/api/knowledge-base/governance/route')
    const response = await GET(new NextRequest('http://localhost/api/knowledge-base/governance?unreviewedOnly=true'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.totalPages).toBe(1)
    expect(payload.items[0]?.record.reviewStatus).toBe('unreviewed')
    expect(payload.stats.backfillEligible).toBe(1)
  })

  it('runs governance backfill on demand', async () => {
    backfillKnowledgeBaseGovernanceRecords.mockResolvedValue({ created: 4, totalPages: 12 })

    const { POST } = await import('@/app/api/knowledge-base/governance/route')
    const response = await POST(new NextRequest('http://localhost/api/knowledge-base/governance', {
      method: 'POST',
      body: JSON.stringify({ action: 'backfill' }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.action).toBe('backfill')
    expect(payload.created).toBe(4)
    expect(payload.totalPages).toBe(12)
  })
})
