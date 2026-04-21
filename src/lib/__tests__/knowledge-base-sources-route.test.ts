import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const getKnowledgeBaseContext = vi.fn()
const listKnowledgeBaseSources = vi.fn()
const importKnowledgeBaseSources = vi.fn()
const promoteKnowledgeBaseSource = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/knowledge-base', () => ({
  getKnowledgeBaseContext,
}))

vi.mock('@/lib/knowledge-base-sources', () => ({
  listKnowledgeBaseSources,
  importKnowledgeBaseSources,
  promoteKnowledgeBaseSource,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('knowledge base sources routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({
      user: { id: 1, username: 'operator', role: 'operator', workspace_id: 1 },
    })
    getKnowledgeBaseContext.mockReturnValue({ runtimeProfile: { name: 'default' } })
  })

  it('lists normalized knowledge base sources', async () => {
    listKnowledgeBaseSources.mockReturnValue([
      { id: 'source-1', kind: 'file', status: 'imported', title: 'Guide.pdf' },
    ])

    const { GET } = await import('@/app/api/knowledge-base/sources/route')
    const response = await GET(new NextRequest('http://localhost/api/knowledge-base/sources?runtimeProfileName=default'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(listKnowledgeBaseSources).toHaveBeenCalledWith({ runtimeProfile: { name: 'default' } })
    expect(payload.sources).toHaveLength(1)
  })

  it('imports a teach card into the source registry', async () => {
    importKnowledgeBaseSources.mockReturnValue([
      { id: 'source-1', kind: 'teach_card', status: 'imported', title: 'Vectors' },
    ])

    const { POST } = await import('@/app/api/knowledge-base/sources/route')
    const response = await POST(new NextRequest('http://localhost/api/knowledge-base/sources', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        kind: 'teach_card',
        title: 'Vectors',
        domain: 'programming',
        teachCard: { type: 'teach_card', topic: 'Vectors' },
      }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(importKnowledgeBaseSources).toHaveBeenCalledWith(expect.objectContaining({
      runtimeProfileName: 'default',
      kind: 'teach_card',
      domain: 'programming',
    }))
    expect(payload.ok).toBe(true)
  })

  it('imports file, URL, and Obsidian candidate payloads through the route contract', async () => {
    importKnowledgeBaseSources.mockReturnValue([
      { id: 'source-file', kind: 'file', status: 'imported', title: 'Guide.md' },
    ])

    const { POST } = await import('@/app/api/knowledge-base/sources/route')

    const fileResponse = await POST(new NextRequest('http://localhost/api/knowledge-base/sources', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        kind: 'file',
        filePaths: ['/tmp/Guide.md'],
        domain: 'programming',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(fileResponse.status).toBe(200)
    expect(importKnowledgeBaseSources).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'file',
      filePaths: ['/tmp/Guide.md'],
      domain: 'programming',
    }))

    const urlResponse = await POST(new NextRequest('http://localhost/api/knowledge-base/sources', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        kind: 'url',
        url: 'http://127.0.0.1:8123/web-source.html',
        title: 'Fixture URL',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(urlResponse.status).toBe(200)
    expect(importKnowledgeBaseSources).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'url',
      url: 'http://127.0.0.1:8123/web-source.html',
      title: 'Fixture URL',
    }))

    const obsidianResponse = await POST(new NextRequest('http://localhost/api/knowledge-base/sources', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        kind: 'import_candidate',
        path: 'Inbox/External-Candidate.md',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(obsidianResponse.status).toBe(200)
    expect(importKnowledgeBaseSources).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'import_candidate',
      path: 'Inbox/External-Candidate.md',
    }))
  })

  it('promotes a source into a wiki artifact', async () => {
    promoteKnowledgeBaseSource.mockResolvedValue({
      ok: true,
      path: 'concepts/Vectors.md',
      source: { id: 'source-1', kind: 'teach_card', status: 'indexed', title: 'Vectors' },
      governance: { reviewStatus: 'approved' },
    })

    const { POST } = await import('@/app/api/knowledge-base/sources/promote/route')
    const response = await POST(new NextRequest('http://localhost/api/knowledge-base/sources/promote', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        sourceId: 'source-1',
        targetType: 'concept',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(promoteKnowledgeBaseSource).toHaveBeenCalledWith(expect.objectContaining({
      runtimeProfileName: 'default',
      sourceID: 'source-1',
      targetType: 'concept',
      actor: 'operator',
    }))
    expect(payload.path).toBe('concepts/Vectors.md')
  })
})
