import type { HermesSessionStats } from './hermes-sessions'
import type { HermesTaskScanResult } from './hermes-tasks'

export const HERMES_ROUTING_BINDINGS_SETTING_KEY = 'chat.hermes_source_bindings'

export const HERMES_PROFILE_OPTIONS = [
  { value: 'primary', label: 'Primary Hermes profile', description: 'Default shared-home profile for general Hermes work.' },
  { value: 'personal', label: 'Personal Hermes profile', description: 'Use for direct, user-facing conversations and inbox flows.' },
  { value: 'work', label: 'Work Hermes profile', description: 'Use for structured operational and work-facing traffic.' },
  { value: 'automation', label: 'Automation Hermes profile', description: 'Use for cron jobs, background tasks, and unattended work.' },
  { value: 'research', label: 'Research Hermes profile', description: 'Use for exploratory or long-form research-style flows.' },
] as const

export interface HermesMessagingPlatform {
  name?: string
  configured?: boolean
}

export interface HermesGatewaySummary {
  runtime_state?: string | null
  session_count?: number | null
}

export interface HermesRoutingEntry {
  id: string
  label: string
  kind: 'profile' | 'session_source' | 'platform' | 'gateway' | 'automation'
  status: 'shared' | 'active' | 'configured' | 'inactive'
  bindingKey?: string
  profile: string
  count?: number
  activeCount?: number
  detail: string
}

export interface HermesRoutingBindingTarget {
  key: string
  label: string
  kind: 'session_source' | 'platform' | 'gateway' | 'automation'
  status: 'active' | 'configured' | 'inactive'
  profile: string
  detail: string
}

export interface HermesRoutingSummary {
  mode: 'shared_home'
  profileLabel: string
  routes: HermesRoutingEntry[]
  bindingTargets: HermesRoutingBindingTarget[]
  notes: string[]
}

const SOURCE_LABELS: Record<string, string> = {
  cli: 'CLI / local chat',
  local: 'CLI / local chat',
  gateway: 'Gateway API',
  api: 'Gateway API',
  cron: 'Scheduled automation',
  telegram: 'Telegram inbox',
  discord: 'Discord inbox',
  whatsapp: 'WhatsApp inbox',
  slack: 'Slack inbox',
  signal: 'Signal inbox',
  imessage: 'iMessage inbox',
  sms: 'SMS inbox',
  email: 'Email inbox',
}

const PLATFORM_LABELS: Record<string, string> = {
  telegram: 'Telegram inbox',
  discord: 'Discord inbox',
  whatsapp: 'WhatsApp inbox',
  slack: 'Slack inbox',
  signal: 'Signal inbox',
  imessage: 'iMessage inbox',
  nostr: 'Nostr inbox',
  'google chat': 'Google Chat inbox',
  googlechat: 'Google Chat inbox',
  'ms teams': 'MS Teams inbox',
  'ms-teams': 'MS Teams inbox',
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function resolveHermesSourceLabel(source: string | null | undefined): string {
  const normalized = normalizeKey(source) || 'cli'
  return SOURCE_LABELS[normalized] || `${titleCase(normalized)} route`
}

export function resolveHermesProfileLabel(value: string | null | undefined): string {
  const normalized = normalizeKey(value)
  return HERMES_PROFILE_OPTIONS.find((option) => option.value === normalized)?.label || 'Primary Hermes profile'
}

export function resolveHermesProfileValue(value: string | null | undefined): string {
  const normalized = normalizeKey(value)
  return HERMES_PROFILE_OPTIONS.find((option) => option.value === normalized)?.value || 'primary'
}

export function resolveHermesProfileBadgeLabel(value: string | null | undefined): string {
  const label = resolveHermesProfileLabel(value)
  return label.replace(/\s+Hermes profile$/i, '')
}

export function resolveHermesBindingForSource(
  source: string | null | undefined,
  bindings: Record<string, string> = {},
): { sourceKey: string; profile: string; profileLabel: string; profileBadge: string } {
  const sourceKey = normalizeKey(source) || 'cli'
  const profile = resolveHermesProfileValue(bindings[sourceKey])
  return {
    sourceKey,
    profile,
    profileLabel: resolveHermesProfileLabel(profile),
    profileBadge: resolveHermesProfileBadgeLabel(profile),
  }
}

export function parseHermesRoutingBindings(raw: string | null | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const normalizedKey = normalizeKey(key)
        const normalizedValue = normalizeKey(typeof value === 'string' ? value : '')
        if (!normalizedKey || !normalizedValue) return []
        return [[normalizedKey, normalizedValue]]
      }),
    )
  } catch {
    return {}
  }
}

export function stringifyHermesRoutingBindings(bindings: Record<string, string>): string {
  const sanitized = Object.fromEntries(
    Object.entries(bindings)
      .map(([key, value]) => [normalizeKey(key), normalizeKey(value)] as const)
      .filter(([key, value]) => Boolean(key && value)),
  )
  return JSON.stringify(sanitized, null, 2)
}

function formatSessionDetail(total: number, active: number): string {
  if (active > 0) {
    return `${total} session${total === 1 ? '' : 's'} observed, ${active} active now`
  }
  return `${total} session${total === 1 ? '' : 's'} observed`
}

export function buildHermesRoutingSummary(params: {
  sessions: HermesSessionStats[]
  bindings?: Record<string, string>
  messagingPlatforms?: HermesMessagingPlatform[] | null
  gateway?: HermesGatewaySummary | null
  taskSummary?: HermesTaskScanResult['summary'] | null
}): HermesRoutingSummary {
  const bindings = params.bindings || {}
  const bindingTargets = new Map<string, HermesRoutingBindingTarget>()
  const resolveProfile = (bindingKey?: string) => resolveHermesProfileLabel(bindingKey ? bindings[bindingKey] : 'primary')
  const registerBindingTarget = (target: HermesRoutingBindingTarget) => {
    const existing = bindingTargets.get(target.key)
    if (!existing) {
      bindingTargets.set(target.key, target)
      return
    }
    bindingTargets.set(target.key, {
      ...existing,
      label: existing.kind === 'platform' ? existing.label : target.label,
      kind: existing.kind === 'platform' ? existing.kind : target.kind,
      status: existing.status === 'active' || target.status !== 'active' ? existing.status : 'active',
      detail: existing.detail,
      profile: existing.profile,
    })
  }

  const routes: HermesRoutingEntry[] = [
    {
      id: 'shared-profile',
      label: 'Primary Hermes profile',
      kind: 'profile',
      status: 'shared',
      profile: 'Primary Hermes profile',
      detail: 'All detected routes currently share one Hermes home and one provider/tool configuration.',
    },
  ]

  const sessionsBySource = new Map<string, { total: number; active: number }>()
  for (const session of params.sessions) {
    const key = normalizeKey(session.source) || 'cli'
    const current = sessionsBySource.get(key) || { total: 0, active: 0 }
    current.total += 1
    if (session.isActive) current.active += 1
    sessionsBySource.set(key, current)
  }

  for (const [source, counts] of Array.from(sessionsBySource.entries()).sort((a, b) => {
    if (a[1].active !== b[1].active) return b[1].active - a[1].active
    return a[0].localeCompare(b[0])
  })) {
    const label = resolveHermesSourceLabel(source)
    routes.push({
      id: `source-${source}`,
      label,
      kind: 'session_source',
      status: counts.active > 0 ? 'active' : 'configured',
      bindingKey: source,
      profile: resolveProfile(source),
      count: counts.total,
      activeCount: counts.active,
      detail: formatSessionDetail(counts.total, counts.active),
    })
    registerBindingTarget({
      key: source,
      label,
      kind: 'session_source',
      status: counts.active > 0 ? 'active' : 'configured',
      profile: resolveProfile(source),
      detail: formatSessionDetail(counts.total, counts.active),
    })
  }

  const configuredPlatforms = (params.messagingPlatforms || [])
    .filter((platform): platform is HermesMessagingPlatform & { name: string } => Boolean(platform?.configured && platform?.name))

  for (const platform of configuredPlatforms.sort((a, b) => a.name.localeCompare(b.name))) {
    const key = normalizeKey(platform.name)
    const sourceCounts = sessionsBySource.get(key)
    routes.push({
      id: `platform-${key}`,
      label: PLATFORM_LABELS[key] || `${titleCase(platform.name)} inbox`,
      kind: 'platform',
      status: sourceCounts?.active ? 'active' : 'configured',
      bindingKey: key,
      profile: resolveProfile(key),
      count: sourceCounts?.total || undefined,
      activeCount: sourceCounts?.active || undefined,
      detail: sourceCounts
        ? formatSessionDetail(sourceCounts.total, sourceCounts.active)
        : 'Configured in Hermes, waiting for the next inbound session.',
    })
    registerBindingTarget({
      key,
      label: PLATFORM_LABELS[key] || `${titleCase(platform.name)} inbox`,
      kind: 'platform',
      status: sourceCounts?.active ? 'active' : 'configured',
      profile: resolveProfile(key),
      detail: sourceCounts
        ? formatSessionDetail(sourceCounts.total, sourceCounts.active)
        : 'Configured in Hermes, waiting for the next inbound session.',
    })
  }

  const gatewayRunning = params.gateway?.runtime_state === 'running'
  const gatewaySessionCount = typeof params.gateway?.session_count === 'number' ? params.gateway.session_count : 0
  routes.push({
    id: 'gateway-runtime',
    label: 'Gateway / API runtime',
    kind: 'gateway',
    status: gatewayRunning ? 'active' : gatewaySessionCount > 0 ? 'configured' : 'inactive',
    bindingKey: 'gateway',
    profile: resolveProfile('gateway'),
    count: gatewaySessionCount || undefined,
    detail: gatewayRunning
      ? `${gatewaySessionCount} gateway session${gatewaySessionCount === 1 ? '' : 's'} currently attached`
      : gatewaySessionCount > 0
        ? `${gatewaySessionCount} gateway session${gatewaySessionCount === 1 ? '' : 's'} recorded, runtime not currently running`
        : 'Gateway runtime is not active right now.',
  })
  registerBindingTarget({
    key: 'gateway',
    label: 'Gateway / API runtime',
    kind: 'gateway',
    status: gatewayRunning ? 'active' : gatewaySessionCount > 0 ? 'configured' : 'inactive',
    profile: resolveProfile('gateway'),
    detail: gatewayRunning
      ? `${gatewaySessionCount} gateway session${gatewaySessionCount === 1 ? '' : 's'} currently attached`
      : gatewaySessionCount > 0
        ? `${gatewaySessionCount} gateway session${gatewaySessionCount === 1 ? '' : 's'} recorded, runtime not currently running`
        : 'Gateway runtime is not active right now.',
  })

  const taskSummary = params.taskSummary
  if (taskSummary && taskSummary.total > 0) {
    const detailBits = [
      `${taskSummary.total} cron job${taskSummary.total === 1 ? '' : 's'}`,
      taskSummary.failing > 0 ? `${taskSummary.failing} failing` : null,
      taskSummary.paused > 0 ? `${taskSummary.paused} paused` : null,
    ].filter(Boolean)

    routes.push({
      id: 'automation',
      label: 'Scheduled automation',
      kind: 'automation',
      status: taskSummary.failing > 0 ? 'active' : taskSummary.scheduled > 0 ? 'configured' : 'inactive',
      bindingKey: 'cron',
      profile: resolveProfile('cron'),
      count: taskSummary.total,
      activeCount: taskSummary.scheduled,
      detail: detailBits.join(' · '),
    })
    registerBindingTarget({
      key: 'cron',
      label: 'Scheduled automation',
      kind: 'automation',
      status: taskSummary.failing > 0 ? 'active' : taskSummary.scheduled > 0 ? 'configured' : 'inactive',
      profile: resolveProfile('cron'),
      detail: detailBits.join(' · '),
    })
  }

  return {
    mode: 'shared_home',
    profileLabel: 'Primary Hermes profile',
    routes,
    bindingTargets: Array.from(bindingTargets.values()).sort((a, b) => a.label.localeCompare(b.label)),
    notes: [
      'Hermes personas are not split at runtime yet. These bindings are stored in Mission Control today so operators can plan and review the intended routing model.',
    ],
  }
}
