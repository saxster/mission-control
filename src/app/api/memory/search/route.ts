import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getKnowledgeBaseContext, searchKnowledgeBase } from '@/lib/knowledge-base'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'

const LEGACY_ROUTE = { canonicalPath: '/api/knowledge-base/search' } as const

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return decorateLegacyMemoryResponse(limited, LEGACY_ROUTE)

  const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
  const query = request.nextUrl.searchParams.get('q') || request.nextUrl.searchParams.get('query')
  const limitParam = Number(request.nextUrl.searchParams.get('limit') || '20')
  const limit = Math.min(Math.max(1, limitParam), 100)

  logLegacyMemoryRouteHit({
    request,
    user: auth.user,
    runtimeProfileName,
    action: 'search',
    ...LEGACY_ROUTE,
  })

  if (!query) {
    return legacyMemoryJson({ error: 'Query parameter "q" is required' }, LEGACY_ROUTE, { status: 400 })
  }

  try {
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const results = await searchKnowledgeBase(context, query, limit)
    return legacyMemoryJson({
      query,
      results,
      count: results.length,
      initialized: context.wikiExists,
      emptyStateMessage: context.firstRunReason,
      runtimeProfileName: context.runtimeProfile.name,
    }, LEGACY_ROUTE)
  } catch (err) {
    logger.error({ err }, 'Legacy memory search API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return decorateLegacyMemoryResponse(rateCheck, LEGACY_ROUTE)

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null

    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action: typeof body?.action === 'string' ? body.action : 'unknown',
      ...LEGACY_ROUTE,
    })

    if (body.action === 'rebuild') {
      return legacyMemoryJson({
        success: true,
        message: 'Knowledge Base search no longer requires a manual rebuild; this compatibility action is now a no-op.',
        indexed: 0,
        duration: 0,
      }, LEGACY_ROUTE)
    }

    return legacyMemoryJson({ error: 'Invalid action. Use: rebuild' }, LEGACY_ROUTE, { status: 400 })
  } catch (err) {
    logger.error({ err }, 'Legacy memory search POST API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
