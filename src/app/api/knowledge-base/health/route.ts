import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { runHealthDiagnostics } from '@/lib/memory-utils'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!context.wikiExists) {
      return NextResponse.json({
        overall: 'warning',
        overallScore: 0,
        categories: [],
        generatedAt: Date.now(),
        initialized: false,
        emptyStateMessage: context.firstRunReason,
      })
    }
    const report = await runHealthDiagnostics(context.wikiRoot)
    return NextResponse.json({
      ...report,
      initialized: true,
      runtimeProfileName: context.runtimeProfile.name,
    })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base health API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
