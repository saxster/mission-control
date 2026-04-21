import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import {
  HERMES_ROUTING_BINDINGS_SETTING_KEY,
  parseHermesRoutingBindings,
} from '@/lib/hermes-routing'
import {
  HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY,
  parseHermesRuntimeProfileBindings,
  resolveHermesRuntimeBindingForSource,
} from '@/lib/hermes-runtime-profiles'
import { logger } from '@/lib/logger'

const HERMES_AGENT_NAME = 'hermes'
const HERMES_AGENT_ROLE = 'Hermes Agent'

type HermesHookPayload = {
  event?: string
  session_id?: string
  source?: string
  timestamp?: string
  agent_name?: string
}

function readHermesBindings(): { sourceBindings: Record<string, string>; runtimeBindings: Record<string, string> } {
  const settingsStmt = getDatabase().prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
  return {
    sourceBindings: parseHermesRoutingBindings(
      (settingsStmt.get(HERMES_ROUTING_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
    ),
    runtimeBindings: parseHermesRuntimeProfileBindings(
      (settingsStmt.get(HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
    ),
  }
}

function ensureHermesAgent(
  workspaceId: number,
  activity: string,
  status = 'busy',
): { id: number; created: boolean; status: string | null; lastActivity: string | null } {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const existing = db.prepare(
    'SELECT id, status, last_activity FROM agents WHERE name = ? AND workspace_id = ? LIMIT 1'
  ).get(HERMES_AGENT_NAME, workspaceId) as { id: number; status?: string | null; last_activity?: string | null } | undefined

  if (existing?.id) {
    return {
      id: existing.id,
      created: false,
      status: existing.status || null,
      lastActivity: existing.last_activity || null,
    }
  }

  const result = db.prepare(`
    INSERT INTO agents (name, role, status, last_seen, last_activity, created_at, updated_at, workspace_id, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    HERMES_AGENT_NAME,
    HERMES_AGENT_ROLE,
    status,
    now,
    activity,
    now,
    now,
    workspaceId,
    JSON.stringify({ source: 'hermes-hook' }),
  )

  const id = Number(result.lastInsertRowid)
  eventBus.broadcast('agent.created', {
    id,
    name: HERMES_AGENT_NAME,
    role: HERMES_AGENT_ROLE,
    status,
    last_seen: now,
    last_activity: activity,
    created_at: now,
    updated_at: now,
    workspace_id: workspaceId,
  })
  db_helpers.logActivity(
    'agent_created',
    'agent',
    id,
    HERMES_AGENT_NAME,
    'Registered Hermes agent from live hook telemetry',
    { source: 'hermes-hook' },
    workspaceId,
  )

  return { id, created: true, status, lastActivity: activity }
}

function logRawHermesEvent(body: HermesHookPayload, workspaceId: number, agentName: string, timestamp: string): void {
  db_helpers.logActivity(
    `hermes.${body.event}`,
    'session',
    0,
    agentName,
    `Hermes ${body.event}: ${body.session_id || 'unknown'} via ${body.source || 'cli'}`,
    {
      session_id: body.session_id,
      source: body.source,
      timestamp,
      agent_name: agentName,
    },
    workspaceId,
  )

  eventBus.broadcast('session.updated', {
    source: 'hermes',
    event: body.event,
    session_id: body.session_id,
    hermes_source: body.source,
    timestamp,
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: HermesHookPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const event = String(body.event || '').trim()
  if (!event) {
    return NextResponse.json({ error: 'event field is required' }, { status: 400 })
  }
  if (!['session:start', 'agent:start', 'agent:end'].includes(event)) {
    return NextResponse.json({ error: 'Unsupported Hermes event' }, { status: 400 })
  }

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const timestamp = body.timestamp || new Date().toISOString()
    const agentName = String(body.agent_name || HERMES_AGENT_NAME).trim() || HERMES_AGENT_NAME

    logger.info({ event, session_id: body.session_id, source: body.source, agent_name: agentName }, 'Hermes event received')
    logRawHermesEvent({ ...body, event }, workspaceId, agentName, timestamp)

    if (event === 'agent:start' || event === 'agent:end') {
      const status = event === 'agent:start' ? 'busy' : 'idle'
      const activity = event === 'agent:start'
        ? 'Hermes agent started from hook telemetry'
        : 'Hermes agent ended from hook telemetry'

      if (agentName === HERMES_AGENT_NAME) {
        const agent = ensureHermesAgent(workspaceId, activity, status)
        if (!agent.created && (agent.status !== status || agent.lastActivity !== activity)) {
          db_helpers.updateAgentStatus(HERMES_AGENT_NAME, status, activity, workspaceId)
        }
      } else {
        getDatabase().prepare(
          'UPDATE agents SET status = ?, updated_at = ? WHERE name = ? AND workspace_id = ?'
        ).run(status, Math.floor(Date.now() / 1000), agentName, workspaceId)
      }

      return NextResponse.json({ ok: true, event, agentName })
    }

    const sessionId = String(body.session_id || '').trim()
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }

    const { sourceBindings, runtimeBindings } = readHermesBindings()
    const binding = resolveHermesRuntimeBindingForSource(body.source || 'cli', sourceBindings, runtimeBindings)
    const sourceLabel = binding.sourceLabel
    const activityDescription = `Started ${binding.profileBadge} session from ${sourceLabel}`
    const agent = ensureHermesAgent(workspaceId, activityDescription, 'busy')

    if (!agent.created && (agent.status !== 'busy' || agent.lastActivity !== activityDescription)) {
      db_helpers.updateAgentStatus(HERMES_AGENT_NAME, 'busy', activityDescription, workspaceId)
    }

    db_helpers.logActivity(
      'hermes_session_started',
      'agent',
      agent.id,
      HERMES_AGENT_NAME,
      activityDescription,
      {
        event: 'session:start',
        session_id: sessionId,
        source: binding.sourceKey,
        sourceLabel,
        profile: binding.profile,
        profileLabel: binding.profileLabel,
        profileBadge: binding.profileBadge,
        runtimeProfileName: binding.runtimeProfileName,
        runtimeProfileLabel: binding.runtimeProfileLabel,
        timestamp,
      },
      workspaceId,
    )

    return NextResponse.json(
      {
        received: true,
        sessionId,
        source: binding.sourceKey,
        sourceLabel,
        profile: binding.profile,
        profileLabel: binding.profileLabel,
        runtimeProfileName: binding.runtimeProfileName,
        runtimeProfileLabel: binding.runtimeProfileLabel,
      },
      { status: 201 },
    )
  } catch (error) {
    logger.error({ err: error }, 'Hermes event ingestion failed')
    return NextResponse.json({ error: 'Failed to ingest Hermes event' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
