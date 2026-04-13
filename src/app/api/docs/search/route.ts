import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getKnowledgeBaseContext, searchKnowledgeBase } from '@/lib/knowledge-base'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const query = (searchParams.get('q') || searchParams.get('query') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

    if (!query) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 })
    }

    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const results = await searchKnowledgeBase(context, query, limit)
    return NextResponse.json({
      query,
      results,
      count: results.length,
      initialized: context.wikiExists,
      emptyStateMessage: context.firstRunReason,
      runtimeProfileName: context.runtimeProfile.name,
      legacy: true,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/docs/search legacy route error')
    return NextResponse.json({ error: 'Failed to search knowledge base' }, { status: 500 })
  }
}
