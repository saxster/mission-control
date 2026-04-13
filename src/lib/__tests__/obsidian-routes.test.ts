import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateObsidianRequest = vi.fn()
const getKnowledgeBaseContext = vi.fn()
const getObsidianStatus = vi.fn()
const updateObsidianPluginConnection = vi.fn()
const syncObsidianVault = vi.fn()
const syncObsidianNote = vi.fn()
const listObsidianConflicts = vi.fn()
const resolveObsidianConflict = vi.fn()
const listObsidianImportCandidates = vi.fn()
const importObsidianCandidate = vi.fn()

vi.mock('@/lib/obsidian-auth', () => ({
  authenticateObsidianRequest,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/knowledge-base', () => ({
  getKnowledgeBaseContext,
}))

vi.mock('@/lib/obsidian', () => ({
  getObsidianStatus,
  updateObsidianPluginConnection,
  syncObsidianVault,
  syncObsidianNote,
  listObsidianConflicts,
  resolveObsidianConflict,
  listObsidianImportCandidates,
  importObsidianCandidate,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('obsidian routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    authenticateObsidianRequest.mockReturnValue({
      user: { username: 'operator', role: 'operator' },
      via: 'session',
    })
    getKnowledgeBaseContext.mockReturnValue({ runtimeProfile: { name: 'default' } })
  })

  it('returns obsidian status with refresh awareness', async () => {
    getObsidianStatus.mockReturnValue({ configured: true })

    const { GET } = await import('@/app/api/obsidian/status/route')
    const response = await GET(new NextRequest('http://localhost/api/obsidian/status?runtimeProfileName=default&refresh=1'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(getObsidianStatus).toHaveBeenCalledWith(
      { runtimeProfile: { name: 'default' } },
      { refresh: true, path: null },
    )
    expect(payload).toEqual({ configured: true })
  })

  it('passes the active note path through to obsidian status', async () => {
    getObsidianStatus.mockReturnValue({ configured: true, activeNote: { path: 'Hermes/Wiki/entities/Test.md' } })

    const { GET } = await import('@/app/api/obsidian/status/route')
    const response = await GET(new NextRequest('http://localhost/api/obsidian/status?runtimeProfileName=default&path=Hermes/Wiki/entities/Test.md'))

    expect(response.status).toBe(200)
    expect(getObsidianStatus).toHaveBeenCalledWith(
      { runtimeProfile: { name: 'default' } },
      { refresh: false, path: 'Hermes/Wiki/entities/Test.md' },
    )
  })

  it('records plugin heartbeats', async () => {
    const { POST } = await import('@/app/api/obsidian/connect/route')
    const response = await POST(new NextRequest('http://localhost/api/obsidian/connect', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        clientId: 'obsidian-demo',
        clientName: 'Hermes Obsidian Plugin',
      }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(updateObsidianPluginConnection).toHaveBeenCalledWith(
      { runtimeProfile: { name: 'default' } },
      expect.objectContaining({
        clientId: 'obsidian-demo',
        clientName: 'Hermes Obsidian Plugin',
        status: 'connected',
      }),
    )
    expect(payload.ok).toBe(true)
  })

  it('supports note-scoped sync requests', async () => {
    syncObsidianNote.mockReturnValue({ checkpointStatus: 'ok', scope: 'sync_note', path: 'Hermes/Wiki/entities/Test.md' })

    const { POST } = await import('@/app/api/obsidian/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/obsidian/sync', {
      method: 'POST',
      body: JSON.stringify({
        runtimeProfileName: 'default',
        action: 'sync_note',
        path: 'Hermes/Wiki/entities/Test.md',
      }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(response.status).toBe(200)
    expect(syncObsidianNote).toHaveBeenCalledWith(
      { runtimeProfile: { name: 'default' } },
      'Hermes/Wiki/entities/Test.md',
    )
  })

  it('validates conflict resolution input', async () => {
    const { POST } = await import('@/app/api/obsidian/conflicts/resolve/route')
    const response = await POST(new NextRequest('http://localhost/api/obsidian/conflicts/resolve', {
      method: 'POST',
      body: JSON.stringify({ runtimeProfileName: 'default', conflictId: 12, resolution: 'bad-value' }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Invalid resolution')
    expect(resolveObsidianConflict).not.toHaveBeenCalled()
  })

  it('imports a vault note into Hermes-managed space', async () => {
    importObsidianCandidate.mockReturnValue({ checkpointStatus: 'ok' })

    const { POST } = await import('@/app/api/obsidian/imports/route')
    const response = await POST(new NextRequest('http://localhost/api/obsidian/imports', {
      method: 'POST',
      body: JSON.stringify({ runtimeProfileName: 'default', path: 'Inbox/Note.md', targetFolder: 'Notes' }),
      headers: { 'content-type': 'application/json' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(importObsidianCandidate).toHaveBeenCalledWith({ runtimeProfile: { name: 'default' } }, 'Inbox/Note.md', 'Notes')
    expect(payload.ok).toBe(true)
  })
})
