'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { GraphCanvas, type GraphNode, type GraphEdge, type Theme } from 'reagraph'
import { Loader } from '@/components/ui/loader'

interface KnowledgeBaseGraphNode {
  id: string
  path: string
  name: string
  pageType: string
  outgoingCount: number
  incomingCount: number
  linkCount: number
  hasSchema: boolean
}

interface KnowledgeBaseGraphEdge {
  id: string
  source: string
  target: string
}

const PAGE_TYPE_COLORS: Record<string, string> = {
  entities: '#8bd5ca',
  concepts: '#91d7e3',
  comparisons: '#f5bde6',
  queries: '#c6a0f6',
  articles: '#eed49f',
  raw: '#f38ba8',
  root: '#a6adc8',
}

const graphTheme: Theme = {
  canvas: {
    background: '#11111b',
    fog: '#11111b',
  },
  node: {
    fill: '#6c7086',
    activeFill: '#cba6f7',
    opacity: 1,
    selectedOpacity: 1,
    inactiveOpacity: 0.18,
    label: {
      color: '#cdd6f4',
      stroke: '#11111b',
      activeColor: '#f5f5f7',
    },
  },
  ring: {
    fill: '#6c7086',
    activeFill: '#cba6f7',
  },
  edge: {
    fill: '#45475a',
    activeFill: '#cba6f7',
    opacity: 0.2,
    selectedOpacity: 0.65,
    inactiveOpacity: 0.08,
    label: {
      color: '#6c7086',
      activeColor: '#cdd6f4',
    },
  },
  arrow: {
    fill: '#45475a',
    activeFill: '#cba6f7',
  },
  lasso: {
    background: 'rgba(203, 166, 247, 0.08)',
    border: 'rgba(203, 166, 247, 0.25)',
  },
}

function buildNodeLabel(node: KnowledgeBaseGraphNode): string {
  return node.name.length > 28 ? `${node.name.slice(0, 25)}...` : node.name
}

export function KnowledgeBaseGraph({ runtimeProfileName, onOpenFile }: { runtimeProfileName?: string; onOpenFile: (path: string) => void }) {
  const [nodes, setNodes] = useState<KnowledgeBaseGraphNode[]>([])
  const [edges, setEdges] = useState<KnowledgeBaseGraphEdge[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPageType, setSelectedPageType] = useState('all')
  const [selectedNode, setSelectedNode] = useState<KnowledgeBaseGraphNode | null>(null)

  const loadGraph = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (runtimeProfileName) params.set('runtimeProfileName', runtimeProfileName)
      const response = await fetch(`/api/knowledge-base/graph?${params.toString()}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load graph')
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph')
      setNodes([])
      setEdges([])
    } finally {
      setIsLoading(false)
    }
  }, [runtimeProfileName])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return nodes.filter((node) => {
      if (selectedPageType !== 'all' && node.pageType !== selectedPageType) return false
      if (!q) return true
      return node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)
    })
  }, [nodes, searchQuery, selectedPageType])

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes])

  const graphNodes = useMemo<GraphNode[]>(() => (
    filteredNodes.map((node) => ({
      id: node.id,
      label: buildNodeLabel(node),
      fill: PAGE_TYPE_COLORS[node.pageType] || PAGE_TYPE_COLORS.root,
      size: Math.max(2, Math.min(10, 2 + Math.sqrt(Math.max(1, node.linkCount)))),
      data: node,
    }))
  ), [filteredNodes])

  const graphEdges = useMemo<GraphEdge[]>(() => (
    edges
      .filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        fill: '#585b70',
      }))
  ), [edges, filteredNodeIds])

  const pageTypes = useMemo(() => Array.from(new Set(nodes.map((node) => node.pageType))).sort(), [nodes])

  return (
    <div className="flex flex-col gap-4 h-full min-h-[640px]">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Filter graph nodes..."
          className="min-w-[240px] flex-1 px-3 py-2 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
        />
        <select
          value={selectedPageType}
          onChange={(event) => setSelectedPageType(event.target.value)}
          className="px-3 py-2 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
        >
          <option value="all">all page types</option>
          {pageTypes.map((pageType) => <option key={pageType} value={pageType}>{pageType}</option>)}
        </select>
        <button
          onClick={() => void loadGraph()}
          className="px-3 py-2 text-xs font-mono rounded border border-border/50 text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-1))]"
        >
          refresh
        </button>
      </div>

      <div className="grid flex-1 min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-[480px] rounded-xl border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader variant="inline" label="Loading wiki graph" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full px-6 text-sm text-red-300 text-center">{error}</div>
          ) : graphNodes.length === 0 ? (
            <div className="flex items-center justify-center h-full px-6 text-sm text-muted-foreground text-center">
              No wiki graph data yet. Create or connect a few pages and backlinks will appear here.
            </div>
          ) : (
            <GraphCanvas
              nodes={graphNodes}
              edges={graphEdges}
              theme={graphTheme}
              draggable
              layoutType="forceDirected2d"
              animated
              edgeArrowPosition="none"
              onNodeClick={(node) => setSelectedNode((node.data || null) as KnowledgeBaseGraphNode | null)}
            />
          )}
        </div>

        <aside className="rounded-xl border border-border bg-card p-4 overflow-auto">
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground/70 mb-3">Page Types</div>
          <div className="space-y-2 mb-6">
            {pageTypes.map((pageType) => (
              <div key={pageType} className="flex items-center gap-2 text-sm text-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PAGE_TYPE_COLORS[pageType] || PAGE_TYPE_COLORS.root }} />
                <span className="font-mono text-xs">{pageType}</span>
              </div>
            ))}
          </div>

          <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground/70 mb-3">Selected Node</div>
          {!selectedNode ? (
            <div className="text-sm text-muted-foreground">Choose a node to inspect its path and open the page.</div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-foreground">{selectedNode.name}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1 break-all">{selectedNode.path}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="rounded-lg bg-[hsl(var(--surface-1))] p-3">
                  <div className="text-muted-foreground/70">type</div>
                  <div className="text-foreground mt-1">{selectedNode.pageType}</div>
                </div>
                <div className="rounded-lg bg-[hsl(var(--surface-1))] p-3">
                  <div className="text-muted-foreground/70">links</div>
                  <div className="text-foreground mt-1">{selectedNode.linkCount}</div>
                </div>
                <div className="rounded-lg bg-[hsl(var(--surface-1))] p-3">
                  <div className="text-muted-foreground/70">incoming</div>
                  <div className="text-foreground mt-1">{selectedNode.incomingCount}</div>
                </div>
                <div className="rounded-lg bg-[hsl(var(--surface-1))] p-3">
                  <div className="text-muted-foreground/70">outgoing</div>
                  <div className="text-foreground mt-1">{selectedNode.outgoingCount}</div>
                </div>
              </div>
              <button
                onClick={() => onOpenFile(selectedNode.path)}
                className="w-full px-3 py-2 text-xs font-mono rounded bg-primary/10 text-primary hover:bg-primary/15"
              >
                open page
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
