import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Knowledge Base API', () => {
  test('tree/search/content flows for markdown wiki pages', async ({ request }) => {
    const stamp = Date.now()
    const path = `queries/e2e-kb-${stamp}.md`
    const content = `# E2E Knowledge ${stamp}\n\nDeployment runbook token: kb-search-${stamp}`

    const create = await request.post('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path,
        content,
      },
    })
    expect(create.status()).toBe(200)

    const tree = await request.get('/api/knowledge-base/tree', { headers: API_KEY_HEADER })
    expect(tree.status()).toBe(200)
    const treeBody = await tree.json()
    expect(Array.isArray(treeBody.tree)).toBe(true)

    const search = await request.get(`/api/knowledge-base/search?q=${encodeURIComponent(`kb-search-${stamp}`)}`, {
      headers: API_KEY_HEADER,
    })
    expect(search.status()).toBe(200)
    const searchBody = await search.json()
    const found = searchBody.results.find((r: any) => r.path === path)
    expect(found).toBeTruthy()

    const doc = await request.get(`/api/knowledge-base/content?path=${encodeURIComponent(path)}`, {
      headers: API_KEY_HEADER,
    })
    expect(doc.status()).toBe(200)
    const docBody = await doc.json()
    expect(docBody.path).toBe(path)
    expect(docBody.content).toContain(`kb-search-${stamp}`)

    const cleanup = await request.delete('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'delete',
        path,
      },
    })
    expect(cleanup.status()).toBe(200)
  })

  test('knowledge base APIs require auth', async ({ request }) => {
    const tree = await request.get('/api/knowledge-base/tree')
    expect(tree.status()).toBe(401)

    const search = await request.get('/api/knowledge-base/search?q=deployment')
    expect(search.status()).toBe(401)

    const content = await request.get('/api/knowledge-base/content?path=queries/example.md')
    expect(content.status()).toBe(401)
  })

  test('high-risk knowledge requires explicit override for weak sources', async ({ request }) => {
    const stamp = Date.now()
    const path = `queries/e2e-kb-override-${stamp}.md`
    const content = `# Weak Source Note ${stamp}\n\nCapturing tentative treatment guidance pending authoritative validation.`

    const blocked = await request.post('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path,
        content,
        governance: {
          domain: 'medicine',
          sources: [
            {
              title: 'Unverified community thread',
              sourceType: 'community',
            },
          ],
        },
      },
    })

    expect(blocked.status()).toBe(422)
    const blockedBody = await blocked.json()
    expect(blockedBody.governance.reviewStatus).toBe('override_required')
    expect(blockedBody.governance.requiresUserOverride).toBe(true)

    const allowed = await request.post('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path,
        content,
        governance: {
          domain: 'medicine',
          sources: [
            {
              title: 'Unverified community thread',
              sourceType: 'community',
            },
          ],
          allowLowerQualitySources: true,
          overrideReason: 'User explicitly wants to preserve the low-confidence lead while better medical sourcing is gathered.',
        },
      },
    })

    expect(allowed.status()).toBe(200)
    const allowedBody = await allowed.json()
    expect(allowedBody.governance.reviewStatus).toBe('overridden')
    expect(allowedBody.governance.overrideUsed).toBe(true)

    const doc = await request.get(`/api/knowledge-base/content?path=${encodeURIComponent(path)}`, {
      headers: API_KEY_HEADER,
    })
    expect(doc.status()).toBe(200)
    const docBody = await doc.json()
    expect(docBody.governance.reviewStatus).toBe('overridden')
    expect(docBody.governance.overrideReason).toContain('low-confidence lead')

    const cleanup = await request.delete('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'delete',
        path,
      },
    })
    expect(cleanup.status()).toBe(200)
  })

  test('governance queue surfaces overridden pages and search de-prioritizes them', async ({ request }) => {
    const stamp = Date.now()
    const approvedPath = `queries/e2e-kb-approved-${stamp}.md`
    const overriddenPath = `queries/e2e-kb-overridden-${stamp}.md`
    const sharedToken = `kb-governance-rank-${stamp}`

    const approved = await request.post('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path: approvedPath,
        content: `# Approved Source ${stamp}\n\n${sharedToken}\n\nUse the official API reference.`,
        governance: {
          domain: 'programming',
          sources: [
            {
              title: 'TypeScript handbook',
              sourceType: 'official_docs',
              publishedAt: '2026-03-01',
            },
          ],
        },
      },
    })
    expect(approved.status()).toBe(200)

    const overridden = await request.post('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path: overriddenPath,
        content: `# Overridden Source ${stamp}\n\n${sharedToken}\n\nTentative workaround from a community post.`,
        governance: {
          domain: 'programming',
          sources: [
            {
              title: 'Community workaround',
              sourceType: 'community',
              publishedAt: '2026-03-01',
            },
          ],
          allowLowerQualitySources: true,
          overrideReason: 'User wants to preserve a low-confidence workaround while we verify it against official docs.',
        },
      },
    })
    expect(overridden.status()).toBe(200)

    const queue = await request.get('/api/knowledge-base/governance', {
      headers: API_KEY_HEADER,
    })
    expect(queue.status()).toBe(200)
    const queueBody = await queue.json()
    const overriddenItem = queueBody.items.find((item: any) => item.path === overriddenPath)
    expect(overriddenItem).toBeTruthy()
    expect(overriddenItem.record.reviewStatus).toBe('overridden')

    const search = await request.get(`/api/knowledge-base/search?q=${encodeURIComponent(sharedToken)}`, {
      headers: API_KEY_HEADER,
    })
    expect(search.status()).toBe(200)
    const searchBody = await search.json()
    const approvedIndex = searchBody.results.findIndex((result: any) => result.path === approvedPath)
    const overriddenIndex = searchBody.results.findIndex((result: any) => result.path === overriddenPath)
    expect(approvedIndex).toBeGreaterThanOrEqual(0)
    expect(overriddenIndex).toBeGreaterThanOrEqual(0)
    expect(approvedIndex).toBeLessThan(overriddenIndex)
    expect(searchBody.results[approvedIndex].governance.reviewStatus).toBe('approved')
    expect(searchBody.results[overriddenIndex].governance.reviewStatus).toBe('overridden')

    await request.delete('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'delete',
        path: approvedPath,
      },
    })
    await request.delete('/api/knowledge-base/content', {
      headers: API_KEY_HEADER,
      data: {
        action: 'delete',
        path: overriddenPath,
      },
    })
  })
})
