import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext, getKnowledgeBaseTree, isKnowledgeBaseWikiPathAllowed } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const path = request.nextUrl.searchParams.get('path') || undefined
    const depthParam = Number.parseInt(request.nextUrl.searchParams.get('depth') || '', 10)
    const depth = Number.isFinite(depthParam) ? Math.max(0, Math.min(depthParam, 8)) : Number.POSITIVE_INFINITY
    const context = getKnowledgeBaseContext(runtimeProfileName)

    if (path && !isKnowledgeBaseWikiPathAllowed(context, path)) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    const tree = await getKnowledgeBaseTree(context, { path, depth })
    return NextResponse.json({
      tree,
      roots: context.wikiRoots,
      writableRoots: context.writableWikiRoots,
      initialized: context.wikiExists,
      emptyStateMessage: context.firstRunReason,
      runtimeProfileName: context.runtimeProfile.name,
      wikiRoot: context.wikiRoot,
    })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base tree API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
