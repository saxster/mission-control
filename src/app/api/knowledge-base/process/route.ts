import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { consolidatePass, gapDetectPass, generateMOCs, reflectPass, reweavePass } from '@/lib/memory-utils'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const action = typeof body?.action === 'string' ? body.action : ''
    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return NextResponse.json({ error: context.firstRunReason || 'Knowledge Base wiki not initialized' }, { status: 400 })
    }

    if (action === 'reflect') return NextResponse.json(await reflectPass(context.wikiRoot))
    if (action === 'reweave') return NextResponse.json(await reweavePass(context.wikiRoot))
    if (action === 'gap-detect') return NextResponse.json(await gapDetectPass(context.wikiRoot))
    if (action === 'consolidate') return NextResponse.json(await consolidatePass(context.wikiRoot))
    if (action === 'generate-moc') {
      const groups = await generateMOCs(context.wikiRoot)
      return NextResponse.json({
        action: 'generate-moc',
        groups,
        totalGroups: groups.length,
        totalEntries: groups.reduce((sum, group) => sum + group.entries.length, 0),
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: reflect, reweave, generate-moc, gap-detect, consolidate' }, { status: 400 })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base process API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
