'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { createClientLogger } from '@/lib/client-logger'
import type {
  KnowledgeBaseGovernanceRecord,
  KnowledgeBaseGovernanceReview,
  KnowledgeBaseGovernanceSummary,
  KnowledgeBaseSourceInput,
} from '@/lib/knowledge-base-governance'
import { KnowledgeBaseGraph } from './knowledge-base-graph'
import {
  createDefaultGovernanceForm,
  createEmptyGovernanceSource,
  governanceFormFromRecord,
  KnowledgeBaseGovernanceEditor,
} from './knowledge-base-governance-editor'

const log = createClientLogger('KnowledgeBasePanel')

type PanelTab = 'wiki' | 'graph' | 'health' | 'pipeline' | 'governance' | 'structured' | 'memory'
type ContentScope = 'wiki' | 'structured'

interface RuntimeProfileOption {
  name: string
  label: string
  description?: string
  exists?: boolean
}

interface FileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: FileNode[]
  pageType?: string
  readOnly?: boolean
}

interface FileContentPayload {
  path: string
  content: string
  pageType: string
  readOnly: boolean
  wikiLinks: { target: string; display: string; line: number }[]
  schema?: { valid: boolean; errors: string[] } | null
  governance?: KnowledgeBaseGovernanceRecord | null
  obsidian?: {
    vaultBacked: boolean
    vaultRelativePath: string | null
    managedRelativePath: string | null
    syncStatus: string | null
    conflictState: string | null
    fileUuid: string | null
    contentHash: string | null
    lastDbRevisionId: number | null
    sourceOrigin: string
    attachmentRefs: Array<{ targetPath: string; targetType: string; exists: boolean }>
    canvasRefs: Array<{ targetPath: string | null; nodeType: string; broken: boolean }>
  } | null
}

interface GovernanceQueueItem {
  path: string
  pageType: string
  current: boolean
  record: KnowledgeBaseGovernanceRecord
}

interface GovernanceQueuePayload {
  items: GovernanceQueueItem[]
  totalPages: number
  stats: {
    unreviewed: number
    overridden: number
    highRisk: number
    warnings: number
    backfillEligible: number
  }
}

interface HealthCategory {
  name: string
  status: 'healthy' | 'warning' | 'critical'
  score: number
  issues: string[]
  suggestions: string[]
}

interface HealthReport {
  overall: 'healthy' | 'warning' | 'critical'
  overallScore: number
  categories: HealthCategory[]
  generatedAt: number
}

interface StructuredEntry {
  type: 'note' | 'person' | 'project' | 'decision'
  id: number
  title: string
  summary: string
  tags: string[]
  linkedPath?: string | null
  status?: string | null
  metadata?: Record<string, unknown>
}

interface HermesMemoryPayload {
  agentMemory: string | null
  userMemory: string | null
  agentMemorySize: number
  userMemorySize: number
  agentMemoryEntries: number
  userMemoryEntries: number
  runtimeProfileName: string
}

type GovernanceFormState = {
  domain: 'general' | 'programming' | 'medicine' | 'security' | 'legal' | 'finance'
  sources: KnowledgeBaseSourceInput[]
  allowLowerQualitySources?: boolean
  overrideReason?: string | null
}

function mergeDirectoryChildren(files: FileNode[], targetPath: string, children: FileNode[]): FileNode[] {
  return files.map((file) => {
    if (file.path === targetPath && file.type === 'directory') {
      return { ...file, children }
    }
    if (!file.children?.length) return file
    return { ...file, children: mergeDirectoryChildren(file.children, targetPath, children) }
  })
}

function countFiles(files: FileNode[]): number {
  return files.reduce((sum, file) => {
    if (file.type === 'file') return sum + 1
    return sum + countFiles(file.children || [])
  }, 0)
}

function totalSize(files: FileNode[]): number {
  return files.reduce((sum, file) => {
    if (file.type === 'file') return sum + (file.size || 0)
    return sum + totalSize(file.children || [])
  }, 0)
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function iconForFile(name: string): string {
  if (name.endsWith('.md')) return '#'
  if (name.endsWith('.json')) return '{}'
  if (name.endsWith('.txt')) return '|'
  return '~'
}

function statusColor(status: 'healthy' | 'warning' | 'critical'): string {
  if (status === 'healthy') return 'text-green-400'
  if (status === 'warning') return 'text-amber-400'
  return 'text-red-400'
}

function statusBar(status: 'healthy' | 'warning' | 'critical'): string {
  if (status === 'healthy') return 'bg-green-500'
  if (status === 'warning') return 'bg-amber-500'
  return 'bg-red-500'
}

function governanceBadgeClass(reviewStatus: KnowledgeBaseGovernanceSummary['reviewStatus']) {
  if (reviewStatus === 'approved') return 'text-green-300 bg-green-500/10 border-green-500/20'
  if (reviewStatus === 'approved_with_warnings') return 'text-amber-300 bg-amber-500/10 border-amber-500/20'
  if (reviewStatus === 'overridden') return 'text-amber-200 bg-amber-500/10 border-amber-500/20'
  if (reviewStatus === 'override_required') return 'text-red-300 bg-red-500/10 border-red-500/20'
  return 'text-sky-300 bg-sky-500/10 border-sky-500/20'
}

export function KnowledgeBasePanel() {
  const t = useTranslations('memoryBrowser')
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfileOption[]>([])
  const [runtimeProfileName, setRuntimeProfileName] = useState('default')
  const [wikiFiles, setWikiFiles] = useState<FileNode[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [selectedScope, setSelectedScope] = useState<ContentScope>('wiki')
  const [selectedContent, setSelectedContent] = useState<FileContentPayload | null>(null)
  const [linksData, setLinksData] = useState<{ incoming: string[]; outgoing: string[]; wikiLinks: { target: string; display: string; line: number }[] } | null>(null)
  const [linksOpen, setLinksOpen] = useState(false)
  const [isLoadingTree, setIsLoadingTree] = useState(false)
  const [isHydratingTree, setIsHydratingTree] = useState(false)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('wiki')
  const [pageFilter, setPageFilter] = useState<'all' | 'entities' | 'concepts' | 'comparisons' | 'queries' | 'articles' | 'raw'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{
    path: string
    name: string
    matches: number
    pageType: string
    snippet: string
    governance: KnowledgeBaseGovernanceSummary
    rank: number
  }>>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([])
  const [governanceForm, setGovernanceForm] = useState<GovernanceFormState>(createDefaultGovernanceForm())
  const [governanceReview, setGovernanceReview] = useState<KnowledgeBaseGovernanceReview | KnowledgeBaseGovernanceRecord | null>(null)
  const [governanceError, setGovernanceError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [emptyStateMessage, setEmptyStateMessage] = useState<string | null>(null)
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null)
  const [isLoadingHealth, setIsLoadingHealth] = useState(false)
  const [pipelineResult, setPipelineResult] = useState<{ action: string; filesProcessed?: number; suggestions?: string[] } | null>(null)
  const [mocGroups, setMocGroups] = useState<Array<{ directory: string; entries: { title: string; path: string; linkCount: number }[] }>>([])
  const [isRunningPipeline, setIsRunningPipeline] = useState(false)
  const [structuredQuery, setStructuredQuery] = useState('')
  const [structuredType, setStructuredType] = useState<'all' | 'people' | 'projects' | 'decisions' | 'notes'>('all')
  const [structuredEntries, setStructuredEntries] = useState<StructuredEntry[]>([])
  const [selectedStructuredEntry, setSelectedStructuredEntry] = useState<StructuredEntry | null>(null)
  const [isLoadingStructured, setIsLoadingStructured] = useState(false)
  const [hermesMemory, setHermesMemory] = useState<HermesMemoryPayload | null>(null)
  const [isLoadingMemory, setIsLoadingMemory] = useState(false)
  const [governanceQueue, setGovernanceQueue] = useState<GovernanceQueuePayload | null>(null)
  const [isLoadingGovernanceQueue, setIsLoadingGovernanceQueue] = useState(false)
  const [isBackfillingGovernance, setIsBackfillingGovernance] = useState(false)

  const treeRef = useRef<FileNode[]>([])
  treeRef.current = wikiFiles

  const loadRuntimeProfiles = useCallback(async () => {
    try {
      const response = await fetch('/api/hermes')
      const data = await response.json()
      if (Array.isArray(data.runtimeProfiles)) {
        setRuntimeProfiles(data.runtimeProfiles)
      }
      if (typeof data?.selectedRuntimeProfile?.name === 'string') {
        setRuntimeProfileName(data.selectedRuntimeProfile.name)
      }
    } catch (error) {
      log.error('Failed to load Hermes runtime profiles', error)
    }
  }, [])

  useEffect(() => {
    void loadRuntimeProfiles()
  }, [loadRuntimeProfiles])

  const kbParams = useMemo(() => {
    const params = new URLSearchParams()
    if (runtimeProfileName) params.set('runtimeProfileName', runtimeProfileName)
    return params
  }, [runtimeProfileName])

  const fetchTree = useCallback(async (options?: { path?: string; depth?: number }) => {
    const params = new URLSearchParams(kbParams)
    if (options?.path) params.set('path', options.path)
    if (typeof options?.depth === 'number') params.set('depth', String(options.depth))
    const response = await fetch(`/api/knowledge-base/tree?${params.toString()}`)
    return response.json()
  }, [kbParams])

  const loadTree = useCallback(async () => {
    setIsLoadingTree(true)
    try {
      const data = await fetchTree({ depth: 1 })
      setWikiFiles(data.tree || [])
      setExpandedFolders(new Set(data.roots || []))
      setEmptyStateMessage(typeof data.emptyStateMessage === 'string' ? data.emptyStateMessage : null)
      setIsHydratingTree(true)
      void fetchTree()
        .then((full) => setWikiFiles(full.tree || []))
        .catch((error) => log.error('Failed to hydrate full knowledge tree', error))
        .finally(() => setIsHydratingTree(false))
    } catch (error) {
      log.error('Failed to load Knowledge Base tree', error)
      setWikiFiles([])
      setEmptyStateMessage('Failed to load the Hermes wiki.')
    } finally {
      setIsLoadingTree(false)
    }
  }, [fetchTree])

  useEffect(() => {
    setSelectedPath('')
    setSelectedContent(null)
    setLinksData(null)
    setSearchResults([])
    setStructuredEntries([])
    setSelectedStructuredEntry(null)
    setHealthReport(null)
    setHermesMemory(null)
    setGovernanceQueue(null)
    setPipelineResult(null)
    setMocGroups([])
    setGovernanceForm(createDefaultGovernanceForm())
    setGovernanceReview(null)
    setGovernanceError(null)
    void loadTree()
  }, [runtimeProfileName, loadTree])

  const loadFile = useCallback(async (path: string, scope: ContentScope = 'wiki') => {
    setIsLoadingContent(true)
    try {
      const params = new URLSearchParams(kbParams)
      params.set('path', path)
      if (scope === 'structured') params.set('scope', 'structured')
      const response = await fetch(`/api/knowledge-base/content?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load content')
      setSelectedPath(path)
      setSelectedScope(scope)
      setSelectedContent(data)
      setEditedContent(data.content || '')
      setIsEditing(false)
      setSchemaWarnings(data.schema?.errors || [])
      setGovernanceReview(data.governance || null)
      setGovernanceForm(governanceFormFromRecord(data.governance))
      setGovernanceError(null)
      if (scope === 'wiki') {
        const linkResponse = await fetch(`/api/knowledge-base/links?${new URLSearchParams({ ...Object.fromEntries(kbParams), file: path }).toString()}`)
        const linkData = await linkResponse.json()
        setLinksData({
          incoming: linkData.incoming || [],
          outgoing: linkData.outgoing || [],
          wikiLinks: linkData.wikiLinks || [],
        })
      } else {
        setLinksData(null)
        setGovernanceReview(null)
        setGovernanceForm(createDefaultGovernanceForm())
      }
    } catch (error) {
      log.error('Failed to load Knowledge Base content', error)
    } finally {
      setIsLoadingContent(false)
    }
  }, [kbParams])

  const performSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    try {
      const params = new URLSearchParams(kbParams)
      params.set('q', searchQuery)
      const response = await fetch(`/api/knowledge-base/search?${params.toString()}`)
      const data = await response.json()
      setSearchResults(data.results || [])
    } catch (error) {
      log.error('Knowledge Base search failed', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [kbParams, searchQuery])

  const filteredFiles = useMemo(() => {
    if (pageFilter === 'all') return wikiFiles
    return wikiFiles.filter((file) => file.path === pageFilter || file.path.startsWith(`${pageFilter}/`))
  }, [pageFilter, wikiFiles])

  const toggleFolder = async (folderPath: string, needsChildren: boolean) => {
    if (!expandedFolders.has(folderPath) && needsChildren) {
      try {
        const data = await fetchTree({ path: folderPath, depth: 1 })
        setWikiFiles(mergeDirectoryChildren(treeRef.current, folderPath, data.tree || []))
      } catch (error) {
        log.error('Failed to load folder children', error)
      }
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  const saveFile = async () => {
    if (!selectedPath || selectedScope !== 'wiki') return
    setIsSaving(true)
    setGovernanceError(null)
    try {
      const response = await fetch('/api/knowledge-base/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          path: selectedPath,
          content: editedContent,
          runtimeProfileName,
          governance: governanceForm,
          obsidianBaseHash: selectedContent?.obsidian?.contentHash || null,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (data.governance) setGovernanceReview(data.governance)
        setGovernanceError(data.error || 'Failed to save file')
        throw new Error(data.error || 'Failed to save file')
      }
      setSelectedContent((current) => current ? { ...current, content: editedContent, governance: data.governance || null } : current)
      setSchemaWarnings(data.schemaWarnings || [])
      setGovernanceReview(data.governance || null)
      setGovernanceError(null)
      setIsEditing(false)
      await loadTree()
    } catch (error) {
      log.error('Failed to save Knowledge Base file', error)
    } finally {
      setIsSaving(false)
    }
  }

  const createFile = async (path: string, content: string, governance: GovernanceFormState) => {
    try {
      const response = await fetch('/api/knowledge-base/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', path, content, runtimeProfileName, governance }),
      })
      const data = await response.json()
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || 'Failed to create file',
          governance: data.governance || null,
        }
      }
      await loadTree()
      await loadFile(path, 'wiki')
      return { ok: true as const, error: null, governance: data.governance || null }
    } catch (error) {
      log.error('Failed to create Knowledge Base file', error)
      return { ok: false as const, error: 'Failed to create Knowledge Base file', governance: null }
    }
  }

  const deleteFile = async () => {
    if (!selectedPath || selectedScope !== 'wiki') return
    try {
      const response = await fetch('/api/knowledge-base/content', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: selectedPath, runtimeProfileName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to delete file')
      setSelectedPath('')
      setSelectedContent(null)
      setLinksData(null)
      setGovernanceForm(createDefaultGovernanceForm())
      setGovernanceReview(null)
      setGovernanceError(null)
      setShowDeleteConfirm(false)
      await loadTree()
    } catch (error) {
      log.error('Failed to delete Knowledge Base file', error)
    }
  }

  const loadHealth = useCallback(async () => {
    setIsLoadingHealth(true)
    try {
      const response = await fetch(`/api/knowledge-base/health?${kbParams.toString()}`)
      const data = await response.json()
      if (response.ok && Array.isArray(data.categories)) setHealthReport(data)
    } catch (error) {
      log.error('Failed to load Knowledge Base health', error)
    } finally {
      setIsLoadingHealth(false)
    }
  }, [kbParams])

  useEffect(() => {
    if (activeTab === 'health' && !healthReport) void loadHealth()
  }, [activeTab, healthReport, loadHealth])

  const runPipeline = async (action: string) => {
    setIsRunningPipeline(true)
    setPipelineResult(null)
    setMocGroups([])
    try {
      const response = await fetch('/api/knowledge-base/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, runtimeProfileName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to run pipeline')
      if (action === 'generate-moc') setMocGroups(data.groups || [])
      else setPipelineResult(data)
    } catch (error) {
      log.error('Failed to run Knowledge Base pipeline', error)
    } finally {
      setIsRunningPipeline(false)
    }
  }

  const loadStructured = useCallback(async () => {
    setIsLoadingStructured(true)
    try {
      const params = new URLSearchParams(kbParams)
      if (structuredQuery.trim()) params.set('q', structuredQuery)
      params.set('type', structuredType)
      const response = await fetch(`/api/knowledge-base/structured?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load structured knowledge')
      setStructuredEntries(data.results || [])
    } catch (error) {
      log.error('Failed to load structured knowledge', error)
      setStructuredEntries([])
    } finally {
      setIsLoadingStructured(false)
    }
  }, [kbParams, structuredQuery, structuredType])

  useEffect(() => {
    if (activeTab === 'structured') void loadStructured()
  }, [activeTab, loadStructured])

  const loadMemory = useCallback(async () => {
    setIsLoadingMemory(true)
    try {
      const response = await fetch(`/api/knowledge-base/memory?${kbParams.toString()}`)
      const data = await response.json()
      if (response.ok) setHermesMemory(data)
    } catch (error) {
      log.error('Failed to load Hermes memory', error)
    } finally {
      setIsLoadingMemory(false)
    }
  }, [kbParams])

  useEffect(() => {
    if (activeTab === 'memory' && !hermesMemory) void loadMemory()
  }, [activeTab, hermesMemory, loadMemory])

  const loadGovernanceQueue = useCallback(async () => {
    setIsLoadingGovernanceQueue(true)
    try {
      const response = await fetch(`/api/knowledge-base/governance?${kbParams.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load governance queue')
      setGovernanceQueue(data)
    } catch (error) {
      log.error('Failed to load Knowledge Base governance queue', error)
      setGovernanceQueue(null)
    } finally {
      setIsLoadingGovernanceQueue(false)
    }
  }, [kbParams])

  useEffect(() => {
    if (activeTab === 'governance' && !governanceQueue) void loadGovernanceQueue()
  }, [activeTab, governanceQueue, loadGovernanceQueue])

  const backfillGovernance = async () => {
    setIsBackfillingGovernance(true)
    try {
      const response = await fetch('/api/knowledge-base/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backfill', runtimeProfileName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to backfill governance records')
      await loadGovernanceQueue()
      if (!selectedPath) return
      await loadFile(selectedPath, selectedScope)
    } catch (error) {
      log.error('Failed to backfill Knowledge Base governance', error)
    } finally {
      setIsBackfillingGovernance(false)
    }
  }

  const canEditSelectedWiki = selectedScope === 'wiki' && selectedContent && !selectedContent.readOnly
  const fileCount = useMemo(() => countFiles(wikiFiles), [wikiFiles])
  const sizeTotal = useMemo(() => totalSize(wikiFiles), [wikiFiles])

  const renderTree = (files: FileNode[], depth = 0): React.ReactElement[] => files.map((file) => {
    const isDirectory = file.type === 'directory'
    const isExpanded = expandedFolders.has(file.path)
    const isSelected = selectedScope === 'wiki' && selectedPath === file.path
    return (
      <div key={file.path}>
        <div
          className={`flex items-center gap-1 py-[3px] pr-2 cursor-pointer text-[13px] font-mono hover:bg-[hsl(var(--surface-2))] rounded-sm transition-colors duration-75 ${isSelected ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground'}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => void (isDirectory ? toggleFolder(file.path, file.children === undefined) : loadFile(file.path, 'wiki'))}
        >
          {isDirectory ? (
            <span className={`text-[10px] w-3 text-center shrink-0 transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}>&#9656;</span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="text-[11px] w-4 text-center shrink-0 text-muted-foreground/40">
            {isDirectory ? '/' : iconForFile(file.name)}
          </span>
          <span className="truncate flex-1">{file.name}</span>
          {!isDirectory && file.readOnly && <span className="text-[10px] text-amber-300/60">ro</span>}
        </div>
        {isDirectory && isExpanded && file.children && renderTree(file.children, depth + 1)}
      </div>
    )
  })

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 font-mono">Knowledge Base</div>
        <div className="w-px h-4 bg-border mx-1" />
        {(['wiki', 'graph', 'health', 'pipeline', 'governance', 'structured', 'memory'] as PanelTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors capitalize ${activeTab === tab ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab}
          </button>
        ))}
        <div className="flex-1" />
        {runtimeProfiles.length > 0 && (
          <select
            value={runtimeProfileName}
            onChange={(event) => setRuntimeProfileName(event.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
          >
            {runtimeProfiles.map((profile) => (
              <option key={profile.name} value={profile.name}>{profile.label || profile.name}</option>
            ))}
            <option value="global" className="font-bold text-accent">Super Agent (Global Search)</option>
          </select>
        )}
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">{t('fileCountSize', { count: fileCount, size: formatFileSize(sizeTotal) })}</span>
        {isHydratingTree && <span className="text-[10px] text-muted-foreground/35 font-mono">{t('indexing')}</span>}
        <Button size="sm" variant="secondary" onClick={() => setShowCreateModal(true)} className="font-mono text-xs">
          {t('newFile')}
        </Button>
      </div>

      {activeTab === 'wiki' && (
        <div className="flex flex-1 min-h-0">
          <aside className="w-72 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
            <div className="p-3 space-y-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void performSearch()}
                placeholder="Search wiki pages..."
                className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
              <div className="flex flex-wrap gap-1">
                {(['all', 'entities', 'concepts', 'comparisons', 'queries', 'articles', 'raw'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setPageFilter(filter)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${pageFilter === filter ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            {searchResults.length > 0 && (
              <div className="px-3 pb-3 border-b border-border/50">
                <div className="text-[10px] text-muted-foreground/50 font-mono mb-2">{t('searchResults', { count: searchResults.length })}</div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {searchResults.map((result) => (
                  <button
                    key={result.path}
                    onClick={() => void loadFile(result.path, 'wiki')}
                    className="block w-full text-left p-2 rounded bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))]"
                  >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs font-mono text-foreground truncate flex-1">
                          {(result as any).profileName && <span className="text-accent opacity-70 mr-2">[{(result as any).profileName}]</span>}
                          {result.path}
                        </div>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-[0.12em] ${governanceBadgeClass(result.governance.reviewStatus)}`}>
                          {result.governance.reviewStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">{result.snippet}</div>
                      <div className="mt-1 text-[10px] font-mono text-muted-foreground/60">
                        {result.governance.qualityLabel} · {result.governance.riskLevel} risk · {result.matches} hits
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto py-2">
              {isLoadingTree ? (
                <div className="flex items-center justify-center h-24"><Loader variant="inline" /></div>
              ) : filteredFiles.length > 0 ? (
                renderTree(filteredFiles)
              ) : (
                <div className="px-4 py-8 text-sm text-muted-foreground">
                  {emptyStateMessage || 'No wiki pages yet.'}
                </div>
              )}
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex">
            <div className="flex-1 min-w-0 flex flex-col">
              {selectedPath && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-[hsl(var(--surface-0))]">
                  <span className="text-xs font-mono text-muted-foreground/60 truncate flex-1">{selectedPath}</span>
                  {selectedContent?.readOnly && <span className="text-[10px] font-mono text-amber-300/70">read-only</span>}
                  {selectedScope === 'wiki' && (
                    <button
                      onClick={() => setLinksOpen((current) => !current)}
                      className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${linksOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]'}`}
                    >
                      {t('links')}
                    </button>
                  )}
                  {canEditSelectedWiki && !isEditing && (
                    <>
                      <button onClick={() => setIsEditing(true)} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))]">{t('edit')}</button>
                      <button onClick={() => setShowDeleteConfirm(true)} className="px-2 py-0.5 text-[11px] font-mono text-red-400/60 hover:text-red-400 rounded hover:bg-red-500/10">{t('delete')}</button>
                    </>
                  )}
                  {canEditSelectedWiki && isEditing && (
                    <>
                      <button onClick={() => void saveFile()} disabled={isSaving} className="px-2 py-0.5 text-[11px] font-mono text-green-400/80 hover:text-green-400 rounded hover:bg-green-500/10">{isSaving ? t('saving') : t('save')}</button>
                      <button onClick={() => { setIsEditing(false); setEditedContent(selectedContent?.content || '') }} className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))]">{t('cancel')}</button>
                    </>
                  )}
                </div>
              )}
              {schemaWarnings.length > 0 && (
                <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/15">
                  <div className="text-[11px] font-mono text-amber-400">{t('schemaWarnings')}</div>
                  {schemaWarnings.map((warning) => <div key={warning} className="text-[11px] font-mono text-amber-400/70">- {warning}</div>)}
                </div>
              )}
              {selectedScope === 'wiki' && selectedPath && (
                <KnowledgeBaseGovernanceEditor
                  value={governanceForm}
                  review={governanceReview}
                  editable={Boolean(canEditSelectedWiki && isEditing)}
                  error={governanceError}
                  onChange={setGovernanceForm}
                />
              )}
              <div className="flex-1 overflow-auto">
                {isLoadingContent ? (
                  <div className="flex items-center justify-center h-full"><Loader variant="inline" /></div>
                ) : selectedContent ? (
                  <div className="p-6 max-w-4xl">
                    {selectedContent.obsidian?.vaultBacked && (
                      <div className="mb-4 rounded-xl border border-border bg-[hsl(var(--surface-1))] px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground/60">
                          <span>Obsidian</span>
                          {selectedContent.obsidian.syncStatus && (
                            <span className="px-2 py-0.5 rounded border border-border/70 text-foreground/80">
                              {selectedContent.obsidian.syncStatus.replace(/_/g, ' ')}
                            </span>
                          )}
                          {selectedContent.obsidian.conflictState && selectedContent.obsidian.conflictState !== 'none' && (
                            <span className="px-2 py-0.5 rounded border border-red-500/20 bg-red-500/10 text-red-200">
                              conflict: {selectedContent.obsidian.conflictState}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-[11px] font-mono text-muted-foreground/60">Vault Path</div>
                            <div className="mt-1 font-mono text-xs text-foreground/80 break-all">{selectedContent.obsidian.vaultRelativePath || '—'}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-mono text-muted-foreground/60">File UUID</div>
                            <div className="mt-1 font-mono text-xs text-foreground/80 break-all">{selectedContent.obsidian.fileUuid || '—'}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-mono text-muted-foreground/60">Attachments</div>
                            <div className="mt-1 text-foreground/80">{selectedContent.obsidian.attachmentRefs.length} indexed</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-mono text-muted-foreground/60">Canvas Membership</div>
                            <div className="mt-1 text-foreground/80">{selectedContent.obsidian.canvasRefs.length} references</div>
                          </div>
                        </div>
                      </div>
                    )}
                    {isEditing ? (
                      <textarea
                        value={editedContent}
                        onChange={(event) => setEditedContent(event.target.value)}
                        className="w-full min-h-[560px] p-3 bg-[hsl(var(--surface-1))] text-foreground font-mono text-sm border border-border/50 rounded-md resize-none focus:outline-none focus:border-primary/30 leading-relaxed"
                      />
                    ) : selectedPath.endsWith('.md') ? (
                      <MarkdownRenderer content={selectedContent.content} />
                    ) : selectedPath.endsWith('.json') ? (
                      <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">{selectedContent.content}</pre>
                    ) : (
                      <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">{selectedContent.content}</pre>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground px-6 text-center">
                    {emptyStateMessage || 'Choose a wiki page, structured mirror, or graph node to inspect the knowledge base.'}
                  </div>
                )}
              </div>
            </div>
            {linksOpen && linksData && (
              <LinksSidebar
                links={linksData}
                onOpenWiki={(path) => void loadFile(path, 'wiki')}
              />
            )}
          </div>
        </div>
      )}

      {activeTab === 'graph' && (
        <div className="flex-1 overflow-hidden p-4">
          <KnowledgeBaseGraph runtimeProfileName={runtimeProfileName} onOpenFile={(path) => void loadFile(path, 'wiki')} />
        </div>
      )}

      {activeTab === 'health' && (
        <div className="flex-1 overflow-auto p-6">
          <HealthView report={healthReport} isLoading={isLoadingHealth} onRefresh={() => void loadHealth()} />
        </div>
      )}

      {activeTab === 'pipeline' && (
        <div className="flex-1 overflow-auto p-6">
          <PipelineView
            result={pipelineResult}
            mocGroups={mocGroups}
            isRunning={isRunningPipeline}
            onRunAction={(action) => void runPipeline(action)}
            onOpenFile={(path) => void loadFile(path, 'wiki')}
          />
        </div>
      )}

      {activeTab === 'governance' && (
        <div className="flex-1 overflow-auto p-6">
          <GovernanceQueueView
            queue={governanceQueue}
            isLoading={isLoadingGovernanceQueue}
            isBackfilling={isBackfillingGovernance}
            onRefresh={() => void loadGovernanceQueue()}
            onBackfill={() => void backfillGovernance()}
            onOpenFile={(path) => void loadFile(path, 'wiki')}
          />
        </div>
      )}

      {activeTab === 'structured' && (
        <div className="flex flex-1 min-h-0">
          <aside className="w-80 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col min-h-0">
            <div className="p-3 space-y-2">
              <input
                type="text"
                value={structuredQuery}
                onChange={(event) => setStructuredQuery(event.target.value)}
                placeholder="Search structured knowledge..."
                className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
              <div className="flex gap-2">
                <select
                  value={structuredType}
                  onChange={(event) => setStructuredType(event.target.value as typeof structuredType)}
                  className="flex-1 px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
                >
                  <option value="all">all</option>
                  <option value="people">people</option>
                  <option value="projects">projects</option>
                  <option value="decisions">decisions</option>
                  <option value="notes">notes</option>
                </select>
                <Button size="sm" variant="secondary" onClick={() => void loadStructured()} className="font-mono text-xs">refresh</Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
              {isLoadingStructured ? (
                <div className="flex items-center justify-center h-24"><Loader variant="inline" /></div>
              ) : structuredEntries.length === 0 ? (
                <div className="text-sm text-muted-foreground p-3">No structured entries matched this view.</div>
              ) : (
                structuredEntries.map((entry) => (
                  <button
                    key={`${entry.type}-${entry.id}`}
                    onClick={() => setSelectedStructuredEntry(entry)}
                    className={`w-full text-left p-3 rounded-lg border ${selectedStructuredEntry?.id === entry.id && selectedStructuredEntry?.type === entry.type ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-[hsl(var(--surface-1))] hover:bg-[hsl(var(--surface-2))]'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">{entry.type}</span>
                      {entry.status && <span className="text-[10px] font-mono text-primary/70">{entry.status}</span>}
                    </div>
                    <div className="text-sm font-semibold text-foreground">{entry.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{entry.summary}</div>
                  </button>
                ))
              )}
            </div>
          </aside>
          <div className="flex-1 overflow-auto p-6">
            {!selectedStructuredEntry ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground text-center px-6">
                Select a person, project, decision, or note from Hermes structured knowledge.
              </div>
            ) : (
              <div className="max-w-3xl space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">{selectedStructuredEntry.type}</div>
                    <h2 className="text-2xl font-semibold text-foreground mt-1">{selectedStructuredEntry.title}</h2>
                  </div>
                  {selectedStructuredEntry.linkedPath && (
                    <Button size="sm" variant="secondary" onClick={() => void loadFile(selectedStructuredEntry.linkedPath || '', 'structured')}>
                      open mirrored note
                    </Button>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="text-sm text-foreground/85 whitespace-pre-wrap">{selectedStructuredEntry.summary || 'No summary available.'}</div>
                  {selectedStructuredEntry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {selectedStructuredEntry.tags.map((tag) => (
                        <span key={tag} className="px-2 py-1 rounded bg-[hsl(var(--surface-1))] text-xs font-mono text-muted-foreground">#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                {selectedScope === 'structured' && selectedPath === selectedStructuredEntry.linkedPath && selectedContent && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="text-xs font-mono text-muted-foreground mb-3">{selectedPath}</div>
                    <MarkdownRenderer content={selectedContent.content} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'memory' && (
        <div className="flex-1 overflow-auto p-6">
          <HermesMemoryView data={hermesMemory} isLoading={isLoadingMemory} onRefresh={() => void loadMemory()} />
        </div>
      )}

      {showCreateModal && (
        <CreateWikiFileModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(path, content, governance) => createFile(path, content, governance)}
        />
      )}
      {showDeleteConfirm && selectedPath && (
        <DeleteConfirmModal
          filePath={selectedPath}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => void deleteFile()}
        />
      )}
    </div>
  )
}

function LinksSidebar({ links, onOpenWiki }: {
  links: { incoming: string[]; outgoing: string[]; wikiLinks: { target: string; display: string; line: number }[] }
  onOpenWiki: (path: string) => void
}) {
  const t = useTranslations('memoryBrowser')
  return (
    <aside className="w-64 shrink-0 border-l border-border bg-[hsl(var(--surface-0))] overflow-y-auto">
      <div className="p-4 border-b border-border/50">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">{t('outgoing', { count: links.outgoing.length })}</div>
        {links.outgoing.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-1">
            {links.outgoing.map((path) => (
              <button key={path} onClick={() => onOpenWiki(path)} className="block w-full text-left px-1.5 py-1 rounded text-[11px] font-mono text-primary/70 hover:text-primary hover:bg-[hsl(var(--surface-2))] truncate">
                {path}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-4 border-b border-border/50">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">{t('backlinks', { count: links.incoming.length })}</div>
        {links.incoming.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-1">
            {links.incoming.map((path) => (
              <button key={path} onClick={() => onOpenWiki(path)} className="block w-full text-left px-1.5 py-1 rounded text-[11px] font-mono text-primary/70 hover:text-primary hover:bg-[hsl(var(--surface-2))] truncate">
                {path}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">{t('wikiLinks', { count: links.wikiLinks.length })}</div>
        {links.wikiLinks.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/30">none</div>
        ) : (
          <div className="space-y-1">
            {links.wikiLinks.map((link, index) => (
              <div key={`${link.target}-${index}`} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                <span className="text-muted-foreground/30 tabular-nums shrink-0">L{link.line}</span>
                <span className="text-primary/60 truncate">[[{link.target}]]</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function HealthView({ report, isLoading, onRefresh }: { report: HealthReport | null; isLoading: boolean; onRefresh: () => void }) {
  const t = useTranslations('memoryBrowser')
  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader variant="inline" label={t('runningDiagnostics')} /></div>
  }
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
        <span className="text-sm font-mono">{t('noHealthData')}</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('runDiagnostics')}</Button>
      </div>
    )
  }
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <div className={`text-4xl font-bold font-mono tabular-nums ${statusColor(report.overall)}`}>{report.overallScore}</div>
        <div>
          <div className={`text-sm font-semibold font-mono uppercase ${statusColor(report.overall)}`}>{report.overall}</div>
          <div className="text-[11px] text-muted-foreground/50 font-mono">{t('healthCategories', { time: new Date(report.generatedAt).toLocaleTimeString() })}</div>
        </div>
        <div className="flex-1" />
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('refresh')}</Button>
      </div>
      <div className="grid gap-3">
        {report.categories.map((category) => (
          <div key={category.name} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-lg font-bold font-mono tabular-nums ${statusColor(category.status)}`}>{category.score}</span>
              <span className="text-sm font-mono text-foreground flex-1">{category.name}</span>
              <span className={`text-[10px] font-mono uppercase ${statusColor(category.status)}`}>{category.status}</span>
            </div>
            <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full ${statusBar(category.status)}`} style={{ width: `${category.score}%`, opacity: 0.75 }} />
            </div>
            {category.issues.map((issue) => <div key={issue} className="text-[11px] font-mono text-muted-foreground/70">- {issue}</div>)}
            {category.suggestions.map((suggestion) => <div key={suggestion} className="text-[11px] font-mono text-primary/55">{suggestion}</div>)}
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineView({ result, mocGroups, isRunning, onRunAction, onOpenFile }: {
  result: { action: string; filesProcessed?: number; suggestions?: string[] } | null
  mocGroups: Array<{ directory: string; entries: { title: string; path: string; linkCount: number }[] }>
  isRunning: boolean
  onRunAction: (action: string) => void
  onOpenFile: (path: string) => void
}) {
  const t = useTranslations('memoryBrowser')
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold font-mono text-foreground mb-1">{t('pipelineTitle')}</h2>
        <p className="text-xs text-muted-foreground font-mono">{t('pipelineDesc')}</p>
      </div>
      <div className="grid md:grid-cols-5 gap-3">
        {[
          ['reflect', t('pipelineReflect'), t('pipelineReflectDesc')],
          ['reweave', t('pipelineReweave'), t('pipelineReweaveDesc')],
          ['generate-moc', t('pipelineGenerateMoc'), t('pipelineGenerateMocDesc')],
          ['gap-detect', 'Gap Detect', 'Spot under-covered areas in the wiki'],
          ['consolidate', 'Consolidate', 'Find pages that should likely be merged'],
        ].map(([action, label, description]) => (
          <button
            key={action}
            onClick={() => onRunAction(action)}
            disabled={isRunning}
            className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4 text-left hover:border-primary/30 transition-colors disabled:opacity-50"
          >
            <div className="text-sm font-semibold font-mono text-foreground mb-1">{label}</div>
            <div className="text-[11px] text-muted-foreground font-mono">{description}</div>
          </button>
        ))}
      </div>
      {isRunning && <Loader variant="inline" label={t('processing')} />}
      {result && (
        <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
          <div className="text-sm font-semibold font-mono text-foreground capitalize mb-2">{result.action}</div>
          {(result.suggestions || []).length === 0 ? (
            <div className="text-[11px] font-mono text-green-400/70">{t('noSuggestions')}</div>
          ) : (
            <div className="space-y-1">{(result.suggestions || []).map((suggestion) => <div key={suggestion} className="text-[11px] font-mono text-muted-foreground/80">{suggestion}</div>)}</div>
          )}
        </div>
      )}
      {mocGroups.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold font-mono text-foreground">{t('mapsOfContent', { count: mocGroups.length })}</div>
          {mocGroups.map((group) => (
            <div key={group.directory} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
              <div className="text-xs font-semibold font-mono text-foreground/80 mb-2">{group.directory}</div>
              <div className="space-y-1">
                {group.entries.map((entry) => (
                  <div key={entry.path} className="flex items-center gap-2">
                    <button onClick={() => onOpenFile(entry.path)} className="text-[11px] font-mono text-primary/70 hover:text-primary truncate flex-1 text-left">{entry.title}</button>
                    <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums shrink-0">{entry.linkCount} links</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GovernanceQueueView({
  queue,
  isLoading,
  isBackfilling,
  onRefresh,
  onBackfill,
  onOpenFile,
}: {
  queue: GovernanceQueuePayload | null
  isLoading: boolean
  isBackfilling: boolean
  onRefresh: () => void
  onBackfill: () => void
  onOpenFile: (path: string) => void
}) {
  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader variant="inline" label="Loading governance queue..." /></div>
  }

  if (!queue) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
        <span className="text-sm font-mono">No governance queue data yet.</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">refresh</Button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold font-mono text-foreground mb-1">Governance Queue</h2>
          <p className="text-xs text-muted-foreground font-mono">
            Review unreviewed, overridden, and warning-heavy pages before they quietly influence retrieval in high-risk domains.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onRefresh} size="sm" variant="secondary">refresh</Button>
          <Button onClick={onBackfill} size="sm" disabled={isBackfilling}>
            {isBackfilling ? 'backfilling...' : 'backfill existing pages'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {[
          ['Total pages', queue.totalPages],
          ['Unreviewed', queue.stats.unreviewed],
          ['Overrides', queue.stats.overridden],
          ['High risk', queue.stats.highRisk],
          ['Backfill needed', queue.stats.backfillEligible],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border/50 bg-[hsl(var(--surface-1))] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 font-mono">{label}</div>
            <div className="text-2xl font-semibold font-mono text-foreground mt-2">{value}</div>
          </div>
        ))}
      </div>

      {queue.stats.backfillEligible > 0 && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-sm text-sky-100">
          {queue.stats.backfillEligible} page{queue.stats.backfillEligible === 1 ? '' : 's'} still have no persisted governance record. Backfill creates explicit
          <span className="font-mono"> unreviewed </span>
          records so they show up in audits and search ranking instead of blending in silently.
        </div>
      )}

      <div className="space-y-3">
        {queue.items.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-[hsl(var(--surface-1))] px-4 py-6 text-sm text-muted-foreground">
            No pages matched the current governance queue.
          </div>
        ) : queue.items.map((item) => (
          <div key={item.path} className="rounded-xl border border-border/50 bg-[hsl(var(--surface-1))] px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => onOpenFile(item.path)} className="text-left text-sm font-mono text-foreground hover:text-primary truncate">
                    {item.path}
                  </button>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-[0.12em] ${governanceBadgeClass(item.record.reviewStatus)}`}>
                    {item.record.reviewStatus.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground/60">
                    {item.record.domain} · {item.record.riskLevel} risk · {item.record.qualityLabel}
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {item.record.overrideUsed && item.record.overrideReason
                    ? `Override recorded: ${item.record.overrideReason}`
                    : item.record.warnings[0]?.message || 'No warnings recorded.'}
                </div>
                <div className="mt-2 text-[11px] font-mono text-muted-foreground/60">
                  {item.record.warnings.length} warnings
                  {item.record.actor ? ` · reviewer ${item.record.actor}` : ''}
                  {!item.current ? ' · synthetic / awaiting backfill' : ''}
                </div>
              </div>
              <Button onClick={() => onOpenFile(item.path)} size="sm" variant="secondary">open</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HermesMemoryView({ data, isLoading, onRefresh }: { data: HermesMemoryPayload | null; isLoading: boolean; onRefresh: () => void }) {
  const t = useTranslations('memoryBrowser')
  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader variant="inline" label={t('loadingHermes')} /></div>
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
        <span className="text-sm font-mono">{t('noHermesData')}</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('refresh')}</Button>
      </div>
    )
  }
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono text-foreground mb-1">Agent Memory</h2>
          <p className="text-xs text-muted-foreground font-mono">Read-only Hermes persistent memory for runtime profile <span className="text-foreground">{data.runtimeProfileName}</span>.</p>
        </div>
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('refresh')}</Button>
      </div>
      <div className="grid gap-4">
        {[
          ['MEMORY.md', data.agentMemory, data.agentMemoryEntries, data.agentMemorySize],
          ['USER.md', data.userMemory, data.userMemoryEntries, data.userMemorySize],
        ].map(([name, content, entries, size]) => (
          <div key={name} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold font-mono text-foreground">{name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{entries} entries · {size} chars</div>
            </div>
            {typeof content === 'string' && content.length > 0 ? (
              <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed max-h-80 overflow-y-auto bg-[hsl(var(--surface-0))] rounded-md p-3 border border-border/30">{content}</pre>
            ) : (
              <div className="text-xs font-mono text-muted-foreground/40 py-4 text-center">No file found.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function CreateWikiFileModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (
    path: string,
    content: string,
    governance: GovernanceFormState,
  ) => Promise<{ ok: boolean; error: string | null; governance: KnowledgeBaseGovernanceReview | KnowledgeBaseGovernanceRecord | null }>
}) {
  const t = useTranslations('memoryBrowser')
  const [directory, setDirectory] = useState('entities/')
  const [fileName, setFileName] = useState('')
  const [fileType, setFileType] = useState('md')
  const [content, setContent] = useState('# New Page\n\n')
  const [governanceForm, setGovernanceForm] = useState<GovernanceFormState>(createDefaultGovernanceForm())
  const [governanceReview, setGovernanceReview] = useState<KnowledgeBaseGovernanceReview | KnowledgeBaseGovernanceRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleCreate = async () => {
    if (!fileName.trim()) return
    setIsSubmitting(true)
    setError(null)
    const result = await onCreate(`${directory}${fileName.trim()}.${fileType}`, content, governanceForm)
    setGovernanceReview(result.governance)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error || 'Failed to create file')
    }
    setIsSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-3xl w-full p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-foreground font-mono">{t('newFileTitle')}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">x</button>
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('directory')}</label>
              <select value={directory} onChange={(event) => setDirectory(event.target.value)} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground">
                <option value="entities/">entities/</option>
                <option value="concepts/">concepts/</option>
                <option value="comparisons/">comparisons/</option>
                <option value="queries/">queries/</option>
                <option value="articles/">articles/</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('fileName')}</label>
              <input value={fileName} onChange={(event) => setFileName(event.target.value)} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground" placeholder="my-page" />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('fileType')}</label>
              <select value={fileType} onChange={(event) => setFileType(event.target.value)} className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground">
                <option value="md">.md</option>
                <option value="txt">.txt</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">{t('content')}</label>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} className="w-full h-28 px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground resize-none" />
          </div>

          <KnowledgeBaseGovernanceEditor
            value={governanceForm}
            review={governanceReview}
            editable
            error={error}
            onChange={setGovernanceForm}
          />

          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => void handleCreate()}
              disabled={!fileName.trim() || isSubmitting}
              size="sm"
              className="flex-1"
            >
              {isSubmitting ? 'creating...' : t('create')}
            </Button>
            <Button onClick={onClose} variant="secondary" size="sm">{t('cancel')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ filePath, onClose, onConfirm }: { filePath: string; onClose: () => void; onConfirm: () => void }) {
  const t = useTranslations('memoryBrowser')
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-sm w-full p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-red-400 font-mono mb-3">{t('deleteFileTitle')}</h3>
        <div className="bg-red-500/5 border border-red-500/15 rounded-md p-3 mb-4">
          <p className="text-xs text-muted-foreground font-mono">{t('permanentlyDelete')}</p>
          <p className="text-xs font-mono text-foreground mt-1 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">{filePath}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onConfirm} variant="destructive" size="sm" className="flex-1">{t('delete')}</Button>
          <Button onClick={onClose} variant="secondary" size="sm">{t('cancel')}</Button>
        </div>
      </div>
    </div>
  )
}
