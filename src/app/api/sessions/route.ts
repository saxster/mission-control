import { NextRequest, NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'
import { getLocalSessionIndexMeta, queueLocalSessionIndexSync, readIndexedLocalSessions } from '@/lib/local-session-index'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const gatewaySessions = getAllGatewaySessions()
    const mappedGatewaySessions = mapGatewaySessions(gatewaySessions)
    const localIndexMeta = getLocalSessionIndexMeta()
    if (localIndexMeta.stale) {
      queueLocalSessionIndexSync()
    }
    const indexedLocalSessions = getIndexedLocalSessions()

    const merged = dedupeAndSortSessions([...mappedGatewaySessions, ...indexedLocalSessions])
    return NextResponse.json({
      sessions: merged,
      meta: {
        indexedAt: localIndexMeta.indexedAt,
        stale: localIndexMeta.stale,
        sources: localIndexMeta.sources,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'Sessions API error')
    return NextResponse.json({ sessions: [], meta: { indexedAt: null, stale: true, sources: null } })
  }
}

const VALID_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const VALID_VERBOSE_LEVELS = ['off', 'on', 'full'] as const
const VALID_REASONING_LEVELS = ['off', 'on', 'stream'] as const
const SESSION_KEY_RE = /^[a-zA-Z0-9:_.-]+$/

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const body = await request.json()
    const { sessionKey } = body

    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    let rpcMethod: string
    let rpcParams: Record<string, unknown>
    let logDetail: string

    switch (action) {
      case 'set-thinking': {
        const { level } = body
        if (!VALID_THINKING_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid thinking level. Must be: ${VALID_THINKING_LEVELS.join(', ')}` }, { status: 400 })
        }
        rpcMethod = 'session_setThinking'
        rpcParams = { sessionKey, level }
        logDetail = `Set thinking=${level} on ${sessionKey}`
        break
      }
      case 'set-verbose': {
        const { level } = body
        if (!VALID_VERBOSE_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid verbose level. Must be: ${VALID_VERBOSE_LEVELS.join(', ')}` }, { status: 400 })
        }
        rpcMethod = 'session_setVerbose'
        rpcParams = { sessionKey, level }
        logDetail = `Set verbose=${level} on ${sessionKey}`
        break
      }
      case 'set-reasoning': {
        const { level } = body
        if (!VALID_REASONING_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid reasoning level. Must be: ${VALID_REASONING_LEVELS.join(', ')}` }, { status: 400 })
        }
        rpcMethod = 'session_setReasoning'
        rpcParams = { sessionKey, level }
        logDetail = `Set reasoning=${level} on ${sessionKey}`
        break
      }
      case 'set-label': {
        const { label } = body
        if (typeof label !== 'string' || label.length > 100) {
          return NextResponse.json({ error: 'Label must be a string up to 100 characters' }, { status: 400 })
        }
        rpcMethod = 'session_setLabel'
        rpcParams = { sessionKey, label }
        logDetail = `Set label="${label}" on ${sessionKey}`
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Must be: set-thinking, set-verbose, set-reasoning, set-label' }, { status: 400 })
    }

    const result = await callOpenClawGateway(rpcMethod, rpcParams, 10_000)

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      logDetail,
      { session_key: sessionKey, action }
    )

    return NextResponse.json({ success: true, action, sessionKey, result })
  } catch (error: any) {
    logger.error({ err: error }, 'Session POST error')
    return NextResponse.json({ error: error.message || 'Session action failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { sessionKey } = body

    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    const result = await callOpenClawGateway('session_delete', { sessionKey }, 10_000)

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Deleted session ${sessionKey}`,
      { session_key: sessionKey, action: 'delete' }
    )

    return NextResponse.json({ success: true, sessionKey, result })
  } catch (error: any) {
    logger.error({ err: error }, 'Session DELETE error')
    return NextResponse.json({ error: error.message || 'Session deletion failed' }, { status: 500 })
  }
}

function mapGatewaySessions(gatewaySessions: ReturnType<typeof getAllGatewaySessions>) {
  // Deduplicate by sessionId — OpenClaw tracks cron runs under the same
  // session ID as the parent session, causing duplicate React keys (#80).
  // Keep the most recently updated entry when duplicates exist.
  const sessionMap = new Map<string, (typeof gatewaySessions)[0]>()
  for (const s of gatewaySessions) {
    const id = s.sessionId || `${s.agent}:${s.key}`
    const existing = sessionMap.get(id)
    if (!existing || s.updatedAt > existing.updatedAt) {
      sessionMap.set(id, s)
    }
  }

  return Array.from(sessionMap.values()).map((s) => {
    const total = s.totalTokens || 0
    const context = s.contextTokens || 35000
    const pct = context > 0 ? Math.round((total / context) * 100) : 0
    return {
      id: s.sessionId || `${s.agent}:${s.key}`,
      key: s.key,
      agent: s.agent,
      kind: s.chatType || 'unknown',
      age: formatAge(s.updatedAt),
      model: s.model,
      tokens: `${formatTokens(total)}/${formatTokens(context)} (${pct}%)`,
      channel: s.channel,
      flags: [],
      active: s.active,
      startTime: s.updatedAt,
      lastActivity: s.updatedAt,
      source: 'gateway' as const,
    }
  })
}

function getIndexedLocalSessions() {
  try {
    const rows = readIndexedLocalSessions()

    return rows.map((session) => {
      const lastMessageAt = session.last_message_at ? new Date(session.last_message_at).getTime() : 0
      const firstMessageAt = session.first_message_at ? new Date(session.first_message_at).getTime() : 0
      const isActive = session.is_active === 1
      const flags = []
      if (session.git_branch) flags.push(session.git_branch)
      if (session.source_type === 'hermes' && session.session_source && session.session_source !== 'cli') {
        flags.push(session.session_source)
      }
      if (session.source_type === 'hermes' && session.profile_label && session.profile !== 'primary') {
        flags.push(session.profile_label)
      }

      return {
        id: session.session_id,
        key: session.title || session.project_slug || session.session_id,
        agent: session.source_type === 'hermes'
          ? 'hermes'
          : session.project_slug || (session.source_type === 'codex' ? 'codex-local' : 'local'),
        kind: session.source_type === 'claude' ? 'claude-code' : session.source_type === 'codex' ? 'codex-cli' : 'hermes',
        age: isActive ? 'now' : formatAge(lastMessageAt),
        model: session.model || (session.source_type === 'hermes' ? 'hermes' : session.source_type === 'codex' ? 'codex' : 'unknown'),
        tokens: `${formatTokens(session.input_tokens || 0)}/${formatTokens(session.output_tokens || 0)}`,
        channel: session.session_source || 'local',
        flags,
        active: isActive,
        startTime: firstMessageAt,
        lastActivity: isActive ? Date.now() : lastMessageAt,
        source: 'local' as const,
        profile: session.profile || undefined,
        profileLabel: session.profile_label || undefined,
        runtimeProfileName: session.runtime_profile_name || undefined,
        runtimeProfileLabel: session.runtime_profile_label || undefined,
        userMessages: session.user_messages || 0,
        assistantMessages: session.assistant_messages || 0,
        toolUses: session.tool_uses || 0,
        estimatedCost: session.estimated_cost || 0,
        lastUserPrompt: session.last_user_prompt || null,
        totalTokens: session.total_tokens || ((session.input_tokens || 0) + (session.output_tokens || 0)),
        workingDir: session.project_path || null,
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to read indexed local sessions')
    return []
  }
}

function dedupeAndSortSessions(merged: Array<Record<string, any>>) {
  const deduped = new Map<string, Record<string, any>>()

  for (const session of merged) {
    const id = String(session?.id || '')
    const source = String(session?.source || '')
    const key = `${source}:${id}`
    if (!id) continue
    const existing = deduped.get(key)
    const currentActivity = Number(session?.lastActivity || 0)
    const existingActivity = Number(existing?.lastActivity || 0)
    if (!existing || currentActivity > existingActivity) deduped.set(key, session)
  }

  return Array.from(deduped.values())
    .sort((a, b) => Number(b?.lastActivity || 0) - Number(a?.lastActivity || 0))
    .slice(0, 100)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export const dynamic = 'force-dynamic'
