import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { generateContextPayload } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'

const LEGACY_ROUTE = { canonicalPath: '/api/knowledge-base/tree' } as const

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
      action: 'context',
      ...LEGACY_ROUTE,
    })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return legacyMemoryJson({
        fileTree: [],
        recentFiles: [],
        healthSummary: { overall: 'warning', score: 0 },
        maintenanceSignals: [],
        initialized: false,
        emptyStateMessage: context.firstRunReason,
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    const payload = await generateContextPayload(context.wikiRoot)
    return legacyMemoryJson({
      ...payload,
      initialized: true,
      runtimeProfileName: context.runtimeProfile.name,
    }, LEGACY_ROUTE)
  } catch (err) {
    logger.error({ err }, 'Legacy memory context API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
