import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeBasePanel } from '@/components/panels/knowledge-base-panel'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === 'fileCountSize') {
      return `${values?.count ?? 0} files · ${values?.size ?? '0 B'}`
    }
    const fallback: Record<string, string> = {
      newFile: 'New File',
      indexing: 'Indexing…',
      links: 'Links',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      saving: 'Saving…',
    }
    return fallback[key] || key
  },
}))

vi.mock('@/components/panels/knowledge-base-graph', () => ({
  KnowledgeBaseGraph: () => <div>Mock graph</div>,
}))

describe('KnowledgeBasePanel', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/hermes') {
        return new Response(JSON.stringify({
          runtimeProfiles: [{ name: 'default', label: 'default' }],
          selectedRuntimeProfile: { name: 'default' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.startsWith('/api/knowledge-base/tree?')) {
        return new Response(JSON.stringify({
          tree: [],
          roots: ['entities', 'concepts', 'articles'],
          writableRoots: ['entities', 'concepts', 'articles'],
          emptyStateMessage: 'No wiki pages yet.',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${url}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('renders the knowledge base shell and empty wiki state', async () => {
    render(<KnowledgeBasePanel />)

    await waitFor(() => {
      expect(screen.getByText('Knowledge Base')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'New File' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'wiki' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'governance' })).toBeInTheDocument()
    expect(screen.getAllByText('No wiki pages yet.').length).toBeGreaterThan(0)
  })
})
