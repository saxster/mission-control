import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getKnowledgeBaseContext, getKnowledgeBaseTree } from '@/lib/knowledge-base'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const tree = await getKnowledgeBaseTree(context)
    return NextResponse.json({
      roots: context.wikiRoots,
      tree,
      initialized: context.wikiExists,
      emptyStateMessage: context.firstRunReason,
      runtimeProfileName: context.runtimeProfile.name,
      legacy: true,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/docs/tree legacy route error')
    return NextResponse.json({ error: 'Failed to load knowledge base tree' }, { status: 500 })
  }
}
