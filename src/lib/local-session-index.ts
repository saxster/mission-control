import { getDatabase } from '@/lib/db'
import { syncClaudeSessions } from '@/lib/claude-sessions'
import { scanCodexSessions } from '@/lib/codex-sessions'
import { scanHermesSessions } from '@/lib/hermes-sessions'
import { logger } from '@/lib/logger'
import {
  HERMES_ROUTING_BINDINGS_SETTING_KEY,
  parseHermesRoutingBindings,
  resolveHermesBindingForSource,
} from '@/lib/hermes-routing'
import {
  HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY,
  buildHermesRuntimeBindingTargets,
  parseHermesRuntimeProfileBindings,
} from '@/lib/hermes-runtime-profiles'

const LOCAL_SESSION_INDEX_LIMIT = 150
const INDEX_STALE_AFTER_MS = 2 * 60_000

type ScanSource = 'claude' | 'codex' | 'hermes'

interface IndexedLocalSessionRow {
  entry_key: string
  source_type: ScanSource
  session_id: string
  project_slug: string | null
  project_path: string | null
  model: string | null
  git_branch: string | null
  user_messages: number
  assistant_messages: number
  tool_uses: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  first_message_at: string | null
  last_message_at: string | null
  last_user_prompt: string | null
  session_source: string | null
  title: string | null
  profile: string | null
  profile_label: string | null
  runtime_profile_name: string | null
  runtime_profile_label: string | null
  is_active: number
  last_indexed_at: number
  is_stale: number
}

interface LocalSessionIndexMeta {
  indexedAt: number | null
  stale: boolean
  sources: Record<ScanSource, {
    indexedAt: number | null
    status: string | null
    error: string | null
  }>
}

let syncPromise: Promise<{ ok: boolean; message: string; indexedAt: number | null }> | null = null

function markSourceScanning(source: ScanSource, startedAtSec: number) {
  getDatabase().prepare(`
    INSERT INTO local_session_scan_state (
      source_type,
      last_started_at,
      status,
      error_message
    ) VALUES (?, ?, 'running', NULL)
    ON CONFLICT(source_type) DO UPDATE SET
      last_started_at = excluded.last_started_at,
      status = excluded.status,
      error_message = NULL
  `).run(source, startedAtSec)
}

function markSourceFinished(source: ScanSource, finishedAtSec: number, status: 'ok' | 'error', errorMessage: string | null = null) {
  getDatabase().prepare(`
    INSERT INTO local_session_scan_state (
      source_type,
      last_finished_at,
      last_indexed_at,
      status,
      error_message
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_type) DO UPDATE SET
      last_finished_at = excluded.last_finished_at,
      last_indexed_at = excluded.last_indexed_at,
      status = excluded.status,
      error_message = excluded.error_message
  `).run(source, finishedAtSec, finishedAtSec, status, errorMessage)
}

function upsertIndexedSession(row: Omit<IndexedLocalSessionRow, 'is_stale'> & { is_stale?: number }) {
  getDatabase().prepare(`
    INSERT INTO local_sessions (
      entry_key,
      source_type,
      session_id,
      project_slug,
      project_path,
      model,
      git_branch,
      user_messages,
      assistant_messages,
      tool_uses,
      input_tokens,
      output_tokens,
      total_tokens,
      estimated_cost,
      first_message_at,
      last_message_at,
      last_user_prompt,
      session_source,
      title,
      profile,
      profile_label,
      runtime_profile_name,
      runtime_profile_label,
      is_active,
      last_indexed_at,
      is_stale,
      updated_at
    ) VALUES (
      @entry_key,
      @source_type,
      @session_id,
      @project_slug,
      @project_path,
      @model,
      @git_branch,
      @user_messages,
      @assistant_messages,
      @tool_uses,
      @input_tokens,
      @output_tokens,
      @total_tokens,
      @estimated_cost,
      @first_message_at,
      @last_message_at,
      @last_user_prompt,
      @session_source,
      @title,
      @profile,
      @profile_label,
      @runtime_profile_name,
      @runtime_profile_label,
      @is_active,
      @last_indexed_at,
      @is_stale,
      unixepoch()
    )
    ON CONFLICT(entry_key) DO UPDATE SET
      session_id = excluded.session_id,
      project_slug = excluded.project_slug,
      project_path = excluded.project_path,
      model = excluded.model,
      git_branch = excluded.git_branch,
      user_messages = excluded.user_messages,
      assistant_messages = excluded.assistant_messages,
      tool_uses = excluded.tool_uses,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens,
      estimated_cost = excluded.estimated_cost,
      first_message_at = excluded.first_message_at,
      last_message_at = excluded.last_message_at,
      last_user_prompt = excluded.last_user_prompt,
      session_source = excluded.session_source,
      title = excluded.title,
      profile = excluded.profile,
      profile_label = excluded.profile_label,
      runtime_profile_name = excluded.runtime_profile_name,
      runtime_profile_label = excluded.runtime_profile_label,
      is_active = excluded.is_active,
      last_indexed_at = excluded.last_indexed_at,
      is_stale = excluded.is_stale,
      updated_at = unixepoch()
  `).run({
    ...row,
    is_stale: row.is_stale ?? 0,
  })
}

function markSourceRowsStale(source: ScanSource) {
  getDatabase().prepare('UPDATE local_sessions SET is_stale = 1 WHERE source_type = ?').run(source)
}

function syncClaudeMirror(indexedAtSec: number) {
  const db = getDatabase()
  markSourceRowsStale('claude')
  const rows = db.prepare(`
    SELECT
      session_id,
      project_slug,
      project_path,
      model,
      git_branch,
      user_messages,
      assistant_messages,
      tool_uses,
      input_tokens,
      output_tokens,
      estimated_cost,
      first_message_at,
      last_message_at,
      last_user_prompt,
      is_active
    FROM claude_sessions
    ORDER BY last_message_at DESC
    LIMIT ?
  `).all(LOCAL_SESSION_INDEX_LIMIT) as Array<Record<string, any>>

  for (const row of rows) {
    upsertIndexedSession({
      entry_key: `claude:${row.session_id}`,
      source_type: 'claude',
      session_id: row.session_id,
      project_slug: row.project_slug || null,
      project_path: row.project_path || null,
      model: row.model || null,
      git_branch: row.git_branch || null,
      user_messages: row.user_messages || 0,
      assistant_messages: row.assistant_messages || 0,
      tool_uses: row.tool_uses || 0,
      input_tokens: row.input_tokens || 0,
      output_tokens: row.output_tokens || 0,
      total_tokens: (row.input_tokens || 0) + (row.output_tokens || 0),
      estimated_cost: row.estimated_cost || 0,
      first_message_at: row.first_message_at || null,
      last_message_at: row.last_message_at || null,
      last_user_prompt: row.last_user_prompt || null,
      session_source: null,
      title: row.project_slug || row.session_id,
      profile: null,
      profile_label: null,
      runtime_profile_name: null,
      runtime_profile_label: null,
      is_active: row.is_active || 0,
      last_indexed_at: indexedAtSec,
    })
  }
}

function syncCodexIndex(indexedAtSec: number) {
  markSourceRowsStale('codex')
  const rows = scanCodexSessions(LOCAL_SESSION_INDEX_LIMIT)
  for (const row of rows) {
    upsertIndexedSession({
      entry_key: `codex:${row.sessionId}`,
      source_type: 'codex',
      session_id: row.sessionId,
      project_slug: row.projectSlug || null,
      project_path: row.projectPath || null,
      model: row.model || null,
      git_branch: null,
      user_messages: row.userMessages || 0,
      assistant_messages: row.assistantMessages || 0,
      tool_uses: 0,
      input_tokens: row.inputTokens || 0,
      output_tokens: row.outputTokens || 0,
      total_tokens: row.totalTokens || (row.inputTokens + row.outputTokens),
      estimated_cost: 0,
      first_message_at: row.firstMessageAt || null,
      last_message_at: row.lastMessageAt || null,
      last_user_prompt: null,
      session_source: null,
      title: row.projectSlug || row.sessionId,
      profile: null,
      profile_label: null,
      runtime_profile_name: null,
      runtime_profile_label: null,
      is_active: row.isActive ? 1 : 0,
      last_indexed_at: indexedAtSec,
    })
  }
}

function syncHermesIndex(indexedAtSec: number) {
  const db = getDatabase()
  markSourceRowsStale('hermes')

  const settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
  const hermesBindings = parseHermesRoutingBindings(
    (settingsStmt.get(HERMES_ROUTING_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
  )
  const hermesRuntimeBindings = parseHermesRuntimeProfileBindings(
    (settingsStmt.get(HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
  )
  const runtimeProfiles = buildHermesRuntimeBindingTargets(hermesRuntimeBindings)
    .map((binding) => ({
      name: binding.runtimeProfileName,
      label: binding.runtimeProfileLabel,
      hermesHome: binding.runtimeProfileHome,
      envPath: '',
      description: '',
      isDefault: binding.runtimeProfileName === 'default',
      exists: binding.runtimeProfileExists,
    }))
    .filter((profile, index, all) => all.findIndex((entry) => entry.name === profile.name) === index)

  const rows = scanHermesSessions(LOCAL_SESSION_INDEX_LIMIT, runtimeProfiles)
  for (const row of rows) {
    const binding = resolveHermesBindingForSource(row.source || 'cli', hermesBindings)
    upsertIndexedSession({
      entry_key: `hermes:${row.runtimeProfileName || 'default'}:${row.sessionId}`,
      source_type: 'hermes',
      session_id: row.sessionId,
      project_slug: null,
      project_path: null,
      model: row.model || null,
      git_branch: null,
      user_messages: row.messageCount || 0,
      assistant_messages: 0,
      tool_uses: row.toolCallCount || 0,
      input_tokens: row.inputTokens || 0,
      output_tokens: row.outputTokens || 0,
      total_tokens: (row.inputTokens || 0) + (row.outputTokens || 0),
      estimated_cost: 0,
      first_message_at: row.firstMessageAt || null,
      last_message_at: row.lastMessageAt || null,
      last_user_prompt: row.title || null,
      session_source: row.source || 'cli',
      title: row.title || row.sessionId,
      profile: binding.profile,
      profile_label: binding.profileLabel,
      runtime_profile_name: row.runtimeProfileName || null,
      runtime_profile_label: row.runtimeProfileLabel || null,
      is_active: row.isActive ? 1 : 0,
      last_indexed_at: indexedAtSec,
    })
  }
}

export async function syncLocalSessionIndex(force = false): Promise<{ ok: boolean; message: string; indexedAt: number | null }> {
  if (syncPromise) return syncPromise

  syncPromise = (async () => {
    const startedAtSec = Math.floor(Date.now() / 1000)
    try {
      markSourceScanning('claude', startedAtSec)
      await syncClaudeSessions(force)
      syncClaudeMirror(startedAtSec)
      markSourceFinished('claude', startedAtSec, 'ok')
    } catch (error: any) {
      logger.warn({ err: error }, 'Claude local-session indexing failed')
      markSourceFinished('claude', startedAtSec, 'error', error?.message || 'Claude index failed')
    }

    try {
      markSourceScanning('codex', startedAtSec)
      syncCodexIndex(startedAtSec)
      markSourceFinished('codex', startedAtSec, 'ok')
    } catch (error: any) {
      logger.warn({ err: error }, 'Codex local-session indexing failed')
      markSourceFinished('codex', startedAtSec, 'error', error?.message || 'Codex index failed')
    }

    try {
      markSourceScanning('hermes', startedAtSec)
      syncHermesIndex(startedAtSec)
      markSourceFinished('hermes', startedAtSec, 'ok')
    } catch (error: any) {
      logger.warn({ err: error }, 'Hermes local-session indexing failed')
      markSourceFinished('hermes', startedAtSec, 'error', error?.message || 'Hermes index failed')
    }

    const meta = getLocalSessionIndexMeta()
    return {
      ok: true,
      message: 'Local session index refreshed',
      indexedAt: meta.indexedAt,
    }
  })()

  try {
    return await syncPromise
  } finally {
    syncPromise = null
  }
}

export function queueLocalSessionIndexSync(force = false): void {
  void syncLocalSessionIndex(force).catch((error) => {
    logger.warn({ err: error }, 'Queued local-session index refresh failed')
  })
}

export function readIndexedLocalSessions(limit = LOCAL_SESSION_INDEX_LIMIT): IndexedLocalSessionRow[] {
  return getDatabase().prepare(`
    SELECT
      entry_key,
      source_type,
      session_id,
      project_slug,
      project_path,
      model,
      git_branch,
      user_messages,
      assistant_messages,
      tool_uses,
      input_tokens,
      output_tokens,
      total_tokens,
      estimated_cost,
      first_message_at,
      last_message_at,
      last_user_prompt,
      session_source,
      title,
      profile,
      profile_label,
      runtime_profile_name,
      runtime_profile_label,
      is_active,
      last_indexed_at,
      is_stale
    FROM local_sessions
    WHERE is_stale = 0
    ORDER BY COALESCE(last_message_at, first_message_at) DESC
    LIMIT ?
  `).all(limit) as IndexedLocalSessionRow[]
}

export function getLocalSessionIndexMeta(): LocalSessionIndexMeta {
  const rows = getDatabase().prepare(`
    SELECT
      source_type,
      last_indexed_at,
      status,
      error_message
    FROM local_session_scan_state
  `).all() as Array<{
    source_type: ScanSource
    last_indexed_at: number | null
    status: string | null
    error_message: string | null
  }>

  const sources: LocalSessionIndexMeta['sources'] = {
    claude: { indexedAt: null, status: null, error: null },
    codex: { indexedAt: null, status: null, error: null },
    hermes: { indexedAt: null, status: null, error: null },
  }

  let indexedAt: number | null = null
  let stale = rows.length === 0

  for (const row of rows) {
    sources[row.source_type] = {
      indexedAt: row.last_indexed_at,
      status: row.status,
      error: row.error_message,
    }

    if (row.last_indexed_at) {
      indexedAt = indexedAt ? Math.max(indexedAt, row.last_indexed_at) : row.last_indexed_at
      if ((Date.now() - row.last_indexed_at * 1000) > INDEX_STALE_AFTER_MS) {
        stale = true
      }
    } else {
      stale = true
    }

    if (row.status === 'error') {
      stale = true
    }
  }

  return { indexedAt, stale, sources }
}
