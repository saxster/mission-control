import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { importKnowledgeBaseSources, listKnowledgeBaseSources, type KnowledgeSourceKind } from '@/lib/knowledge-base-sources'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    return NextResponse.json({
      runtimeProfileName: context.runtimeProfile.name,
      sources: listKnowledgeBaseSources(context),
    })
  } catch (error) {
    logger.error({ err: error }, 'Knowledge Base sources list API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const kind = String(body?.kind || '') as KnowledgeSourceKind
    const sources = importKnowledgeBaseSources({
      runtimeProfileName,
      kind,
      filePaths: Array.isArray(body?.filePaths) ? body.filePaths.map((value: unknown) => String(value)) : undefined,
      url: typeof body?.url === 'string' ? body.url : null,
      path: typeof body?.path === 'string' ? body.path : null,
      title: typeof body?.title === 'string' ? body.title : null,
      domain: typeof body?.domain === 'string' ? body.domain : null,
      teachCard: body?.teachCard ?? null,
    })
    return NextResponse.json({
      ok: true,
      sources,
      imported: sources.map((source) => source.id),
    })
  } catch (error) {
    logger.error({ err: error }, 'Knowledge Base source import API error')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
