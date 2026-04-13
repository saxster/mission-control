import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext, listStructuredKnowledge, type KnowledgeBaseStructuredType } from '@/lib/knowledge-base'
import { logger } from '@/lib/logger'

function normalizeType(value: string | null): KnowledgeBaseStructuredType | 'all' {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'all') return 'all'
  if (normalized === 'people') return 'person'
  if (normalized === 'projects') return 'project'
  if (normalized === 'decisions') return 'decision'
  if (normalized === 'notes') return 'note'
  if (normalized === 'person' || normalized === 'project' || normalized === 'decision' || normalized === 'note') {
    return normalized
  }
  return 'all'
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const query = request.nextUrl.searchParams.get('q') || request.nextUrl.searchParams.get('query') || ''
    const type = normalizeType(request.nextUrl.searchParams.get('type'))
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get('limit') || '', 10)
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 200)) : 100
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const results = listStructuredKnowledge(context, { query, type, limit })
    return NextResponse.json({
      results,
      runtimeProfileName: context.runtimeProfile.name,
      structuredVaultPath: context.structuredVaultPath,
      initialized: context.structuredFolders.length > 0,
      availableTypes: context.structuredFolders.map((folder) => ({
        type: folder.type,
        label: folder.label,
        rootPath: folder.rootPath,
      })),
    })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base structured API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
