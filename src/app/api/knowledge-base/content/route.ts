import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'node:fs/promises'
import { requireRole } from '@/lib/auth'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'
import {
  getKnowledgeBaseContext,
  isKnowledgeBaseWikiPathWritable,
  isKnowledgeBaseStructuredPathAllowed,
  isKnowledgeBaseWikiPathAllowed,
  readKnowledgeBaseContent,
  resolveKnowledgeBaseContentPath,
  type KnowledgeBaseScope,
} from '@/lib/knowledge-base'
import { getObsidianContentMetadata } from '@/lib/obsidian'
import {
  getEffectiveKnowledgeBaseGovernanceRecord,
} from '@/lib/knowledge-base-governance'
import { performGovernedKnowledgeBaseWrite } from '@/lib/knowledge-base-content-write'
import { validateSchema } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const scope = (request.nextUrl.searchParams.get('scope') === 'structured' ? 'structured' : 'wiki') as KnowledgeBaseScope
    const path = request.nextUrl.searchParams.get('path')
    if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    const allowed = scope === 'structured'
      ? isKnowledgeBaseStructuredPathAllowed(context, path)
      : isKnowledgeBaseWikiPathAllowed(context, path)
    if (!allowed) return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })

    const data = await readKnowledgeBaseContent(context, path, scope)
    const governance = scope === 'wiki'
      ? getEffectiveKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, path)
      : null
    return NextResponse.json({
      ...data,
      runtimeProfileName: context.runtimeProfile.name,
      scope,
      schema: data.path.endsWith('.md') ? validateSchema(data.content) : null,
      governance,
      obsidian: getObsidianContentMetadata(context, path, scope),
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).message
    if (code === 'Knowledge Base wiki not initialized') {
      return NextResponse.json({ error: code }, { status: 404 })
    }
    logger.error({ err }, 'Knowledge Base content API error')
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
    const action = typeof body?.action === 'string' ? body.action : ''
    const path = typeof body?.path === 'string' ? body.path : ''
    const content = typeof body?.content === 'string' ? body.content : ''
    const obsidianBaseHash = typeof body?.obsidianBaseHash === 'string' ? body.obsidianBaseHash : null
    if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 })

    if (action !== 'create' && action !== 'save') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const result = await performGovernedKnowledgeBaseWrite({
      runtimeProfileName,
      action,
      path,
      content,
      actor: auth.user.username || 'unknown',
      governance: body?.governance,
      expectedObsidianContentHash: obsidianBaseHash,
      ingestionMethod: 'manual',
    })
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base content mutation error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const action = typeof body?.action === 'string' ? body.action : ''
    const path = typeof body?.path === 'string' ? body.path : ''
    if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!isKnowledgeBaseWikiPathAllowed(context, path) || !isKnowledgeBaseWikiPathWritable(context, path)) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
    }

    const fullPath = await resolveKnowledgeBaseContentPath(context, path, 'wiki')
    if (action !== 'delete') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    await unlink(fullPath)
    return NextResponse.json({ success: true, message: 'File deleted successfully' })
  } catch (err) {
    logger.error({ err }, 'Knowledge Base delete error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
