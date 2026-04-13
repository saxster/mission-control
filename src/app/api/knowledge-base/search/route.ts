import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext, searchKnowledgeBase } from '@/lib/knowledge-base'
import { discoverHermesRuntimeProfiles } from '@/lib/hermes-runtime-profiles'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const query = request.nextUrl.searchParams.get('q') || request.nextUrl.searchParams.get('query') || ''
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get('limit') || '', 10)
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 200)) : 100
    if (!query.trim()) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    if (runtimeProfileName === 'global') {
      const allProfiles = discoverHermesRuntimeProfiles()
      const allResults = await Promise.all(
        allProfiles.map(async (profile) => {
          const context = getKnowledgeBaseContext(profile.name)
          const results = await searchKnowledgeBase(context, query, limit)
          return results.map(r => ({ ...r, profileName: profile.name })) // tag with profile
        })
      )
      const aggregatedResults = allResults.flat()
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
      return NextResponse.json({
        query,
        results: aggregatedResults,
        initialized: true,
        emptyStateMessage: null,
        runtimeProfileName: 'global',
      })
    }

    const context = getKnowledgeBaseContext(runtimeProfileName)
    const results = await searchKnowledgeBase(context, query, limit)
    return NextResponse.json({
      query,
      results,
      initialized: context.wikiExists,
      emptyStateMessage: context.firstRunReason,
      runtimeProfileName: context.runtimeProfile.name,
    })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base search API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
