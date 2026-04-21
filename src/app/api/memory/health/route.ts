import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { runHealthDiagnostics } from '@/lib/memory-utils'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'

const LEGACY_ROUTE = { canonicalPath: '/api/knowledge-base/health' } as const

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
      action: 'health',
      ...LEGACY_ROUTE,
    })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return legacyMemoryJson({
        overall: 'warning',
        overallScore: 0,
        categories: [],
        generatedAt: Date.now(),
        initialized: false,
        emptyStateMessage: context.firstRunReason,
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    const report = await runHealthDiagnostics(context.wikiRoot)
    return legacyMemoryJson({
      ...report,
      initialized: true,
      runtimeProfileName: context.runtimeProfile.name,
    }, LEGACY_ROUTE)
  } catch (err) {
    logger.error({ err }, 'Legacy memory health API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
