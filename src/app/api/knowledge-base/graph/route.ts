import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { buildLinkGraph } from '@/lib/memory-utils'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return NextResponse.json({
        nodes: [],
        edges: [],
        totalFiles: 0,
        totalLinks: 0,
        initialized: false,
        emptyStateMessage: context.firstRunReason,
      })
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

    return NextResponse.json({
      nodes,
      edges,
      totalFiles: graph.totalFiles,
      totalLinks: graph.totalLinks,
      orphans: graph.orphans,
      initialized: true,
      runtimeProfileName: context.runtimeProfile.name,
    })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base graph API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
