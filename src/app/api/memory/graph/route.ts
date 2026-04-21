import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { buildLinkGraph } from '@/lib/memory-utils'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'

const LEGACY_ROUTE = { canonicalPath: '/api/knowledge-base/graph' } as const

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return decorateLegacyMemoryResponse(limited, LEGACY_ROUTE)

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action: 'graph',
      ...LEGACY_ROUTE,
    })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return legacyMemoryJson({
        agents: [],
        nodes: [],
        edges: [],
        totalFiles: 0,
        totalLinks: 0,
        initialized: false,
        emptyStateMessage: context.firstRunReason,
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    const graph = await buildLinkGraph(context.wikiRoot)
    const nodes = Object.values(graph.nodes).map((node) => ({
      id: node.path,
      path: node.path,
      name: node.name.replace(/\.[^.]+$/, ''),
      pageType: node.path.split('/')[0] || 'root',
      outgoingCount: node.outgoing.length,
      incomingCount: node.incoming.length,
      linkCount: node.outgoing.length + node.incoming.length,
      hasSchema: node.schema !== null,
    }))
    const edges = Object.values(graph.nodes).flatMap((node) => node.outgoing.map((target) => ({
      id: `${node.path}=>${target}`,
      source: node.path,
      target,
    })))

    return legacyMemoryJson({
      agents: [],
      nodes,
      edges,
      totalFiles: graph.totalFiles,
      totalLinks: graph.totalLinks,
      orphans: graph.orphans,
      initialized: true,
      runtimeProfileName: context.runtimeProfile.name,
    }, LEGACY_ROUTE)
  } catch (err) {
    logger.error({ err }, 'Legacy memory graph API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
