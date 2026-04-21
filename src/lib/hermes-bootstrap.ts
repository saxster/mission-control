import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from './config'
import { runCommand } from './command'
import { logger } from './logger'

export interface HermesBootstrapSummary {
  ready: boolean
  blocking_checks: Array<{ code: string; message: string }>
  recommended_next_steps: string[]
  issue_count: number
}

export interface HermesProviderReadiness {
  configured: boolean
  env_configured: boolean
  config_configured: boolean
  oauth: {
    nous: boolean
    openai_codex: boolean
  }
}

export interface HermesDoctorSummary {
  ok: boolean
  issues_count: number
  manual_issues_count: number
  remaining_issues_count: number
  fixed_count: number
}

interface HermesStatusPayload {
  bootstrap?: HermesBootstrapSummary
  providers?: {
    readiness?: HermesProviderReadiness
  }
  gateway?: Record<string, unknown>
  messaging?: {
    platforms?: Array<Record<string, unknown>>
  }
}

interface HermesDoctorPayload {
  bootstrap?: HermesBootstrapSummary
  summary?: HermesDoctorSummary
  issues?: string[]
  manual_issues?: string[]
}

export interface HermesBootstrapData {
  bootstrap: HermesBootstrapSummary | null
  providerReadiness: HermesProviderReadiness | null
  gateway: Record<string, unknown> | null
  messagingPlatforms: Array<Record<string, unknown>>
  doctor: {
    summary: HermesDoctorSummary | null
    issues: string[]
    manualIssues: string[]
  } | null
}

export interface HermesCommandContext {
  hermesHome: string
  homeDir: string
  binCandidates: string[]
  pathPrefix: string
}

const HERMES_BOOTSTRAP_CACHE_TTL_MS = 30_000
const bootstrapCache = new Map<string, { data: HermesBootstrapData; checkedAt: number }>()

export function getHermesCommandContext(): HermesCommandContext {
  const dataDir = resolve(config.dataDir || '.data')
  const homeDir = config.homeDir || ''
  const hermesHome = existsSync(join(dataDir, '.hermes'))
    ? join(dataDir, '.hermes')
    : existsSync(join(homeDir, '.hermes'))
      ? join(homeDir, '.hermes')
      : join(dataDir, '.hermes')

  return {
    hermesHome,
    homeDir: existsSync(join(dataDir, '.hermes')) ? dataDir : homeDir,
    pathPrefix: join(dataDir, '.local', 'bin'),
    binCandidates: [
      process.env.HERMES_BIN || '',
      join(dataDir, '.local', 'bin', 'hermes'),
      join(dataDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
      join(homeDir, '.local', 'bin', 'hermes'),
      join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
      'hermes-agent',
      'hermes',
    ].filter(Boolean),
  }
}

export function resolveHermesBinary(context = getHermesCommandContext()): string {
  const absolute = context.binCandidates.find((candidate) => candidate.startsWith('/') && existsSync(candidate))
  return absolute || context.binCandidates[context.binCandidates.length - 1] || 'hermes'
}

export function mergeHermesBootstrapData(
  statusPayload: HermesStatusPayload | null,
  doctorPayload: HermesDoctorPayload | null,
): HermesBootstrapData {
  return {
    bootstrap: statusPayload?.bootstrap || doctorPayload?.bootstrap || null,
    providerReadiness: statusPayload?.providers?.readiness || null,
    gateway: statusPayload?.gateway || null,
    messagingPlatforms: statusPayload?.messaging?.platforms || [],
    doctor: doctorPayload
      ? {
          summary: doctorPayload.summary || null,
          issues: doctorPayload.issues || [],
          manualIssues: doctorPayload.manual_issues || [],
        }
      : null,
  }
}

async function runHermesJsonCommand<T>(args: string[], context: HermesCommandContext): Promise<T | null> {
  try {
    const result = await runCommand(resolveHermesBinary(context), args, {
      timeoutMs: 20_000,
      env: {
        ...process.env,
        HOME: context.homeDir,
        HERMES_HOME: context.hermesHome,
        PATH: `${context.pathPrefix}:${process.env.PATH || ''}`,
      },
    })
    return JSON.parse(result.stdout) as T
  } catch (err) {
    logger.warn({ err, args }, 'Failed to read Hermes JSON command output')
    return null
  }
}

export async function loadHermesBootstrapData(context = getHermesCommandContext()): Promise<HermesBootstrapData> {
  const now = Date.now()
  const cacheKey = context.hermesHome
  const cached = bootstrapCache.get(cacheKey)
  if (cached && (now - cached.checkedAt) < HERMES_BOOTSTRAP_CACHE_TTL_MS) {
    return cached.data
  }

  const [statusResult, doctorResult] = await Promise.all([
    runHermesJsonCommand<HermesStatusPayload>(['status', '--json'], context),
    runHermesJsonCommand<HermesDoctorPayload>(['doctor', '--json'], context),
  ])
  const merged = mergeHermesBootstrapData(statusResult, doctorResult)
  bootstrapCache.set(cacheKey, { data: merged, checkedAt: now })
  return merged
}
