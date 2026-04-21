import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { buildLinkGraph, extractWikiLinks } from '@/lib/memory-utils'
import { getKnowledgeBaseContext, isKnowledgeBaseWikiPathAllowed, resolveKnowledgeBaseContentPath } from '@/lib/knowledge-base'
import { readFile } from 'node:fs/promises'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const filePath = request.nextUrl.searchParams.get('file')
    const context = getKnowledgeBaseContext(runtimeProfileName)

    if (!context.wikiExists) {
      return NextResponse.json({
        nodes: [],
        totalFiles: 0,
        totalLinks: 0,
        orphans: [],
        initialized: false,
        emptyStateMessage: context.firstRunReason,
      })
    }

    if (filePath) {
      if (!isKnowledgeBaseWikiPathAllowed(context, filePath)) {
        return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
      }
      const fullPath = await resolveKnowledgeBaseContentPath(context, filePath, 'wiki')
      const content = await readFile(fullPath, 'utf8')
      const graph = await buildLinkGraph(context.wikiRoot)
      const node = graph.nodes[filePath]
      return NextResponse.json({
        file: filePath,
        wikiLinks: extractWikiLinks(content),
        outgoing: node?.outgoing || [],
        incoming: node?.incoming || [],
      })
    }

    const graph = await buildLinkGraph(context.wikiRoot)
    const nodes = Object.values(graph.nodes).map((node) => ({
      path: node.path,
      name: node.name,
      outgoing: node.outgoing,
      incoming: node.incoming,
      linkCount: node.outgoing.length + node.incoming.length,
      hasSchema: node.schema !== null,
      pageType: node.path.split('/')[0] || 'root',
    }))
    return NextResponse.json({
      nodes,
      totalFiles: graph.totalFiles,
      totalLinks: graph.totalLinks,
      orphans: graph.orphans,
      initialized: true,
    })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base links API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
