import { describe, expect, it, vi } from 'vitest'
import {
  evaluateKnowledgeBaseGovernance,
  normalizeKnowledgeBaseGovernanceInput,
  reviewKnowledgeBaseGovernance,
  verifyKnowledgeBaseSourceUrl,
} from '@/lib/knowledge-base-governance'

describe('knowledge base governance policy', () => {
  const lookupImpl = vi.fn((_: string, options?: { all?: boolean } | number) => {
    if (typeof options === 'object' && options?.all) {
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
    }
    return Promise.resolve({ address: '93.184.216.34', family: 4 })
  }) as unknown as typeof import('node:dns/promises').lookup

  it('requires override for high-risk pages without authoritative sources', () => {
    const review = evaluateKnowledgeBaseGovernance(normalizeKnowledgeBaseGovernanceInput({
      domain: 'medicine',
      sources: [
        {
          title: 'Forum anecdote',
          sourceType: 'community',
        },
      ],
    }))

    expect(review.reviewStatus).toBe('override_required')
    expect(review.requiresUserOverride).toBe(true)
    expect(review.warnings.some((warning) => warning.code === 'missing-authoritative-source')).toBe(true)
  })

  it('approves programming pages grounded in official sources', () => {
    const review = evaluateKnowledgeBaseGovernance(normalizeKnowledgeBaseGovernanceInput({
      domain: 'programming',
      sources: [
        {
          title: 'Next.js Route Handlers',
          sourceType: 'official_docs',
          url: 'https://nextjs.org/docs/app/building-your-application/routing/route-handlers',
          publishedAt: '2026-03-01',
        },
      ],
    }))

    expect(review.requiresUserOverride).toBe(false)
    expect(review.reviewStatus).toBe('approved')
    expect(review.qualityLabel).toBe('trusted')
  })

  it('records an explicit override when the user insists on weaker material', () => {
    const review = evaluateKnowledgeBaseGovernance(normalizeKnowledgeBaseGovernanceInput({
      domain: 'security',
      sources: [
        {
          title: 'Generated recap',
          sourceType: 'generated_summary',
        },
      ],
      allowLowerQualitySources: true,
      overrideReason: 'User wants to preserve brainstorming notes pending formal vendor confirmation.',
    }))

    expect(review.requiresUserOverride).toBe(false)
    expect(review.reviewStatus).toBe('overridden')
    expect(review.overrideUsed).toBe(true)
    expect(review.overrideReason).toContain('brainstorming')
  })

  it('keeps high-risk pages in warning state when no sources are provided', async () => {
    const review = await reviewKnowledgeBaseGovernance(normalizeKnowledgeBaseGovernanceInput({
      domain: 'programming',
      sources: [],
    }))

    expect(review.reviewStatus).toBe('override_required')
    expect(review.warnings.some((warning) => warning.code === 'missing-sources')).toBe(true)
  })

  it('adds stale-source penalties when a source is outdated', async () => {
    const review = await reviewKnowledgeBaseGovernance(normalizeKnowledgeBaseGovernanceInput({
      domain: 'security',
      sources: [
        {
          title: 'Vendor bulletin',
          sourceType: 'vendor',
          publishedAt: '2020-01-01',
        },
      ],
    }))

    expect(review.warnings.some((warning) => warning.code === 'stale-source')).toBe(true)
    expect(review.qualityLabel).not.toBe('trusted')
  })

  it('treats live verification network failures as warnings rather than hard blocks', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network offline')
    }) as unknown as typeof fetch

    const review = await reviewKnowledgeBaseGovernance(normalizeKnowledgeBaseGovernanceInput({
      domain: 'programming',
      sources: [
        {
          title: 'React docs',
          sourceType: 'official_docs',
          url: 'https://react.dev/reference/react/useEffect',
          publishedAt: '2026-03-10',
        },
      ],
    }), {
      fetchImpl,
      lookupImpl,
    })

    expect(review.reviewStatus).toBe('approved_with_warnings')
    expect(review.warnings.some((warning) => warning.code === 'verification-fetch-failed')).toBe(true)
  })

  it('blocks unsafe localhost URLs during live verification', async () => {
    const verification = await verifyKnowledgeBaseSourceUrl({
      title: 'Local draft',
      sourceType: 'official_docs',
      url: 'http://127.0.0.1:8000/internal',
    }, 'security', {
      lookupImpl,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })

    expect(verification.verificationState).toBe('blocked')
    expect(verification.failureCode).toBe('unsafe-private-ip')
  })

  it('requires HTTPS for high-risk live verification unless allowlisted', async () => {
    const verification = await verifyKnowledgeBaseSourceUrl({
      title: 'Plain HTTP bulletin',
      sourceType: 'vendor',
      url: 'http://example.com/advisory',
    }, 'medicine', {
      lookupImpl,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })

    expect(verification.verificationState).toBe('blocked')
    expect(verification.failureCode).toBe('https-required')
  })

  it('records redirect targets and authoritative host matches', async () => {
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { location: 'https://docs.python.org/3/library/asyncio.html' },
    })
    const finalResponse = new Response('ok', {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'last-modified': 'Wed, 01 Apr 2026 00:00:00 GMT',
      },
    })
    const fetchImpl = vi.fn(async (url: string) => url.includes('python.org') ? finalResponse : redirectResponse) as unknown as typeof fetch

    const verification = await verifyKnowledgeBaseSourceUrl({
      title: 'Asyncio docs',
      sourceType: 'official_docs',
      url: 'https://example.com/python-redirect',
    }, 'programming', {
      lookupImpl,
      fetchImpl,
    })

    expect(verification.verificationState).toBe('verified')
    expect(verification.redirectTarget).toContain('docs.python.org')
    expect(verification.authoritativeHostMatch).toBe(true)
    expect(verification.lastModified).toContain('Wed, 01 Apr 2026')
  })
})
