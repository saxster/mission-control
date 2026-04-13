import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { reflectPass, reweavePass, generateMOCs, gapDetectPass, consolidatePass } from '@/lib/memory-utils'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'

const LEGACY_ROUTE = { canonicalPath: '/api/knowledge-base/process' } as const

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return decorateLegacyMemoryResponse(rateCheck, LEGACY_ROUTE)

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const action = typeof body?.action === 'string' ? body.action : ''
    const context = getKnowledgeBaseContext(runtimeProfileName)

    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action,
      ...LEGACY_ROUTE,
    })

    if (!context.wikiExists) {
      return legacyMemoryJson(
        { error: context.firstRunReason || 'Knowledge Base wiki not initialized' },
        LEGACY_ROUTE,
        { status: 400 },
      )
    }

    if (action === 'reflect') return legacyMemoryJson(await reflectPass(context.wikiRoot), LEGACY_ROUTE)
    if (action === 'reweave') return legacyMemoryJson(await reweavePass(context.wikiRoot), LEGACY_ROUTE)
    if (action === 'gap-detect') return legacyMemoryJson(await gapDetectPass(context.wikiRoot), LEGACY_ROUTE)
    if (action === 'consolidate') return legacyMemoryJson(await consolidatePass(context.wikiRoot), LEGACY_ROUTE)

    if (action === 'generate-moc') {
      const groups = await generateMOCs(context.wikiRoot)
      return legacyMemoryJson({
        action: 'generate-moc',
        groups,
        totalGroups: groups.length,
        totalEntries: groups.reduce((sum, group) => sum + group.entries.length, 0),
      }, LEGACY_ROUTE)
    }

    return legacyMemoryJson(
      { error: 'Invalid action. Use: reflect, reweave, generate-moc, gap-detect, consolidate' },
      LEGACY_ROUTE,
      { status: 400 },
    )
  } catch (err) {
    logger.error({ err }, 'Legacy memory process API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
