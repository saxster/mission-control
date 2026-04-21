import { NextRequest, NextResponse } from 'next/server'
import { authenticateObsidianRequest } from '@/lib/obsidian-auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { resolveObsidianConflict } from '@/lib/obsidian'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = authenticateObsidianRequest(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const conflictId = Number(body?.conflictId)
    const resolution = body?.resolution
    if (!Number.isFinite(conflictId)) return NextResponse.json({ error: 'conflictId is required' }, { status: 400 })
    if (resolution !== 'keep_db' && resolution !== 'keep_vault' && resolution !== 'merged') {
      return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })
    }
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const result = resolveObsidianConflict(context, conflictId, resolution, auth.user.username || 'unknown')
    return NextResponse.json({ ok: true, conflictId, resolution, ...result })
  } catch (err) {
    logger.error({ err }, 'Obsidian resolve conflict API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
