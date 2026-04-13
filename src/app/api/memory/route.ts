import { unlink } from 'node:fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'
import {
  getKnowledgeBaseContext,
  getKnowledgeBaseTree,
  isKnowledgeBaseWikiPathAllowed,
  isKnowledgeBaseWikiPathWritable,
  readKnowledgeBaseContent,
  resolveKnowledgeBaseContentPath,
  searchKnowledgeBase,
} from '@/lib/knowledge-base'
import { getEffectiveKnowledgeBaseGovernanceRecord } from '@/lib/knowledge-base-governance'
import { performGovernedKnowledgeBaseWrite } from '@/lib/knowledge-base-content-write'
import {
  decorateLegacyMemoryResponse,
  legacyMemoryJson,
  logLegacyMemoryRouteHit,
} from '@/lib/legacy-memory-route'
import { validateSchema } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

const LEGACY_ROUTE = { canonicalBasePath: '/api/knowledge-base' } as const

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return decorateLegacyMemoryResponse(rateCheck, LEGACY_ROUTE)

  try {
    const { searchParams } = new URL(request.url)
    const runtimeProfileName = searchParams.get('runtimeProfileName')
    const path = searchParams.get('path')
    const action = searchParams.get('action')
    const depthParam = Number.parseInt(searchParams.get('depth') || '', 10)
    const maxDepth = Number.isFinite(depthParam) ? Math.max(0, Math.min(depthParam, 8)) : Number.POSITIVE_INFINITY
    const context = getKnowledgeBaseContext(runtimeProfileName)

    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action,
      ...LEGACY_ROUTE,
    })

    if (action === 'tree') {
      if (path && !isKnowledgeBaseWikiPathAllowed(context, path)) {
        return legacyMemoryJson({ error: 'Path not allowed' }, LEGACY_ROUTE, { status: 403 })
      }
      const tree = await getKnowledgeBaseTree(context, { path: path || undefined, depth: maxDepth })
      return legacyMemoryJson({
        tree,
        roots: context.wikiRoots,
        writableRoots: context.writableWikiRoots,
        initialized: context.wikiExists,
        emptyStateMessage: context.firstRunReason,
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    if (action === 'content' && path) {
      if (!isKnowledgeBaseWikiPathAllowed(context, path)) {
        return legacyMemoryJson({ error: 'Path not allowed' }, LEGACY_ROUTE, { status: 403 })
      }
      const data = await readKnowledgeBaseContent(context, path, 'wiki')
      return legacyMemoryJson({
        ...data,
        schema: data.path.endsWith('.md') ? validateSchema(data.content) : null,
        governance: getEffectiveKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, path),
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    if (action === 'search') {
      const query = searchParams.get('query')
      if (!query) {
        return legacyMemoryJson({ error: 'Query required' }, LEGACY_ROUTE, { status: 400 })
      }
      const results = await searchKnowledgeBase(context, query, 100)
      return legacyMemoryJson({
        query,
        results,
        initialized: context.wikiExists,
        emptyStateMessage: context.firstRunReason,
        runtimeProfileName: context.runtimeProfile.name,
      }, LEGACY_ROUTE)
    }

    return legacyMemoryJson({ error: 'Invalid action' }, LEGACY_ROUTE, { status: 400 })
  } catch (error) {
    const message = (error as Error).message || ''
    if (message.includes('Knowledge Base wiki not initialized')) {
      return legacyMemoryJson({ error: message }, LEGACY_ROUTE, { status: 404 })
    }
    logger.error({ err: error }, 'Legacy memory API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return decorateLegacyMemoryResponse(rateCheck, LEGACY_ROUTE)

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const action = typeof body?.action === 'string' ? body.action : ''
    const path = typeof body?.path === 'string' ? body.path : ''
    const content = typeof body?.content === 'string' ? body.content : ''

    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action,
      ...LEGACY_ROUTE,
    })

    if (!path) {
      return legacyMemoryJson({ error: 'Path is required' }, LEGACY_ROUTE, { status: 400 })
    }

    if (action !== 'create' && action !== 'save') {
      return legacyMemoryJson({ error: 'Invalid action' }, LEGACY_ROUTE, { status: 400 })
    }

    const result = await performGovernedKnowledgeBaseWrite({
      runtimeProfileName,
      action,
      path,
      content,
      actor: auth.user.username || 'unknown',
      governance: body?.governance,
      ingestionMethod: 'legacy_compat',
    })

    if (result.status === 200) {
      try {
        db_helpers.logActivity(
          action === 'create' ? 'knowledge_base_file_created' : 'knowledge_base_file_saved',
          'memory',
          0,
          auth.user.username || 'unknown',
          `${action === 'create' ? 'Created' : 'Updated'} ${path}`,
          { path, size: content.length, legacy: true },
        )
      } catch {}
    }

    return legacyMemoryJson(result.body, LEGACY_ROUTE, { status: result.status })
  } catch (error) {
    logger.error({ err: error }, 'Legacy memory POST API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return legacyMemoryJson({ error: auth.error }, LEGACY_ROUTE, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return decorateLegacyMemoryResponse(rateCheck, LEGACY_ROUTE)

  try {
    const body = await request.json()
    const runtimeProfileName = typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null
    const action = typeof body?.action === 'string' ? body.action : ''
    const path = typeof body?.path === 'string' ? body.path : ''

    logLegacyMemoryRouteHit({
      request,
      user: auth.user,
      runtimeProfileName,
      action,
      ...LEGACY_ROUTE,
    })

    if (!path) {
      return legacyMemoryJson({ error: 'Path is required' }, LEGACY_ROUTE, { status: 400 })
    }

    const context = getKnowledgeBaseContext(runtimeProfileName)
    if (!isKnowledgeBaseWikiPathAllowed(context, path) || !isKnowledgeBaseWikiPathWritable(context, path)) {
      return legacyMemoryJson({ error: 'Path not allowed' }, LEGACY_ROUTE, { status: 403 })
    }

    const fullPath = await resolveKnowledgeBaseContentPath(context, path, 'wiki')
    if (action !== 'delete') return legacyMemoryJson({ error: 'Invalid action' }, LEGACY_ROUTE, { status: 400 })
    await unlink(fullPath)
    try {
      db_helpers.logActivity('knowledge_base_file_deleted', 'memory', 0, auth.user.username || 'unknown', `Deleted ${path}`, { path, legacy: true })
    } catch {}
    return legacyMemoryJson({ success: true, message: 'File deleted successfully' }, LEGACY_ROUTE)
  } catch (error) {
    logger.error({ err: error }, 'Legacy memory DELETE API error')
    return legacyMemoryJson({ error: 'Internal server error' }, LEGACY_ROUTE, { status: 500 })
  }
}
