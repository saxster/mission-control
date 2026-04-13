import { NextRequest, NextResponse } from 'next/server'
import { authenticateObsidianRequest } from '@/lib/obsidian-auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { updateObsidianPluginConnection } from '@/lib/obsidian'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = authenticateObsidianRequest(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const status = body?.action === 'disconnect' ? 'disconnected' : 'connected'
    updateObsidianPluginConnection(context, {
      clientId: typeof body?.clientId === 'string' && body.clientId ? body.clientId : 'obsidian-desktop',
      clientName: typeof body?.clientName === 'string' && body.clientName ? body.clientName : 'Hermes Obsidian Plugin',
      clientVersion: typeof body?.clientVersion === 'string' ? body.clientVersion : null,
      vaultName: typeof body?.vaultName === 'string' ? body.vaultName : null,
      status,
      metadata: typeof body?.metadata === 'object' && body.metadata ? body.metadata : {},
    })
    return NextResponse.json({ ok: true, status })
  } catch (err) {
    logger.error({ err }, 'Obsidian connect API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
