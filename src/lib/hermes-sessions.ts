/**
 * Hermes Agent Session Scanner — reads ~/.hermes/state.db (SQLite)
 * to discover hermes-agent sessions and map them to MC's unified session format.
 *
 * Opens the database read-only to avoid locking conflicts with a running agent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { config } from './config'
import type { HermesRuntimeProfile } from './hermes-runtime-profiles'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes — hermes sessions are shorter-lived
const DEFAULT_SESSION_LIMIT = 100

export interface HermesSessionStats {
  sessionId: string
  source: string           // 'cli', 'telegram', 'discord', etc.
  model: string | null
  title: string | null
  messageCount: number
  toolCallCount: number
  inputTokens: number
  outputTokens: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  isActive: boolean
  runtimeProfileName?: string
  runtimeProfileLabel?: string
}

interface HermesSessionRow {
  id: string
  source: string | null
  user_id: string | null
  model: string | null
  started_at: number | null
  ended_at: number | null
  message_count: number | null
  tool_call_count: number | null
  input_tokens: number | null
  output_tokens: number | null
  title: string | null
}

function getHermesDbPath(hermesHome = join(config.homeDir, '.hermes')): string {
  return join(hermesHome, 'state.db')
}

function getHermesPidPath(hermesHome = join(config.homeDir, '.hermes')): string {
  return join(hermesHome, 'gateway.pid')
}

let hermesBinaryCache: { checkedAt: number; installed: boolean } | null = null
let hermesPresenceCache: { checkedAt: number; installed: boolean } | null = null

function getHermesHomeCandidates(): string[] {
  const dataDir = require('node:path').resolve(config.dataDir || '.data')
  const homeDir = config.homeDir || process.env.HOME || ''
  return Array.from(new Set([
    join(dataDir, '.hermes'),
    join(homeDir, '.hermes'),
  ].filter((dir): dir is string => Boolean(dir && dir.trim()))))
}

export function hasHermesCliBinary(): boolean {
  const now = Date.now()
  if (hermesBinaryCache && now - hermesBinaryCache.checkedAt < 30_000) {
    return hermesBinaryCache.installed
  }

  // Check common install locations including the data directory's local bin.
  // In Docker, HOME=/nonexistent so we also check dataDir as effective HOME.
  const dataDir = require('node:path').resolve(config.dataDir || '.data')
  const homeDir = config.homeDir || process.env.HOME || ''
  const candidates = [
    process.env.HERMES_BIN,
    join(dataDir, '.local', 'bin', 'hermes'),
    join(dataDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    join(homeDir, '.local', 'bin', 'hermes'),
    join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    'hermes-agent',
    'hermes',
  ].filter((v): v is string => Boolean(v && v.trim()))
  const installed = candidates.some((bin) => {
    try {
      // First check if the file exists (fast path for absolute paths)
      if (bin.startsWith('/') && !existsSync(bin)) {
        logger.debug({ bin }, 'hermes candidate not found on disk')
        return false
      }
      // hermes CLI doesn't support --version (exits 2). Use --help as probe.
      const res = spawnSync(bin, ['--help'], { stdio: 'pipe', timeout: 5000 })
      const found = res.status === 0
      if (found) {
        logger.info({ bin, stdout: (res.stdout || '').toString().trim().slice(0, 60) }, 'hermes binary detected')
      }
      return found
    } catch (err) {
      logger.debug({ bin, err }, 'hermes candidate check failed')
      return false
    }
  })

  hermesBinaryCache = { checkedAt: now, installed }
  return installed
}

function hasHermesHomeState(): boolean {
  const now = Date.now()
  if (hermesPresenceCache && now - hermesPresenceCache.checkedAt < 30_000) {
    return hermesPresenceCache.installed
  }

  const markers = [
    '.env',
    'state.db',
    'gateway.pid',
    'cron/jobs.json',
    'memories',
    'sessions',
    'skills',
  ]
  const installed = getHermesHomeCandidates().some((home) =>
    markers.some((marker) => existsSync(join(home, marker)))
  )

  hermesPresenceCache = { checkedAt: now, installed }
  return installed
}

export function clearHermesDetectionCache(): void {
  hermesBinaryCache = null
  hermesPresenceCache = null
}

export function isHermesInstalled(): boolean {
  // Hermes can be meaningfully present either via an executable CLI or an existing ~/.hermes home
  // with persisted state (cron jobs, memory, env, session DB, etc).
  return hasHermesCliBinary() || hasHermesHomeState()
}

function parseGatewayPid(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null

  // Legacy/simple format: file contains only PID text
  if (/^\d+$/.test(text)) {
    const pid = Number.parseInt(text, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  }

  // Current Hermes format: JSON object with pid field
  try {
    const parsed = JSON.parse(text) as { pid?: number | string } | null
    const value = parsed?.pid
    const pid = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function isHermesGatewayRunning(hermesHome?: string): boolean {
  const pidPath = getHermesPidPath(hermesHome)
  if (!existsSync(pidPath)) return false

  try {
    const pidStr = readFileSync(pidPath, 'utf8')
    const pid = parseGatewayPid(pidStr)
    if (!pid) return false
    // Check if process exists (signal 0 doesn't kill, just checks)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function epochSecondsToISO(epoch: number | null): string | null {
  if (!epoch || !Number.isFinite(epoch) || epoch <= 0) return null
  // Hermes stores timestamps as epoch seconds
  return new Date(epoch * 1000).toISOString()
}

function scanHermesSessionsForHome(
  hermesHome: string,
  runtimeProfileName: string,
  runtimeProfileLabel: string,
  limit = DEFAULT_SESSION_LIMIT,
): HermesSessionStats[] {
  const dbPath = getHermesDbPath(hermesHome)
  if (!existsSync(dbPath)) return []

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })

    // Verify the sessions table exists
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).get() as { name?: string } | undefined
    if (!tableCheck?.name) return []

    const rows = db.prepare(`
      SELECT id, source, user_id, model, started_at, ended_at,
             message_count, tool_call_count, input_tokens, output_tokens, title
      FROM sessions
      ORDER BY COALESCE(ended_at, started_at) DESC
      LIMIT ?
    `).all(limit) as HermesSessionRow[]

    const now = Date.now()
    const gatewayRunning = isHermesGatewayRunning(hermesHome)

    return rows.map((row) => {
      const firstMessageAt = epochSecondsToISO(row.started_at)
      let lastMessageAt = epochSecondsToISO(row.ended_at)

      // If session has no end time, try to get latest message timestamp
      if (!lastMessageAt && row.started_at) {
        try {
          const latestMsg = db!.prepare(
            'SELECT MAX(timestamp) as ts FROM messages WHERE session_id = ?'
          ).get(row.id) as { ts: number | null } | undefined
          if (latestMsg?.ts) {
            lastMessageAt = epochSecondsToISO(latestMsg.ts)
          }
        } catch {
          // messages table may not exist or have different schema
        }
      }

      if (!lastMessageAt) lastMessageAt = firstMessageAt

      const lastMs = lastMessageAt ? new Date(lastMessageAt).getTime() : 0
      const isActive = row.ended_at === null
        && lastMs > 0
        && (now - lastMs) < ACTIVE_THRESHOLD_MS
        && gatewayRunning

      return {
        sessionId: row.id,
        source: row.source || 'cli',
        model: row.model || null,
        title: row.title || null,
        messageCount: row.message_count || 0,
        toolCallCount: row.tool_call_count || 0,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
        firstMessageAt,
        lastMessageAt,
        isActive,
        runtimeProfileName,
        runtimeProfileLabel,
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to scan Hermes sessions')
    return []
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

export function scanHermesSessions(
  limit = DEFAULT_SESSION_LIMIT,
  runtimeProfiles?: HermesRuntimeProfile[],
): HermesSessionStats[] {
  const profiles = runtimeProfiles?.length
    ? runtimeProfiles
    : [{
        name: 'default',
        label: 'default',
        description: '',
        hermesHome: join(config.homeDir, '.hermes'),
        envPath: join(config.homeDir, '.hermes', '.env'),
        isDefault: true,
        exists: true,
      }]

  return profiles
    .flatMap((profile) => scanHermesSessionsForHome(
      profile.hermesHome,
      profile.name,
      profile.label,
      limit,
    ))
    .sort((a, b) => {
      const aLast = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bLast = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return bLast - aLast
    })
    .slice(0, limit)
}
