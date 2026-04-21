import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ObsidianIntegrationPanel } from '@/components/panels/obsidian-integration-panel'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('path=Hermes/Wiki/entities/Test.md'),
}))

describe('ObsidianIntegrationPanel', () => {
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
      if (url.startsWith('/api/obsidian/status?')) {
        return new Response(JSON.stringify({
          configured: true,
          runtimeProfileName: 'default',
          vaultPath: '/vault',
          managedRoot: '/vault/Hermes',
          managedFolders: ['Wiki', 'Notes'],
          watcher: { status: 'running', lastStartedAt: null, lastCompletedAt: null, lastError: null, lastScanCount: 0, lastChangeCount: 0 },
          lastCheckpoint: { scope: 'reconcile', status: 'ok', lastStartedAt: null, lastCompletedAt: null, lastScanCount: 0, lastChangeCount: 0, lastError: null },
          pluginConnection: null,
          syncHealth: {
            managedFiles: 12,
            vaultModified: 0,
            pendingConflicts: 1,
            importCandidates: 2,
            attachmentRefs: 3,
            brokenAttachmentRefs: 1,
            canvasRefs: 2,
            brokenCanvasRefs: 1,
          },
          activeNote: {
            path: 'Hermes/Wiki/entities/Test.md',
            managed: true,
            importCandidate: false,
            sourceOrigin: 'managed',
            managedPath: 'Wiki/entities/Test.md',
            syncStatus: 'synced',
            conflictState: 'open',
            conflictId: 42,
            conflictSummary: 'Canonical DB and vault note diverged.',
            reviewPath: 'Hermes/Wiki/entities/Test.merge-review.md',
            lastSyncedAt: 1710000000000,
            lastVaultModifiedAt: 1710001000000,
            importedFrom: null,
            governance: {
              reviewStatus: 'approved_with_warnings',
              qualityLabel: 'mixed',
              riskLevel: 'programming',
              overrideUsed: false,
              warningCount: 2,
            },
            recommendedActions: ['sync_note', 'resolve_conflict', 'open_mission_control'],
          },
          recentEvents: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.startsWith('/api/obsidian/conflicts?')) {
        return new Response(JSON.stringify({
          conflicts: [{
            id: 42,
            vaultRelativePath: 'Hermes/Wiki/entities/Test.md',
            conflictType: 'content_divergence',
            status: 'open',
            summary: 'Canonical DB and vault note diverged.',
            resolution: null,
            reviewPath: 'Hermes/Wiki/entities/Test.merge-review.md',
            createdAt: 1710000000000,
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.startsWith('/api/obsidian/imports?')) {
        return new Response(JSON.stringify({ imports: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('renders the current note card and repair-needed summary', async () => {
    render(<ObsidianIntegrationPanel />)

    await waitFor(() => {
      expect(screen.getByText('Current Note')).toBeInTheDocument()
    })

    expect(screen.getByText('Hermes-managed')).toBeInTheDocument()
    expect(screen.getAllByText('Canonical DB and vault note diverged.')).toHaveLength(2)
    expect(screen.getByText('Repair Needed')).toBeInTheDocument()
    expect(screen.getByText('1 broken attachment ref')).toBeInTheDocument()
    expect(screen.getByText('1 broken canvas ref')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'keep DB' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'open in Mission Control' })).toHaveAttribute(
      'href',
      '/knowledge-base?runtimeProfileName=default&path=entities%2FTest.md',
    )
  })
})
