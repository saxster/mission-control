import { NextRequest, NextResponse } from 'next/server'
import { authenticateObsidianRequest } from '@/lib/obsidian-auth'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import { importObsidianCandidate, listObsidianImportCandidates, syncObsidianVault } from '@/lib/obsidian'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = authenticateObsidianRequest(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const refresh = request.nextUrl.searchParams.get('refresh') === '1'
    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (refresh) syncObsidianVault(context)
    return NextResponse.json({ imports: listObsidianImportCandidates(context) })
  } catch (err) {
    logger.error({ err }, 'Obsidian imports API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateObsidianRequest(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const path = typeof body?.path === 'string' ? body.path : ''
    const targetFolder = body?.targetFolder === 'Research' ? 'Research' : 'Notes'
    if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 })
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const result = importObsidianCandidate(context, path, targetFolder)
    return NextResponse.json({
      ok: true,
      imported: path,
      targetFolder,
      importedManagedPath: result.importedManagedPath,
      sync: result.sync,
    })
  } catch (err) {
    logger.error({ err }, 'Obsidian import API error')
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
  }
}
