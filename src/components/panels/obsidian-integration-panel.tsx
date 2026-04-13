'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('ObsidianIntegrationPanel')

interface RuntimeProfileOption {
  name: string
  label: string
}

interface ObsidianStatusPayload {
  configured: boolean
  runtimeProfileName: string
  vaultPath: string | null
  managedRoot: string | null
  managedFolders: string[]
  watcher: {
    status: string | null
    lastStartedAt: number | null
    lastCompletedAt: number | null
    lastError: string | null
    lastScanCount: number
    lastChangeCount: number
  } | null
  lastCheckpoint: {
    scope: string
    status: string | null
    lastStartedAt: number | null
    lastCompletedAt: number | null
    lastScanCount: number
    lastChangeCount: number
    lastError: string | null
  } | null
  pluginConnection: {
    clientId: string
    clientName: string
    clientVersion: string | null
    vaultName: string | null
    status: 'connected' | 'disconnected'
    lastSeenAt: number
  } | null
  syncHealth: {
    managedFiles: number
    vaultModified: number
    pendingConflicts: number
    importCandidates: number
    attachmentRefs: number
    brokenAttachmentRefs: number
    canvasRefs: number
    brokenCanvasRefs: number
  }
  activeNote?: {
    path: string
    managed: boolean
    importCandidate: boolean
    sourceOrigin: 'managed' | 'external_import' | 'external'
    managedPath: string | null
    syncStatus: string | null
    conflictState: string | null
    conflictId: number | null
    conflictSummary: string | null
    reviewPath: string | null
    lastSyncedAt: number | null
    lastVaultModifiedAt: number | null
    importedFrom: string | null
    governance: {
      reviewStatus: string
      qualityLabel: string
      riskLevel: string
      overrideUsed: boolean
      warningCount: number
    } | null
    recommendedActions: Array<'sync_note' | 'import_note' | 'resolve_conflict' | 'open_mission_control'>
  } | null
  recentEvents: Array<{
    id: number
    eventType: string
    path: string | null
    direction: string | null
    status: string
    detail: string | null
    createdAt: number
  }>
}

interface ConflictItem {
  id: number
  vaultRelativePath: string
  conflictType: string
  status: 'open' | 'resolved'
  summary: string
  resolution: string | null
  reviewPath?: string | null
  createdAt: number
}

interface ImportItem {
  id: number
  vaultRelativePath: string
  title: string
  imported: boolean
  importedManagedPath: string | null
  updatedAt: number
}

function fmtTime(value: number | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function StatCard({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'warning' | 'critical' }) {
  const toneClass = tone === 'critical'
    ? 'border-red-500/20 bg-red-500/5 text-red-200'
    : tone === 'warning'
      ? 'border-amber-500/20 bg-amber-500/5 text-amber-200'
      : 'border-border bg-card text-foreground'
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-[0.16em] font-mono text-muted-foreground/70">{label}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  )
}

function statusBadgeTone(activeNote: ObsidianStatusPayload['activeNote']): 'default' | 'warning' | 'critical' {
  if (!activeNote) return 'default'
  if (activeNote.conflictState === 'open') return 'critical'
  if (!activeNote.managed || activeNote.importCandidate || activeNote.governance?.warningCount) return 'warning'
  return 'default'
}

function missionControlHref(runtimeProfileName: string, activeNote: NonNullable<ObsidianStatusPayload['activeNote']>) {
  if (activeNote.managed && activeNote.managedPath?.startsWith('Wiki/')) {
    const kbPath = activeNote.managedPath.slice('Wiki/'.length)
    return `/knowledge-base?runtimeProfileName=${encodeURIComponent(runtimeProfileName)}&path=${encodeURIComponent(kbPath)}`
  }
  return `/obsidian?runtimeProfileName=${encodeURIComponent(runtimeProfileName)}&path=${encodeURIComponent(activeNote.path)}`
}

export function ObsidianIntegrationPanel() {
  const searchParams = useSearchParams()
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfileOption[]>([])
  const [runtimeProfileName, setRuntimeProfileName] = useState('default')
  const [status, setStatus] = useState<ObsidianStatusPayload | null>(null)
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [imports, setImports] = useState<ImportItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const currentPath = searchParams.get('path')

  const loadRuntimeProfiles = useCallback(async () => {
    try {
      const response = await fetch('/api/hermes')
      const data = await response.json()
      if (Array.isArray(data.runtimeProfiles)) setRuntimeProfiles(data.runtimeProfiles)
      if (typeof data?.selectedRuntimeProfile?.name === 'string') setRuntimeProfileName(data.selectedRuntimeProfile.name)
    } catch (error) {
      log.error('Failed to load Hermes runtime profiles', error)
    }
  }, [])

  const fetchAll = useCallback(async (refresh = false) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('runtimeProfileName', runtimeProfileName)
      if (refresh) params.set('refresh', '1')
      if (currentPath) params.set('path', currentPath)
      const [statusRes, conflictsRes, importsRes] = await Promise.all([
        fetch(`/api/obsidian/status?${params.toString()}`),
        fetch(`/api/obsidian/conflicts?${params.toString()}`),
        fetch(`/api/obsidian/imports?${params.toString()}`),
      ])
      const [statusData, conflictsData, importsData] = await Promise.all([
        statusRes.json(),
        conflictsRes.json(),
        importsRes.json(),
      ])
      if (statusRes.ok) setStatus(statusData)
      if (conflictsRes.ok) {
        const nextConflicts = Array.isArray(conflictsData.conflicts) ? conflictsData.conflicts : []
        setConflicts(nextConflicts.sort((a: ConflictItem, b: ConflictItem) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1
          return b.createdAt - a.createdAt
        }))
      }
      if (importsRes.ok) {
        const nextImports = Array.isArray(importsData.imports) ? importsData.imports : []
        setImports(nextImports.sort((a: ImportItem, b: ImportItem) => {
          if (a.imported !== b.imported) return a.imported ? 1 : -1
          return b.updatedAt - a.updatedAt
        }))
      }
    } catch (error) {
      log.error('Failed to load Obsidian integration state', error)
    } finally {
      setIsLoading(false)
    }
  }, [currentPath, runtimeProfileName])

  useEffect(() => {
    void loadRuntimeProfiles()
  }, [loadRuntimeProfiles])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const syncVault = async () => {
    setIsSyncing(true)
    try {
      await fetch('/api/obsidian/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeProfileName }),
      })
      await fetchAll(true)
    } catch (error) {
      log.error('Failed to trigger Obsidian sync', error)
    } finally {
      setIsSyncing(false)
    }
  }

  const syncCurrentNote = async (path: string) => {
    try {
      await fetch('/api/obsidian/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeProfileName, action: 'sync_note', path }),
      })
      await fetchAll(true)
    } catch (error) {
      log.error('Failed to trigger note-scoped Obsidian sync', error)
    }
  }

  const importCandidate = async (path: string) => {
    try {
      await fetch('/api/obsidian/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeProfileName, path, targetFolder: 'Notes' }),
      })
      await fetchAll(true)
    } catch (error) {
      log.error('Failed to import Obsidian candidate', error)
    }
  }

  const resolveConflict = async (conflictId: number, resolution: 'keep_db' | 'keep_vault' | 'merged') => {
    try {
      await fetch('/api/obsidian/conflicts/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeProfileName, conflictId, resolution }),
      })
      await fetchAll(true)
    } catch (error) {
      log.error('Failed to resolve Obsidian conflict', error)
    }
  }

  const repairAlerts = status ? [
    status.syncHealth.brokenAttachmentRefs > 0 ? `${status.syncHealth.brokenAttachmentRefs} broken attachment ref${status.syncHealth.brokenAttachmentRefs === 1 ? '' : 's'}` : null,
    status.syncHealth.brokenCanvasRefs > 0 ? `${status.syncHealth.brokenCanvasRefs} broken canvas ref${status.syncHealth.brokenCanvasRefs === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[] : []

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-auto bg-[hsl(var(--surface-0))]">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-border bg-[hsl(var(--surface-0))]/95 backdrop-blur">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 font-mono">Obsidian</div>
          <h1 className="text-xl font-semibold">Vault Integration</h1>
        </div>
        <div className="flex-1" />
        {runtimeProfiles.length > 0 && (
          <select
            value={runtimeProfileName}
            onChange={(event) => setRuntimeProfileName(event.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
          >
            {runtimeProfiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.label || profile.name}</option>)}
          </select>
        )}
        <Button size="sm" variant="secondary" onClick={() => void fetchAll(true)} disabled={isLoading || isSyncing}>refresh</Button>
        <Button size="sm" onClick={() => void syncVault()} disabled={isSyncing}>{isSyncing ? 'syncing…' : 'sync vault'}</Button>
      </div>

      <div className="p-6 space-y-6">
        {!status || isLoading ? (
          <div className="flex items-center justify-center h-40"><Loader variant="inline" label="Loading Obsidian integration..." /></div>
        ) : !status.configured ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
            <h2 className="text-lg font-semibold text-foreground">No Obsidian vault configured</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Configure <code className="font-mono text-foreground/80">knowledge.vault_path</code> or <code className="font-mono text-foreground/80">OBSIDIAN_VAULT_PATH</code>{' '}
              for this Hermes runtime profile. Mission Control will use{' '}
              <code className="font-mono text-foreground/80">&lt;vault&gt;/&lt;agent_prefix&gt;</code> as the managed root.
            </p>
          </div>
        ) : (
          <>
            {status.activeNote && (
              <section className={`rounded-2xl border p-5 ${statusBadgeTone(status.activeNote) === 'critical' ? 'border-red-500/20 bg-red-500/5' : statusBadgeTone(status.activeNote) === 'warning' ? 'border-amber-500/20 bg-amber-500/5' : 'border-border bg-card'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Current Note</div>
                    <h2 className="text-lg font-semibold mt-1">
                      {status.activeNote.managed ? 'Hermes-managed' : status.activeNote.importCandidate ? 'Import candidate' : 'External note'}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-2 break-all">{status.activeNote.path}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.12em] ${status.activeNote.conflictState === 'open' ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-sky-500/10 text-sky-200 border border-sky-500/20'}`}>
                      {status.activeNote.conflictState === 'open' ? 'conflict' : (status.activeNote.syncStatus || 'status unknown').replace(/_/g, ' ')}
                    </span>
                    {status.activeNote.governance && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.12em] ${status.activeNote.governance.reviewStatus === 'approved' ? 'bg-green-500/10 text-green-200 border border-green-500/20' : 'bg-amber-500/10 text-amber-200 border border-amber-500/20'}`}>
                        {status.activeNote.governance.reviewStatus.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Managed Path</div>
                    <div className="mt-1 break-all text-foreground">{status.activeNote.managedPath || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Governance</div>
                    <div className="mt-1 text-foreground">
                      {status.activeNote.governance
                        ? `${status.activeNote.governance.qualityLabel} · ${status.activeNote.governance.riskLevel} risk`
                        : 'No governance record'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Imported From</div>
                    <div className="mt-1 break-all text-foreground">{status.activeNote.importedFrom || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Last Synced</div>
                    <div className="mt-1 text-foreground">{fmtTime(status.activeNote.lastSyncedAt)}</div>
                  </div>
                </div>
                {status.activeNote.conflictSummary && (
                  <div className="mt-4 rounded-xl border border-border/70 bg-[hsl(var(--surface-1))] p-4 text-sm text-foreground">
                    {status.activeNote.conflictSummary}
                    {status.activeNote.reviewPath && (
                      <div className="mt-2 text-[11px] font-mono text-sky-300">Merge review: {status.activeNote.reviewPath}</div>
                    )}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {status.activeNote.recommendedActions.includes('sync_note') && (
                    <Button size="sm" onClick={() => void syncCurrentNote(status.activeNote!.path)}>sync note</Button>
                  )}
                  {status.activeNote.recommendedActions.includes('import_note') && (
                    <Button size="sm" onClick={() => void importCandidate(status.activeNote!.path)}>import into Notes</Button>
                  )}
                  {status.activeNote.recommendedActions.includes('resolve_conflict') && status.activeNote.conflictId && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => void resolveConflict(status.activeNote!.conflictId!, 'keep_db')}>keep DB</Button>
                      <Button size="sm" variant="secondary" onClick={() => void resolveConflict(status.activeNote!.conflictId!, 'keep_vault')}>keep vault</Button>
                      <Button size="sm" variant="secondary" onClick={() => void resolveConflict(status.activeNote!.conflictId!, 'merged')}>create merge review</Button>
                    </>
                  )}
                  <a
                    className="inline-flex items-center rounded-md border border-border/60 px-3 py-1.5 text-sm text-foreground hover:bg-[hsl(var(--surface-1))]"
                    href={missionControlHref(runtimeProfileName, status.activeNote)}
                  >
                    open in Mission Control
                  </a>
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard label="Managed Files" value={status.syncHealth.managedFiles} />
              <StatCard label="Vault Modified" value={status.syncHealth.vaultModified} tone={status.syncHealth.vaultModified > 0 ? 'warning' : 'default'} />
              <StatCard label="Pending Conflicts" value={status.syncHealth.pendingConflicts} tone={status.syncHealth.pendingConflicts > 0 ? 'critical' : 'default'} />
              <StatCard label="Import Candidates" value={status.syncHealth.importCandidates} tone={status.syncHealth.importCandidates > 0 ? 'warning' : 'default'} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6">
              <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Connection & Sync</h2>
                    <p className="text-sm text-muted-foreground mt-1">Hermes-managed root, plugin state, and the latest vault scan checkpoint.</p>
                  </div>
                </div>
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Vault Path</dt>
                    <dd className="mt-1 break-all text-foreground">{status.vaultPath}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Managed Root</dt>
                    <dd className="mt-1 break-all text-foreground">{status.managedRoot}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Plugin</dt>
                    <dd className="mt-1 text-foreground">
                      {status.pluginConnection ? `${status.pluginConnection.clientName} · ${status.pluginConnection.status}` : 'No plugin heartbeat yet'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Last Sync</dt>
                    <dd className="mt-1 text-foreground">{fmtTime(status.lastCheckpoint?.lastCompletedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">Watcher</dt>
                    <dd className="mt-1 text-foreground">
                      {status.watcher ? `${status.watcher.status || 'unknown'} · ${fmtTime(status.watcher.lastCompletedAt)}` : 'Watcher not reporting'}
                    </dd>
                  </div>
                </dl>
                <div className="rounded-xl border border-border/70 bg-[hsl(var(--surface-1))] p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono mb-2">Managed Folders</div>
                  <div className="flex flex-wrap gap-2">
                    {status.managedFolders.map((folder) => (
                      <span key={folder} className="px-2 py-1 rounded bg-[hsl(var(--surface-2))] text-xs font-mono text-foreground/80">{folder}</span>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">Index Health</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between"><span>Attachment refs</span><span className="font-mono">{status.syncHealth.attachmentRefs}</span></div>
                  <div className="flex items-center justify-between"><span>Broken attachments</span><span className="font-mono text-amber-300">{status.syncHealth.brokenAttachmentRefs}</span></div>
                  <div className="flex items-center justify-between"><span>Canvas refs</span><span className="font-mono">{status.syncHealth.canvasRefs}</span></div>
                  <div className="flex items-center justify-between"><span>Broken canvas refs</span><span className="font-mono text-amber-300">{status.syncHealth.brokenCanvasRefs}</span></div>
                  <div className="flex items-center justify-between"><span>Last scan count</span><span className="font-mono">{status.lastCheckpoint?.lastScanCount ?? 0}</span></div>
                  <div className="flex items-center justify-between"><span>Last change count</span><span className="font-mono">{status.lastCheckpoint?.lastChangeCount ?? 0}</span></div>
                </div>
                <div className="mt-4 rounded-xl border border-border/70 bg-[hsl(var(--surface-1))] p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono mb-2">Repair Needed</div>
                  {repairAlerts.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No broken attachment or canvas references detected.</div>
                  ) : (
                    <div className="space-y-2">
                      {repairAlerts.map((alert) => (
                        <div key={alert} className="text-sm text-amber-200">{alert}</div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Conflict Queue</h2>
                    <p className="text-sm text-muted-foreground mt-1">Duplicate UUIDs and other sync breaks that need an explicit operator decision.</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{conflicts.filter((item) => item.status === 'open').length} open</span>
                </div>
                <div className="mt-4 space-y-3">
                  {conflicts.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No conflicts recorded.</div>
                  ) : conflicts.map((conflict) => (
                    <div key={conflict.id} className="rounded-xl border border-border/70 bg-[hsl(var(--surface-1))] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-mono text-xs text-muted-foreground/70">{conflict.vaultRelativePath}</div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.12em] ${conflict.status === 'open' ? 'bg-red-500/10 text-red-200 border border-red-500/20' : 'bg-green-500/10 text-green-200 border border-green-500/20'}`}>
                          {conflict.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-foreground">{conflict.summary}</div>
                      <div className="mt-2 text-[11px] font-mono text-muted-foreground">{fmtTime(conflict.createdAt)}</div>
                      {conflict.reviewPath && (
                        <div className="mt-2 text-[11px] font-mono text-sky-300">
                          <a href={`/obsidian?runtimeProfileName=${encodeURIComponent(runtimeProfileName)}&path=${encodeURIComponent(conflict.reviewPath)}`} className="hover:underline">
                            merge review: {conflict.reviewPath}
                          </a>
                        </div>
                      )}
                      {conflict.status === 'open' && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => void resolveConflict(conflict.id, 'keep_db')}>keep DB</Button>
                          <Button size="sm" variant="secondary" onClick={() => void resolveConflict(conflict.id, 'keep_vault')}>keep vault</Button>
                          <Button size="sm" variant="secondary" onClick={() => void resolveConflict(conflict.id, 'merged')}>create merge review</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Import Queue</h2>
                    <p className="text-sm text-muted-foreground mt-1">External vault notes are indexed here before they enter the Hermes-managed root.</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{imports.filter((item) => !item.imported).length} pending</span>
                </div>
                <div className="mt-4 space-y-3">
                  {imports.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No external vault notes indexed yet.</div>
                  ) : imports.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/70 bg-[hsl(var(--surface-1))] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-foreground">{item.title}</div>
                          <div className="text-[11px] font-mono text-muted-foreground mt-1">{item.vaultRelativePath}</div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-[0.12em] ${item.imported ? 'bg-green-500/10 text-green-200 border border-green-500/20' : 'bg-amber-500/10 text-amber-200 border border-amber-500/20'}`}>
                          {item.imported ? 'imported' : 'pending'}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] font-mono text-muted-foreground">{fmtTime(item.updatedAt)}</div>
                      {!item.imported && (
                        <div className="mt-3">
                          <Button size="sm" onClick={() => void importCandidate(item.vaultRelativePath)}>import into Notes</Button>
                        </div>
                      )}
                      {item.imported && item.importedManagedPath && (
                        <div className="mt-3 text-xs text-muted-foreground">
                          Managed path:{' '}
                          <a
                            href={`/obsidian?runtimeProfileName=${encodeURIComponent(runtimeProfileName)}&path=${encodeURIComponent(item.importedManagedPath)}`}
                            className="font-mono text-foreground/80 hover:underline"
                          >
                            {item.importedManagedPath}
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Recent Events</h2>
              <div className="mt-4 space-y-2">
                {status.recentEvents.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No sync events captured yet.</div>
                ) : status.recentEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-border/70 bg-[hsl(var(--surface-1))] px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">{event.eventType}</div>
                        <div className="text-xs text-muted-foreground mt-1">{event.detail || 'No additional detail'}</div>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">{fmtTime(event.createdAt)}</div>
                    </div>
                    {event.path && <div className="mt-2 text-[11px] font-mono text-muted-foreground/70">{event.path}</div>}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
