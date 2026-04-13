import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

const stamp = Date.now()
const testFile = `queries/e2e-mk-${stamp}.md`
const testFile2 = `queries/e2e-mk-linked-${stamp}.md`

test.describe('Legacy Memory API Compatibility', () => {
  test.beforeAll(async ({ request }) => {
    const file1 = await request.post('/api/memory', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path: testFile,
        content: [
          '---',
          '_schema:',
          '  type: note',
          '  required: [title, tags]',
          'title: E2E Test Note',
          'tags: [test, e2e]',
          '---',
          `# E2E Note ${stamp}`,
          '',
          `This links to [[e2e-mk-linked-${stamp}]] for testing.`,
          '',
          'Some searchable content: unique-token-' + stamp,
        ].join('\n'),
      },
    })
    expect(file1.status()).toBe(200)
    expect((await file1.json()).legacy).toBe(true)

    const file2 = await request.post('/api/memory', {
      headers: API_KEY_HEADER,
      data: {
        action: 'create',
        path: testFile2,
        content: [
          '---',
          'title: Linked Note',
          '---',
          '# Linked Note',
          '',
          `Back-reference to [[e2e-mk-${stamp}]].`,
        ].join('\n'),
      },
    })
    expect(file2.status()).toBe(200)
    expect((await file2.json()).legacy).toBe(true)
  })

  // Cleanup
  test.afterAll(async ({ request }) => {
    await request.delete('/api/memory', {
      headers: API_KEY_HEADER,
      data: { action: 'delete', path: testFile },
    })
    await request.delete('/api/memory', {
      headers: API_KEY_HEADER,
      data: { action: 'delete', path: testFile2 },
    })
  })

  test('GET /api/memory/links returns link graph', async ({ request }) => {
    const res = await request.get('/api/memory/links', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(body.nodes.length).toBeGreaterThan(0)
    expect(body.legacy).toBe(true)
    const node = body.nodes[0]
    expect(node).toHaveProperty('path')
    expect(node).toHaveProperty('linkCount')
  })

  test('GET /api/memory/graph returns legacy-compatible wiki graph data', async ({ request }) => {
    const res = await request.get('/api/memory/graph', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.legacy).toBe(true)
    expect(Array.isArray(body.agents)).toBe(true)
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.edges)).toBe(true)
  })

  test('GET /api/memory/links?file= returns per-file links', async ({ request }) => {
    const res = await request.get(
      `/api/memory/links?file=${encodeURIComponent(testFile)}`,
      { headers: API_KEY_HEADER }
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.file).toBe(testFile)
    expect(body.legacy).toBe(true)
    expect(Array.isArray(body.wikiLinks)).toBe(true)
    const link = body.wikiLinks.find((l: any) => l.target.includes('linked'))
    expect(link).toBeTruthy()
  })

  test('links API requires auth', async ({ request }) => {
    const res = await request.get('/api/memory/links')
    expect(res.status()).toBe(401)
  })

  test('GET /api/memory/health returns health report', async ({ request }) => {
    const res = await request.get('/api/memory/health', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(typeof body.overallScore).toBe('number')
    expect(body.overallScore).toBeGreaterThanOrEqual(0)
    expect(body.overallScore).toBeLessThanOrEqual(100)
    expect(body.legacy).toBe(true)
    expect(Array.isArray(body.categories)).toBe(true)
    expect(body.categories.length).toBeGreaterThan(0)
    for (const cat of body.categories) {
      expect(cat).toHaveProperty('name')
      expect(cat).toHaveProperty('score')
      expect(typeof cat.score).toBe('number')
    }
  })

  test('health API requires auth', async ({ request }) => {
    const res = await request.get('/api/memory/health')
    expect(res.status()).toBe(401)
  })

  test('GET /api/memory/context returns context payload', async ({ request }) => {
    const res = await request.get('/api/memory/context', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('fileTree')
    expect(body).toHaveProperty('recentFiles')
    expect(body).toHaveProperty('healthSummary')
    expect(body).toHaveProperty('maintenanceSignals')
    expect(Array.isArray(body.fileTree)).toBe(true)
    expect(Array.isArray(body.recentFiles)).toBe(true)
    expect(Array.isArray(body.maintenanceSignals)).toBe(true)
    expect(typeof body.healthSummary).toBe('object')
    expect(body.legacy).toBe(true)
  })

  test('GET /api/memory?action=tree returns legacy tree metadata', async ({ request }) => {
    const res = await request.get('/api/memory?action=tree', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tree)).toBe(true)
    expect(Array.isArray(body.roots)).toBe(true)
    expect(body.legacy).toBe(true)
  })

  test('GET /api/memory/search returns legacy search metadata', async ({ request }) => {
    const res = await request.get(`/api/memory/search?q=${encodeURIComponent(`unique-token-${stamp}`)}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.some((result: any) => result.path === testFile)).toBe(true)
    expect(body.legacy).toBe(true)
  })

  test('context API requires auth', async ({ request }) => {
    const res = await request.get('/api/memory/context')
    expect(res.status()).toBe(401)
  })

  test('POST /api/memory/process reflect action', async ({ request }) => {
    const res = await request.post('/api/memory/process', {
      headers: API_KEY_HEADER,
      data: { action: 'reflect' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.action).toBe('reflect')
    expect(Array.isArray(body.suggestions)).toBe(true)
    expect(body.legacy).toBe(true)
  })

  test('POST /api/memory/process reweave action', async ({ request }) => {
    const res = await request.post('/api/memory/process', {
      headers: API_KEY_HEADER,
      data: { action: 'reweave' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.action).toBe('reweave')
    expect(Array.isArray(body.suggestions)).toBe(true)
    expect(body.legacy).toBe(true)
  })

  test('POST /api/memory/process generate-moc action', async ({ request }) => {
    const res = await request.post('/api/memory/process', {
      headers: API_KEY_HEADER,
      data: { action: 'generate-moc' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.action).toBe('generate-moc')
    expect(Array.isArray(body.groups)).toBe(true)
    expect(typeof body.totalGroups).toBe('number')
    expect(typeof body.totalEntries).toBe('number')
    expect(body.legacy).toBe(true)
  })

  test('process API rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/memory/process', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid' },
    })
    expect(res.status()).toBe(400)
  })

  test('process API requires auth', async ({ request }) => {
    const res = await request.post('/api/memory/process', {
      data: { action: 'reflect' },
    })
    expect(res.status()).toBe(401)
  })

  test('GET /api/memory content includes wikiLinks and schema', async ({ request }) => {
    const res = await request.get(
      `/api/memory?action=content&path=${encodeURIComponent(testFile)}`,
      { headers: API_KEY_HEADER }
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.path).toBe(testFile)
    expect(body.legacy).toBe(true)
    expect(Array.isArray(body.wikiLinks)).toBe(true)
    expect(body.wikiLinks.length).toBeGreaterThan(0)
    expect(body.schema).toBeTruthy()
    expect(body.schema.valid).toBe(true)
    expect(body.schema.errors).toEqual([])
  })

  test('save returns schema warnings for missing required fields', async ({ request }) => {
    const badContent = [
      '---',
      '_schema:',
      '  type: note',
      '  required: [title, tags, missing_field]',
      'title: Present',
      'tags: [a]',
      '---',
      '# Body',
    ].join('\n')

    const res = await request.post('/api/memory', {
      headers: API_KEY_HEADER,
      data: { action: 'save', path: testFile, content: badContent },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.schemaWarnings)).toBe(true)
    expect(body.schemaWarnings).toContain('Missing required field: missing_field')
    expect(body.legacy).toBe(true)
  })

  test('POST /api/memory/search rebuild is a deprecated no-op', async ({ request }) => {
    const res = await request.post('/api/memory/search', {
      headers: API_KEY_HEADER,
      data: { action: 'rebuild' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.legacy).toBe(true)
    expect(body.indexed).toBe(0)
  })
})
