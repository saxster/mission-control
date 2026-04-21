import { NextRequest, NextResponse } from 'next/server'
import { authenticateObsidianRequest } from '@/lib/obsidian-auth'
import { readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { getObsidianStatus } from '@/lib/obsidian'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = authenticateObsidianRequest(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const refresh = request.nextUrl.searchParams.get('refresh') === '1'
    const path = request.nextUrl.searchParams.get('path')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const status = getObsidianStatus(context, { refresh, path })
    return NextResponse.json(status)
  } catch (err) {
    logger.error({ err }, 'Obsidian status API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
