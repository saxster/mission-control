import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { promoteKnowledgeBaseSource, type KnowledgeSourcePromoteTarget } from '@/lib/knowledge-base-sources'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const sourceID = typeof body?.sourceId === 'string' ? body.sourceId : ''
    const targetType = String(body?.targetType || '') as KnowledgeSourcePromoteTarget
    if (!sourceID) return NextResponse.json({ error: 'sourceId is required' }, { status: 400 })

    const result = await promoteKnowledgeBaseSource({
      runtimeProfileName,
      sourceID,
      targetType,
      title: typeof body?.title === 'string' ? body.title : null,
      domain: typeof body?.domain === 'string' ? body.domain : null,
      overrideReason: typeof body?.overrideReason === 'string' ? body.overrideReason : null,
      actor: auth.user.username || 'unknown',
    })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, governance: result.governance }, { status: result.status })
    }

    return NextResponse.json({
      ok: true,
      path: result.path,
      source: result.source,
      governance: result.governance,
    })
  } catch (error) {
    logger.error({ err: error }, 'Knowledge Base source promotion API error')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
