import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { buildLinkGraph, extractWikiLinks } from '@/lib/memory-utils'
import { getKnowledgeBaseContext, isKnowledgeBaseWikiPathAllowed, resolveKnowledgeBaseContentPath } from '@/lib/knowledge-base'
import { readFile } from 'node:fs/promises'
import { logger } from '@/lib/logger'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'

const LEGACY_ROUTE = { canonicalPath: '/api/knowledge-base/links' } as const

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return decorateLegacyMemoryResponse(limited, LEGACY_ROUTE)

  const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
  const filePath = request.nextUrl.searchParams.get('file')

  try {
    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action: filePath ? 'links:file' : 'links',
      ...LEGACY_ROUTE,
    })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return legacyMemoryJson({
        nodes: [],
        totalFiles: 0,
        totalLinks: 0,
        orphans: [],
        initialized: false,
        emptyStateMessage: context.firstRunReason,
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    if (filePath) {
      if (!isKnowledgeBaseWikiPathAllowed(context, filePath)) {
        return legacyMemoryJson({ error: 'Path not allowed' }, LEGACY_ROUTE, { status: 403 })
      }
      const fullPath = await resolveKnowledgeBaseContentPath(context, filePath, 'wiki')
      const content = await readFile(fullPath, 'utf-8')
      const graph = await buildLinkGraph(context.wikiRoot)
      const node = graph.nodes[filePath]
      return legacyMemoryJson({
        file: filePath,
        wikiLinks: extractWikiLinks(content),
        outgoing: node?.outgoing ?? [],
        incoming: node?.incoming ?? [],
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    const graph = await buildLinkGraph(context.wikiRoot)
    const nodes = Object.values(graph.nodes).map((n) => ({
      path: n.path,
      name: n.name,
      outgoing: n.outgoing,
      incoming: n.incoming,
      linkCount: n.outgoing.length + n.incoming.length,
      hasSchema: n.schema !== null,
      pageType: n.path.split('/')[0] || 'root',
    }))

    return legacyMemoryJson({
      nodes,
      totalFiles: graph.totalFiles,
      totalLinks: graph.totalLinks,
      orphans: graph.orphans,
      initialized: true,
      runtimeProfileName: context.runtimeProfile.name,
    }, LEGACY_ROUTE)
  } catch (err) {
    logger.error({ err }, 'Legacy memory links API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
