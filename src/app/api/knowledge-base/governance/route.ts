import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'
import { getKnowledgeBaseContext } from '@/lib/knowledge-base'
import {
  backfillKnowledgeBaseGovernanceRecords,
  listKnowledgeBaseGovernanceQueue,
  type KnowledgeBaseGovernanceDomain,
  type KnowledgeBaseGovernanceReviewStatus,
  type KnowledgeBaseGovernanceRiskLevel,
} from '@/lib/knowledge-base-governance'
import { logger } from '@/lib/logger'

function parseReviewStatus(value: string | null): KnowledgeBaseGovernanceReviewStatus | 'all' {
  if (!value || value === 'all') return 'all'
  if (['unreviewed', 'approved', 'approved_with_warnings', 'override_required', 'overridden'].includes(value)) {
    return value as KnowledgeBaseGovernanceReviewStatus
  }
  return 'all'
}

function parseRiskLevel(value: string | null): KnowledgeBaseGovernanceRiskLevel | 'all' {
  if (!value || value === 'all') return 'all'
  if (['low', 'high', 'critical'].includes(value)) return value as KnowledgeBaseGovernanceRiskLevel
  return 'all'
}

function parseDomain(value: string | null): KnowledgeBaseGovernanceDomain | 'all' {
  if (!value || value === 'all') return 'all'
  if (['general', 'programming', 'medicine', 'security', 'legal', 'finance'].includes(value)) {
    return value as KnowledgeBaseGovernanceDomain
  }
  return 'all'
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value == null || value === '') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  try {
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const context = getKnowledgeBaseContext(runtimeProfileName)
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get('limit') || '', 10)
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 500)) : 200
    const queue = await listKnowledgeBaseGovernanceQueue(context, {
      reviewStatus: parseReviewStatus(request.nextUrl.searchParams.get('reviewStatus')),
      riskLevel: parseRiskLevel(request.nextUrl.searchParams.get('riskLevel')),
      domain: parseDomain(request.nextUrl.searchParams.get('domain')),
      overrideUsed: parseBoolean(request.nextUrl.searchParams.get('overrideUsed')),
      unreviewedOnly: request.nextUrl.searchParams.get('unreviewedOnly') === 'true',
      limit,
    })

    return NextResponse.json({
      runtimeProfileName: context.runtimeProfile.name,
      initialized: context.wikiExists,
      emptyStateMessage: context.firstRunReason,
      ...queue,
    })
  } catch (error) {
    logger.error({ err: error }, 'Knowledge Base governance queue API error')
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
    if (action !== 'backfill') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

    const context = getKnowledgeBaseContext(runtimeProfileName)
    const result = await backfillKnowledgeBaseGovernanceRecords({
      context,
      actor: auth.user.username || 'unknown',
    })

    return NextResponse.json({
      success: true,
      action: 'backfill',
      created: result.created,
      totalPages: result.totalPages,
      runtimeProfileName: context.runtimeProfile.name,
    })
  } catch (error) {
    logger.error({ err: error }, 'Knowledge Base governance backfill API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
