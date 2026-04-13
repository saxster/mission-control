import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getKnowledgeBaseContext, isKnowledgeBaseWikiPathAllowed, readKnowledgeBaseContent } from '@/lib/knowledge-base'
import { validateSchema } from '@/lib/memory-utils'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const path = (searchParams.get('path') || '').trim()

    if (!path) {
      return NextResponse.json({ error: 'Path required' }, { status: 400 })
    }

    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!isKnowledgeBaseWikiPathAllowed(context, path)) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    const doc = await readKnowledgeBaseContent(context, path, 'wiki')
    return NextResponse.json({
      ...doc,
      runtimeProfileName: context.runtimeProfile.name,
      scope: 'wiki',
      schema: doc.path.endsWith('.md') ? validateSchema(doc.content) : null,
      legacy: true,
    })
  } catch (error) {
    const message = (error as Error).message || ''
    if (message.includes('Path not allowed')) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }
    if (message.includes('Knowledge Base wiki not initialized')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    logger.error({ err: error }, 'GET /api/docs/content legacy route error')
    return NextResponse.json({ error: 'Failed to load knowledge base content' }, { status: 500 })
  }
}
