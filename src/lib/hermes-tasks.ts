/**
 * Hermes Cron/Task Scanner
 *
 * Read-only bridge that discovers Hermes Agent's scheduled cron jobs from:
 * - ~/.hermes/cron/jobs.json — Scheduled task definitions
 * - ~/.hermes/cron/output/{job_id}/ — Execution output files
 *
 * Follows the same throttled-scan pattern as claude-tasks.ts.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config'
import type { HermesRuntimeProfile } from './hermes-runtime-profiles'
import { logger } from './logger'

export interface HermesCronJob {
  id: string
  name: string
  prompt: string
  schedule: string
  enabled: boolean
  state: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  lastOutput: string | null
  lastOutputKind: 'response' | 'silent' | 'log' | null
  completedRuns: number
  skills: string[]
  createdAt: string | null
  runCount: number
  runtimeProfileName?: string
  runtimeProfileLabel?: string
}

export interface HermesTaskScanResult {
  cronJobs: HermesCronJob[]
  summary: {
    total: number
    enabled: number
    paused: number
    failing: number
    healthy: number
    scheduled: number
  }
}

function getHermesCronDir(hermesHome = join(config.homeDir, '.hermes')): string {
  return join(hermesHome, 'cron')
}

function parseOutputTimestamp(filename: string): string | null {
  const stem = filename.replace(/\.md$/, '')
  const match = stem.match(/^(\d{4}-\d{2}-\d{2})[_T](\d{2}-\d{2}-\d{2})$/)
  if (!match) return null
  return `${match[1]}T${match[2].replace(/-/g, ':')}`
}

function extractOutputPreview(raw: string): { preview: string | null; kind: 'response' | 'silent' | 'log' | null } {
  const responseSection = raw.split(/^## Response\s*$/m)[1]?.trim() || ''
  const text = (responseSection || raw).trim()
  if (!text) return { preview: null, kind: null }
  if (text === '[SILENT]') return { preview: text, kind: 'silent' }
  return {
    preview: text.slice(0, 500),
    kind: responseSection ? 'response' : 'log',
  }
}

function peekLatestOutput(
  cronDir: string,
  jobId: string,
): { lastRunAt: string | null; lastOutput: string | null; lastOutputKind: 'response' | 'silent' | 'log' | null; runCount: number } {
  const outputDir = join(cronDir, 'output', jobId)
  try {
    if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
      return { lastRunAt: null, lastOutput: null, lastOutputKind: null, runCount: 0 }
    }
    const files = readdirSync(outputDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    if (files.length === 0) return { lastRunAt: null, lastOutput: null, lastOutputKind: null, runCount: 0 }

    const latestFile = files[0]
    const timestamp = parseOutputTimestamp(latestFile)

    const filePath = join(outputDir, latestFile)
    let content: string | null = null
    let kind: 'response' | 'silent' | 'log' | null = null
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const extracted = extractOutputPreview(raw)
      content = extracted.preview
      kind = extracted.kind
    } catch { /* ignore */ }

    return {
      lastRunAt: timestamp || null,
      lastOutput: content,
      runCount: files.length,
      lastOutputKind: kind,
    }
  } catch {
    return { lastRunAt: null, lastOutput: null, lastOutputKind: null, runCount: 0 }
  }
}

function normalizeJobsPayload(raw: string): any[] {
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { jobs?: unknown[] }).jobs)) {
    return (parsed as { jobs: unknown[] }).jobs
  }
  return []
}

function scanCronJobsForProfile(profile: HermesRuntimeProfile): HermesCronJob[] {
  const cronDir = getHermesCronDir(profile.hermesHome)
  const jobsFile = join(cronDir, 'jobs.json')

  if (!existsSync(jobsFile)) return []

  try {
    const raw = readFileSync(jobsFile, 'utf-8')
    const jobs = normalizeJobsPayload(raw)

    return jobs.map((job: any) => {
      const id = job.id || job.name || 'unknown'
      const { lastRunAt, lastOutput, lastOutputKind, runCount } = peekLatestOutput(cronDir, id)
      const scheduleDisplay = typeof job.schedule_display === 'string'
        ? job.schedule_display
        : typeof job.schedule?.display === 'string'
          ? job.schedule.display
          : job.schedule || job.cron || job.interval || ''
      const skills = Array.isArray(job.skills)
        ? job.skills.filter((skill: unknown): skill is string => typeof skill === 'string' && skill.trim().length > 0)
        : typeof job.skill === 'string' && job.skill.trim()
          ? [job.skill.trim()]
          : []

      return {
        id,
        name: job.name || id,
        prompt: job.prompt || job.command || job.description || '',
        schedule: scheduleDisplay,
        enabled: job.enabled !== false,
        state: job.state || (job.enabled === false ? 'paused' : 'scheduled'),
        nextRunAt: job.next_run_at || null,
        lastRunAt: job.last_run_at || lastRunAt,
        lastStatus: job.last_status || null,
        lastError: job.last_error || null,
        lastOutput,
        lastOutputKind,
        completedRuns: Number(job.repeat?.completed || 0),
        skills,
        createdAt: job.created_at || null,
        runCount: runCount ?? 0,
        runtimeProfileName: profile.name,
        runtimeProfileLabel: profile.label,
      }
    }).sort((a, b) => {
      const weight = (job: HermesCronJob) => {
        if (job.lastStatus === 'error') return 0
        if (!job.enabled || job.state === 'paused') return 2
        return 1
      }
      const weightDiff = weight(a) - weight(b)
      if (weightDiff !== 0) return weightDiff
      return (a.nextRunAt || '').localeCompare(b.nextRunAt || '')
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to parse Hermes cron jobs')
    return []
  }
}

function summarizeCronJobs(cronJobs: HermesCronJob[]): HermesTaskScanResult['summary'] {
  return {
    total: cronJobs.length,
    enabled: cronJobs.filter(job => job.enabled).length,
    paused: cronJobs.filter(job => !job.enabled || job.state === 'paused').length,
    failing: cronJobs.filter(job => job.lastStatus === 'error').length,
    healthy: cronJobs.filter(job => job.lastStatus === 'success').length,
    scheduled: cronJobs.filter(job => job.enabled && job.state === 'scheduled').length,
  }
}

// Throttle full disk scans
let lastScanAt = 0
let cachedScanKey = 'default'
let cachedResult: HermesTaskScanResult = {
  cronJobs: [],
  summary: { total: 0, enabled: 0, paused: 0, failing: 0, healthy: 0, scheduled: 0 },
}
const SCAN_THROTTLE_MS = 30_000

export function getHermesTasks(force = false, runtimeProfiles?: HermesRuntimeProfile[]): HermesTaskScanResult {
  const now = Date.now()
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
  const scanKey = profiles.map((profile) => `${profile.name}:${profile.hermesHome}`).sort().join('|')

  if (!force && cachedScanKey === scanKey && lastScanAt > 0 && (now - lastScanAt) < SCAN_THROTTLE_MS) {
    return cachedResult
  }

  try {
    const cronJobs = profiles.flatMap((profile) => scanCronJobsForProfile(profile))
    cachedResult = {
      cronJobs,
      summary: summarizeCronJobs(cronJobs),
    }
    cachedScanKey = scanKey
    lastScanAt = now
  } catch (err) {
    logger.warn({ err }, 'Hermes task scan failed')
  }

  return cachedResult
}
