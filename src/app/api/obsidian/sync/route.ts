import { NextRequest, NextResponse } from 'next/server'
import { authenticateObsidianRequest } from '@/lib/obsidian-auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { syncObsidianNote, syncObsidianVault } from '@/lib/obsidian'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = authenticateObsidianRequest(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({}))
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const action = body?.action === 'sync_note' ? 'sync_note' : 'reconcile'
    const path = typeof body?.path === 'string' ? body.path : ''
    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (action === 'sync_note' && !path) {
      return NextResponse.json({ error: 'path is required for sync_note' }, { status: 400 })
    }
    const result = action === 'sync_note'
      ? syncObsidianNote(context, path)
      : syncObsidianVault(context)
    return NextResponse.json(result, { status: result.checkpointStatus === 'ok' ? 200 : 500 })
  } catch (err) {
    logger.error({ err }, 'Obsidian sync API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
