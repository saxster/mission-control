import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { getDatabase, logAuditEvent } from '@/lib/db'
import type { KnowledgeBaseContext } from '@/lib/knowledge-base'
import { scanMemoryFiles } from '@/lib/memory-utils'

export const KNOWLEDGE_BASE_GOVERNANCE_DOMAINS = [
  'general',
  'programming',
  'medicine',
  'security',
  'legal',
  'finance',
] as const

export const KNOWLEDGE_BASE_SOURCE_TYPES = [
  'official_docs',
  'official_guidance',
  'peer_reviewed',
  'standards',
  'vendor',
  'expert_secondary',
  'community',
  'anonymous',
  'user_authored',
  'generated_summary',
] as const

export const KNOWLEDGE_BASE_GOVERNANCE_INGESTION_METHODS = [
  'manual',
  'legacy_compat',
  'system_derived',
] as const

export type KnowledgeBaseGovernanceDomain = typeof KNOWLEDGE_BASE_GOVERNANCE_DOMAINS[number]
export type KnowledgeBaseSourceType = typeof KNOWLEDGE_BASE_SOURCE_TYPES[number]
export type KnowledgeBaseGovernanceIngestionMethod = typeof KNOWLEDGE_BASE_GOVERNANCE_INGESTION_METHODS[number]
export type KnowledgeBaseGovernanceRiskLevel = 'low' | 'high' | 'critical'
export type KnowledgeBaseGovernanceQualityLabel = 'trusted' | 'supported' | 'caution' | 'low-confidence'
export type KnowledgeBaseGovernanceReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'approved_with_warnings'
  | 'override_required'
  | 'overridden'

export interface KnowledgeBaseSourceInput {
  title: string
  url?: string | null
  sourceType: KnowledgeBaseSourceType
  publisher?: string | null
  author?: string | null
  publishedAt?: string | null
}

export interface KnowledgeBaseGovernanceInput {
  domain: KnowledgeBaseGovernanceDomain
  sources: KnowledgeBaseSourceInput[]
  allowLowerQualitySources?: boolean
  overrideReason?: string | null
}

export interface KnowledgeBaseGovernanceWarning {
  code: string
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export interface KnowledgeBaseSourceVerificationResult {
  sourceUrl: string | null
  checkedAt: number
  requestedUrl: string | null
  finalUrl: string | null
  normalizedHost: string | null
  finalHost: string | null
  redirectTarget: string | null
  httpStatus: number | null
  contentType: string | null
  https: boolean
  authoritativeHostMatch: boolean
  verificationState: 'skipped' | 'verified' | 'warning' | 'blocked'
  verified: boolean
  lastModified: string | null
  publishedAt: string | null
  failureCode: string | null
  failureMessage: string | null
}

export interface KnowledgeBaseSourceAssessment {
  source: KnowledgeBaseSourceInput
  baseScore: number
  adjustedScore: number
  warnings: KnowledgeBaseGovernanceWarning[]
  authoritativeByType: boolean
  authoritativeByHost: boolean
  authoritative: boolean
  lowQuality: boolean
  stale: boolean
  blockingCodes: string[]
  verification: KnowledgeBaseSourceVerificationResult | null
}

export interface KnowledgeBaseGovernanceReview {
  domain: KnowledgeBaseGovernanceDomain
  riskLevel: KnowledgeBaseGovernanceRiskLevel
  qualityScore: number
  qualityLabel: KnowledgeBaseGovernanceQualityLabel
  reviewStatus: KnowledgeBaseGovernanceReviewStatus
  sourceCount: number
  warnings: KnowledgeBaseGovernanceWarning[]
  recommendedSourceTypes: KnowledgeBaseSourceType[]
  hasAuthoritativeSource: boolean
  hasLowQualitySources: boolean
  requiresUserOverride: boolean
  overrideUsed: boolean
  overrideReason: string | null
  sources: KnowledgeBaseSourceInput[]
  sourceAssessments: KnowledgeBaseSourceAssessment[]
  verificationResults: KnowledgeBaseSourceVerificationResult[]
  ingestionMethod: KnowledgeBaseGovernanceIngestionMethod
}

export interface KnowledgeBaseGovernanceRecord extends KnowledgeBaseGovernanceReview {
  id: number
  runtimeProfileName: string
  path: string
  contentHash: string | null
  actor: string
  createdAt: number
}

export interface KnowledgeBaseGovernanceSummary {
  reviewStatus: KnowledgeBaseGovernanceReviewStatus
  qualityLabel: KnowledgeBaseGovernanceQualityLabel
  riskLevel: KnowledgeBaseGovernanceRiskLevel
  overrideUsed: boolean
  warningCount: number
  warnings: KnowledgeBaseGovernanceWarning[]
}

interface DomainPolicy {
  riskLevel: KnowledgeBaseGovernanceRiskLevel
  preferredSourceTypes: KnowledgeBaseSourceType[]
  authoritativeSourceTypes: KnowledgeBaseSourceType[]
  staleAfterDays: number
}

type GovernanceRow = {
  id: number
  runtime_profile_name: string
  path: string
  content_hash: string | null
  domain: string
  risk_level: string
  quality_score: number
  quality_label: KnowledgeBaseGovernanceQualityLabel
  review_status: KnowledgeBaseGovernanceReviewStatus
  override_used: number
  override_reason: string | null
  source_count: number
  warnings_json: string | null
  sources_json: string | null
  source_assessments_json: string | null
  verification_json: string | null
  ingestion_method: KnowledgeBaseGovernanceIngestionMethod | null
  actor: string
  created_at: number
}

export interface KnowledgeBaseGovernanceQueueItem {
  path: string
  pageType: string
  record: KnowledgeBaseGovernanceRecord
  current: boolean
}

export interface KnowledgeBaseGovernanceQueueFilters {
  reviewStatus?: KnowledgeBaseGovernanceReviewStatus | 'all'
  riskLevel?: KnowledgeBaseGovernanceRiskLevel | 'all'
  domain?: KnowledgeBaseGovernanceDomain | 'all'
  overrideUsed?: boolean
  unreviewedOnly?: boolean
  limit?: number
}

export interface KnowledgeBaseGovernanceQueueResult {
  items: KnowledgeBaseGovernanceQueueItem[]
  totalPages: number
  stats: {
    unreviewed: number
    overridden: number
    highRisk: number
    warnings: number
    backfillEligible: number
  }
}

interface AuthoritativeHostRegistry {
  authoritativeHosts: Record<KnowledgeBaseGovernanceDomain, string[]>
  nonHttpsAllowlist: string[]
}

interface VerificationOptions {
  fetchImpl?: typeof fetch
  lookupImpl?: typeof dnsLookup
  registry?: AuthoritativeHostRegistry
}

interface ReviewKnowledgeBaseGovernanceOptions extends VerificationOptions {
  ingestionMethod?: KnowledgeBaseGovernanceIngestionMethod
}

const DOMAIN_POLICIES: Record<KnowledgeBaseGovernanceDomain, DomainPolicy> = {
  general: {
    riskLevel: 'low',
    preferredSourceTypes: ['official_docs', 'expert_secondary', 'community'],
    authoritativeSourceTypes: ['official_docs', 'official_guidance', 'peer_reviewed', 'standards', 'vendor'],
    staleAfterDays: 365 * 5,
  },
  programming: {
    riskLevel: 'high',
    preferredSourceTypes: ['official_docs', 'standards', 'vendor', 'expert_secondary'],
    authoritativeSourceTypes: ['official_docs', 'standards', 'vendor'],
    staleAfterDays: 365 * 3,
  },
  medicine: {
    riskLevel: 'critical',
    preferredSourceTypes: ['official_guidance', 'peer_reviewed', 'standards'],
    authoritativeSourceTypes: ['official_guidance', 'peer_reviewed', 'standards'],
    staleAfterDays: 365 * 2,
  },
  security: {
    riskLevel: 'critical',
    preferredSourceTypes: ['official_docs', 'vendor', 'standards', 'peer_reviewed'],
    authoritativeSourceTypes: ['official_docs', 'vendor', 'standards', 'peer_reviewed'],
    staleAfterDays: 365 * 2,
  },
  legal: {
    riskLevel: 'critical',
    preferredSourceTypes: ['official_guidance', 'standards', 'peer_reviewed'],
    authoritativeSourceTypes: ['official_guidance', 'standards'],
    staleAfterDays: 365 * 2,
  },
  finance: {
    riskLevel: 'critical',
    preferredSourceTypes: ['official_guidance', 'official_docs', 'vendor', 'peer_reviewed'],
    authoritativeSourceTypes: ['official_guidance', 'official_docs', 'vendor'],
    staleAfterDays: 365 * 2,
  },
}

const SOURCE_QUALITY_SCORES: Record<KnowledgeBaseSourceType, number> = {
  official_docs: 92,
  official_guidance: 95,
  peer_reviewed: 93,
  standards: 90,
  vendor: 86,
  expert_secondary: 72,
  community: 45,
  anonymous: 20,
  user_authored: 35,
  generated_summary: 25,
}

const DEFAULT_AUTHORITATIVE_HOSTS: Record<KnowledgeBaseGovernanceDomain, string[]> = {
  general: [],
  programming: ['developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'nextjs.org', 'react.dev', 'typescriptlang.org'],
  medicine: ['cdc.gov', 'ema.europa.eu', 'fda.gov', 'nejm.org', 'nih.gov', 'who.int'],
  security: ['cisa.gov', 'cve.org', 'developer.mozilla.org', 'nist.gov', 'owasp.org'],
  legal: ['eur-lex.europa.eu', 'gov.in', 'legislation.gov.uk', 'supremecourt.gov', 'uscourts.gov'],
  finance: ['bis.org', 'imf.org', 'rbi.org.in', 'sec.gov', 'worldbank.org'],
}

const DEFAULT_NON_HTTPS_ALLOWLIST = ['localhost']

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function normalizeDomain(value: unknown): KnowledgeBaseGovernanceDomain {
  if (typeof value === 'string' && (KNOWLEDGE_BASE_GOVERNANCE_DOMAINS as readonly string[]).includes(value)) {
    return value as KnowledgeBaseGovernanceDomain
  }
  return 'general'
}

function normalizeSourceType(value: unknown): KnowledgeBaseSourceType {
  if (typeof value === 'string' && (KNOWLEDGE_BASE_SOURCE_TYPES as readonly string[]).includes(value)) {
    return value as KnowledgeBaseSourceType
  }
  return 'community'
}

function normalizeIngestionMethod(value: unknown): KnowledgeBaseGovernanceIngestionMethod {
  if (typeof value === 'string' && (KNOWLEDGE_BASE_GOVERNANCE_INGESTION_METHODS as readonly string[]).includes(value)) {
    return value as KnowledgeBaseGovernanceIngestionMethod
  }
  return 'manual'
}

function normalizeSource(source: unknown): KnowledgeBaseSourceInput | null {
  if (!source || typeof source !== 'object') return null
  const record = source as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  const publisher = typeof record.publisher === 'string' ? record.publisher.trim() : ''
  const author = typeof record.author === 'string' ? record.author.trim() : ''
  const publishedAt = typeof record.publishedAt === 'string' ? record.publishedAt.trim() : ''
  const sourceType = normalizeSourceType(record.sourceType)

  if (!title && !url && !publisher && !author && !publishedAt) return null

  return {
    title: title || url || publisher || 'Untitled source',
    url: url || null,
    publisher: publisher || null,
    author: author || null,
    publishedAt: publishedAt || null,
    sourceType,
  }
}

export function normalizeKnowledgeBaseGovernanceInput(
  value: unknown,
  fallback?: Partial<KnowledgeBaseGovernanceInput> | null,
): KnowledgeBaseGovernanceInput {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const fallbackSources = Array.isArray(fallback?.sources) ? fallback?.sources ?? [] : []
  const rawSources = Array.isArray(record.sources) ? record.sources : fallbackSources
  const sources = rawSources.map((source) => normalizeSource(source)).filter((source): source is KnowledgeBaseSourceInput => Boolean(source))
  const overrideReasonValue = typeof record.overrideReason === 'string'
    ? record.overrideReason.trim()
    : typeof fallback?.overrideReason === 'string'
      ? fallback.overrideReason.trim()
      : ''

  return {
    domain: normalizeDomain(record.domain ?? fallback?.domain),
    sources,
    allowLowerQualitySources: Boolean(record.allowLowerQualitySources ?? fallback?.allowLowerQualitySources),
    overrideReason: overrideReasonValue || null,
  }
}

function parsePublishedAt(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  return host.trim().replace(/\.$/, '').toLowerCase() || null
}

function hostMatches(host: string | null | undefined, candidate: string | null | undefined) {
  const normalizedHost = normalizeHost(host)
  const normalizedCandidate = normalizeHost(candidate)
  if (!normalizedHost || !normalizedCandidate) return false
  return normalizedHost === normalizedCandidate || normalizedHost.endsWith(`.${normalizedCandidate}`)
}

function isLocalHostname(host: string): boolean {
  const normalized = normalizeHost(host)
  if (!normalized) return true
  return normalized === 'localhost'
    || normalized === '0.0.0.0'
    || normalized === '[::1]'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
}

function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const parts = address.split('.').map((part) => Number.parseInt(part, 10))
    const [a = 0, b = 0] = parts
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true
    return false
  }
  if (family === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80')
      || normalized.startsWith('::ffff:127.')
  }
  return false
}

function parseRegistryValue(value: string | null): Partial<Record<KnowledgeBaseGovernanceDomain, string[]>> | null {
  if (!value) return null
  const parsed = safeJsonParse<Record<string, unknown>>(value)
  if (!parsed || typeof parsed !== 'object') return null
  const next: Partial<Record<KnowledgeBaseGovernanceDomain, string[]>> = {}
  for (const domain of KNOWLEDGE_BASE_GOVERNANCE_DOMAINS) {
    const raw = parsed[domain]
    if (!Array.isArray(raw)) continue
    next[domain] = raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeHost(entry))
      .filter((entry): entry is string => Boolean(entry))
  }
  return next
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  const parsed = safeJsonParse<unknown[]>(value)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeHost(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function readSettingValue(key: string): string | null {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
    return typeof row?.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

export function getKnowledgeBaseAuthoritativeHostRegistry(): AuthoritativeHostRegistry {
  const settingsHosts = parseRegistryValue(readSettingValue('knowledge_base.governance.authoritative_hosts_json'))
  const envHosts = parseRegistryValue((process.env.MC_KB_GOVERNANCE_AUTHORITATIVE_HOSTS_JSON || '').trim())
  const settingsHttp = parseStringArray(readSettingValue('knowledge_base.governance.http_allowlist_json'))
  const envHttp = parseStringArray((process.env.MC_KB_GOVERNANCE_HTTP_ALLOWLIST_JSON || '').trim())

  const authoritativeHosts = {} as Record<KnowledgeBaseGovernanceDomain, string[]>
  for (const domain of KNOWLEDGE_BASE_GOVERNANCE_DOMAINS) {
    authoritativeHosts[domain] = Array.from(new Set([
      ...DEFAULT_AUTHORITATIVE_HOSTS[domain],
      ...(settingsHosts?.[domain] || []),
      ...(envHosts?.[domain] || []),
    ].map((entry) => normalizeHost(entry)).filter((entry): entry is string => Boolean(entry))))
  }

  return {
    authoritativeHosts,
    nonHttpsAllowlist: Array.from(new Set([
      ...DEFAULT_NON_HTTPS_ALLOWLIST,
      ...settingsHttp,
      ...envHttp,
    ].map((entry) => normalizeHost(entry)).filter((entry): entry is string => Boolean(entry)))),
  }
}

function isHighRiskDomain(domain: KnowledgeBaseGovernanceDomain) {
  return DOMAIN_POLICIES[domain].riskLevel !== 'low'
}

function buildVerificationWarning(code: string, message: string, severity: 'warning' | 'critical' = 'warning'): KnowledgeBaseGovernanceWarning {
  return { code, severity, message }
}

async function resolveHostSafety(
  host: string,
  lookupImpl: typeof dnsLookup,
): Promise<{ blocked: boolean; code?: string; message?: string }> {
  if (isLocalHostname(host)) {
    return {
      blocked: true,
      code: 'unsafe-local-host',
      message: `The source host "${host}" resolves to a local or private hostname and cannot be used for Knowledge Base verification.`,
    }
  }
  if (isIP(host) && isPrivateOrReservedIp(host)) {
    return {
      blocked: true,
      code: 'unsafe-private-ip',
      message: `The source host "${host}" points to a private or reserved IP range and cannot be used for Knowledge Base verification.`,
    }
  }

  try {
    const records = await lookupImpl(host, { all: true })
    if (records.some((record) => isPrivateOrReservedIp(record.address))) {
      return {
        blocked: true,
        code: 'unsafe-private-ip',
        message: `The source host "${host}" resolved to a private or reserved network location and was blocked.`,
      }
    }
  } catch (error) {
    return {
      blocked: false,
      code: 'verification-dns-failed',
      message: `Mission Control could not verify DNS for "${host}" (${(error as Error).message || 'unknown error'}).`,
    }
  }

  return { blocked: false }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        'User-Agent': 'MissionControl-KB-Governance/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function verifyKnowledgeBaseSourceUrl(
  source: KnowledgeBaseSourceInput,
  domain: KnowledgeBaseGovernanceDomain,
  options: VerificationOptions = {},
): Promise<KnowledgeBaseSourceVerificationResult> {
  const checkedAt = Date.now()
  const registry = options.registry || getKnowledgeBaseAuthoritativeHostRegistry()
  const fetchImpl = options.fetchImpl || fetch
  const lookupImpl = options.lookupImpl || dnsLookup

  const result: KnowledgeBaseSourceVerificationResult = {
    sourceUrl: source.url || null,
    checkedAt,
    requestedUrl: source.url || null,
    finalUrl: source.url || null,
    normalizedHost: null,
    finalHost: null,
    redirectTarget: null,
    httpStatus: null,
    contentType: null,
    https: false,
    authoritativeHostMatch: false,
    verificationState: 'skipped',
    verified: false,
    lastModified: null,
    publishedAt: null,
    failureCode: null,
    failureMessage: null,
  }

  if (!source.url || !isHighRiskDomain(domain)) return result

  let current: URL
  try {
    current = new URL(source.url)
  } catch {
    return {
      ...result,
      verificationState: 'blocked',
      failureCode: 'invalid-url',
      failureMessage: `The source URL "${source.url}" is not a valid absolute URL.`,
    }
  }

  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    return {
      ...result,
      verificationState: 'blocked',
      failureCode: 'unsupported-protocol',
      failureMessage: `Only http and https URLs are allowed for source verification, but "${current.protocol}" was provided.`,
    }
  }

  const initialSafety = await resolveHostSafety(current.hostname, lookupImpl)
  if (initialSafety.blocked) {
    return {
      ...result,
      normalizedHost: normalizeHost(current.hostname),
      finalHost: normalizeHost(current.hostname),
      https: current.protocol === 'https:',
      verificationState: 'blocked',
      failureCode: initialSafety.code || 'unsafe-host',
      failureMessage: initialSafety.message || 'The source host was rejected as unsafe.',
    }
  }

  if (current.protocol !== 'https:' && !registry.nonHttpsAllowlist.some((entry) => hostMatches(current.hostname, entry))) {
    return {
      ...result,
      normalizedHost: normalizeHost(current.hostname),
      finalHost: normalizeHost(current.hostname),
      verificationState: 'blocked',
      failureCode: 'https-required',
      failureMessage: `High-risk Knowledge Base sources must use HTTPS. "${current.hostname}" was provided over HTTP.`,
    }
  }

  let finalResponse: Response | null = null
  let warningCode = initialSafety.code || null
  let warningMessage = initialSafety.message || null
  let redirects = 0

  while (redirects <= 3) {
    try {
      const response = await fetchWithTimeout(fetchImpl, current.toString())
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const next = new URL(response.headers.get('location') || '', current)
        const safety = await resolveHostSafety(next.hostname, lookupImpl)
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return {
            ...result,
            normalizedHost: normalizeHost(current.hostname),
            finalHost: normalizeHost(next.hostname),
            redirectTarget: next.toString(),
            https: next.protocol === 'https:',
            verificationState: 'blocked',
            failureCode: 'redirect-unsupported-protocol',
            failureMessage: `The source redirected to "${next.protocol}", which is not allowed for Knowledge Base verification.`,
          }
        }
        if (next.protocol !== 'https:' && !registry.nonHttpsAllowlist.some((entry) => hostMatches(next.hostname, entry))) {
          return {
            ...result,
            normalizedHost: normalizeHost(current.hostname),
            finalHost: normalizeHost(next.hostname),
            redirectTarget: next.toString(),
            https: false,
            verificationState: 'blocked',
            failureCode: 'https-required',
            failureMessage: `The source redirected to non-HTTPS host "${next.hostname}", which is not allowed for high-risk Knowledge Base sources.`,
          }
        }
        if (safety.blocked) {
          return {
            ...result,
            normalizedHost: normalizeHost(current.hostname),
            finalHost: normalizeHost(next.hostname),
            redirectTarget: next.toString(),
            https: next.protocol === 'https:',
            verificationState: 'blocked',
            failureCode: safety.code || 'unsafe-host',
            failureMessage: safety.message || 'The redirect target was rejected as unsafe.',
          }
        }
        result.redirectTarget = next.toString()
        current = next
        redirects += 1
        warningCode = safety.code || warningCode
        warningMessage = safety.message || warningMessage
        continue
      }

      finalResponse = response
      break
    } catch (error) {
      return {
        ...result,
        normalizedHost: normalizeHost(current.hostname),
        finalHost: normalizeHost(current.hostname),
        https: current.protocol === 'https:',
        verificationState: 'warning',
        failureCode: error instanceof DOMException && error.name === 'AbortError' ? 'verification-timeout' : 'verification-fetch-failed',
        failureMessage: `Mission Control could not complete live verification for "${source.url}" (${(error as Error).message || 'network error'}).`,
      }
    }
  }

  if (!finalResponse) {
    return {
      ...result,
      normalizedHost: normalizeHost(current.hostname),
      finalHost: normalizeHost(current.hostname),
      https: current.protocol === 'https:',
      verificationState: 'warning',
      failureCode: 'redirect-limit-exceeded',
      failureMessage: `Mission Control stopped following redirects for "${source.url}" after 3 hops.`,
    }
  }

  const finalHost = normalizeHost(current.hostname)
  const authoritativeHostMatch = registry.authoritativeHosts[domain].some((entry) => hostMatches(finalHost, entry))
  return {
    ...result,
    finalUrl: current.toString(),
    normalizedHost: normalizeHost(new URL(source.url).hostname),
    finalHost,
    httpStatus: finalResponse.status,
    contentType: finalResponse.headers.get('content-type'),
    https: current.protocol === 'https:',
    authoritativeHostMatch,
    verificationState: finalResponse.ok ? (warningCode ? 'warning' : 'verified') : 'warning',
    verified: finalResponse.ok,
    lastModified: finalResponse.headers.get('last-modified'),
    publishedAt: finalResponse.headers.get('x-published-at') || null,
    failureCode: finalResponse.ok ? warningCode : `http-${finalResponse.status}`,
    failureMessage: finalResponse.ok
      ? warningMessage
      : `Mission Control received HTTP ${finalResponse.status} while verifying "${source.url}".`,
  }
}

function buildUnreviewedWarning(path?: string): KnowledgeBaseGovernanceWarning {
  return {
    code: 'unreviewed',
    severity: 'warning',
    message: path
      ? `This page (${path}) has not been reviewed under the new Knowledge Base governance policy yet.`
      : 'This page has not been reviewed under the new Knowledge Base governance policy yet.',
  }
}

export function buildUnreviewedKnowledgeBaseGovernanceReview(
  path?: string,
  ingestionMethod: KnowledgeBaseGovernanceIngestionMethod = 'system_derived',
): KnowledgeBaseGovernanceReview {
  return {
    domain: 'general',
    riskLevel: 'low',
    qualityScore: 0,
    qualityLabel: 'low-confidence',
    reviewStatus: 'unreviewed',
    sourceCount: 0,
    warnings: [buildUnreviewedWarning(path)],
    recommendedSourceTypes: DOMAIN_POLICIES.general.preferredSourceTypes,
    hasAuthoritativeSource: false,
    hasLowQualitySources: true,
    requiresUserOverride: false,
    overrideUsed: false,
    overrideReason: null,
    sources: [],
    sourceAssessments: [],
    verificationResults: [],
    ingestionMethod,
  }
}

function buildSyntheticKnowledgeBaseGovernanceRecord(
  runtimeProfileName: string,
  path: string,
  existing?: Partial<KnowledgeBaseGovernanceRecord>,
): KnowledgeBaseGovernanceRecord {
  const review = buildUnreviewedKnowledgeBaseGovernanceReview(path, existing?.ingestionMethod || 'system_derived')
  return {
    id: existing?.id || 0,
    runtimeProfileName,
    path,
    contentHash: existing?.contentHash || null,
    actor: existing?.actor || 'system',
    createdAt: existing?.createdAt || 0,
    ...review,
  }
}

function mapGovernanceRow(row: GovernanceRow | undefined): KnowledgeBaseGovernanceRecord | null {
  if (!row) return null
  const domain = normalizeDomain(row.domain)
  const sources = safeJsonParse<KnowledgeBaseSourceInput[]>(row.sources_json) || []
  return {
    id: row.id,
    runtimeProfileName: row.runtime_profile_name,
    path: row.path,
    contentHash: row.content_hash,
    domain,
    riskLevel: row.risk_level as KnowledgeBaseGovernanceRiskLevel,
    qualityScore: row.quality_score,
    qualityLabel: row.quality_label,
    reviewStatus: row.review_status,
    sourceCount: row.source_count,
    warnings: safeJsonParse<KnowledgeBaseGovernanceWarning[]>(row.warnings_json) || [],
    recommendedSourceTypes: DOMAIN_POLICIES[domain].preferredSourceTypes,
    hasAuthoritativeSource: (safeJsonParse<KnowledgeBaseSourceAssessment[]>(row.source_assessments_json) || []).some((assessment) => assessment.authoritative),
    hasLowQualitySources: (safeJsonParse<KnowledgeBaseSourceAssessment[]>(row.source_assessments_json) || []).some((assessment) => assessment.lowQuality),
    requiresUserOverride: row.review_status === 'override_required',
    overrideUsed: row.override_used === 1,
    overrideReason: row.override_reason,
    sources,
    sourceAssessments: safeJsonParse<KnowledgeBaseSourceAssessment[]>(row.source_assessments_json) || [],
    verificationResults: safeJsonParse<KnowledgeBaseSourceVerificationResult[]>(row.verification_json) || [],
    ingestionMethod: normalizeIngestionMethod(row.ingestion_method),
    actor: row.actor,
    createdAt: row.created_at,
  }
}

function scoreSourceAssessment(args: {
  source: KnowledgeBaseSourceInput
  policy: DomainPolicy
  nowMs: number
  verification: KnowledgeBaseSourceVerificationResult | null
}): KnowledgeBaseSourceAssessment {
  const { source, policy, nowMs, verification } = args
  const warnings: KnowledgeBaseGovernanceWarning[] = []
  const blockingCodes: string[] = []
  let adjustedScore = SOURCE_QUALITY_SCORES[source.sourceType]

  const freshnessDate = parsePublishedAt(source.publishedAt) || parsePublishedAt(verification?.publishedAt) || parsePublishedAt(verification?.lastModified)

  if (!freshnessDate && policy.riskLevel !== 'low') {
    warnings.push(buildVerificationWarning(
      'missing-date',
      `"${source.title}" is missing a publication date, which makes recency checks harder in a high-risk domain.`,
    ))
    adjustedScore -= 8
  }

  if (freshnessDate) {
    const ageDays = Math.floor((nowMs - freshnessDate.getTime()) / 86_400_000)
    if (ageDays > policy.staleAfterDays) {
      warnings.push({
        code: 'stale-source',
        severity: policy.riskLevel === 'critical' ? 'critical' : 'warning',
        message: `"${source.title}" appears stale for ${policy.riskLevel === 'critical' ? 'this critical domain' : 'this domain'} (${ageDays} days old).`,
      })
      adjustedScore -= policy.riskLevel === 'critical' ? 24 : 12
    }
  }

  if (source.sourceType === 'generated_summary') {
    warnings.push({
      code: 'generated-summary',
      severity: policy.riskLevel === 'low' ? 'warning' : 'critical',
      message: `"${source.title}" is marked as generated summary material and should not be the primary basis for durable knowledge.`,
    })
    if (policy.riskLevel !== 'low') blockingCodes.push('generated-summary')
  }

  if (source.sourceType === 'anonymous') {
    warnings.push({
      code: 'anonymous-source',
      severity: policy.riskLevel === 'low' ? 'warning' : 'critical',
      message: `"${source.title}" has anonymous/unclear provenance.`,
    })
    if (policy.riskLevel !== 'low') blockingCodes.push('anonymous-source')
  }

  if (verification?.verificationState === 'blocked') {
    warnings.push({
      code: verification.failureCode || 'verification-blocked',
      severity: 'critical',
      message: verification.failureMessage || `"${source.title}" failed source verification.`,
    })
    adjustedScore -= 35
    blockingCodes.push(verification.failureCode || 'verification-blocked')
  } else if (verification?.verificationState === 'warning') {
    warnings.push({
      code: verification.failureCode || 'verification-warning',
      severity: 'warning',
      message: verification.failureMessage || `"${source.title}" could not be fully verified.`,
    })
    adjustedScore -= 10
  }

  if (verification?.httpStatus && verification.httpStatus >= 400) {
    warnings.push({
      code: 'verification-http-status',
      severity: 'warning',
      message: `"${source.title}" returned HTTP ${verification.httpStatus} during live verification.`,
    })
    adjustedScore -= 10
  }

  const authoritativeByType = policy.authoritativeSourceTypes.includes(source.sourceType)
  const authoritativeByHost = Boolean(verification?.authoritativeHostMatch)
  const authoritative = authoritativeByHost || authoritativeByType

  const lowQuality = adjustedScore < 55

  return {
    source,
    baseScore: SOURCE_QUALITY_SCORES[source.sourceType],
    adjustedScore: Math.max(0, Math.min(100, Math.round(adjustedScore))),
    warnings,
    authoritativeByType,
    authoritativeByHost,
    authoritative,
    lowQuality,
    stale: warnings.some((warning) => warning.code === 'stale-source'),
    blockingCodes,
    verification,
  }
}

function buildGovernanceReview(
  input: KnowledgeBaseGovernanceInput,
  sourceAssessments: KnowledgeBaseSourceAssessment[],
  ingestionMethod: KnowledgeBaseGovernanceIngestionMethod = 'manual',
): KnowledgeBaseGovernanceReview {
  const policy = DOMAIN_POLICIES[input.domain]
  const warnings: KnowledgeBaseGovernanceWarning[] = []
  const blockingCodes = new Set<string>()

  if (input.sources.length === 0) {
    warnings.push({
      code: 'missing-sources',
      severity: policy.riskLevel === 'low' ? 'warning' : 'critical',
      message: policy.riskLevel === 'low'
        ? 'No sources were supplied. This page will be treated as user-authored working knowledge.'
        : `No sources were supplied for a ${input.domain} page. High-risk domains should not enter the Knowledge Base without provenance.`,
    })
    if (policy.riskLevel !== 'low') blockingCodes.add('missing-sources')
  }

  for (const assessment of sourceAssessments) {
    for (const warning of assessment.warnings) warnings.push(warning)
    for (const code of assessment.blockingCodes) blockingCodes.add(code)
  }

  const sourceScores = sourceAssessments.map((assessment) => assessment.adjustedScore)
  const qualityScore = sourceScores.length > 0
    ? Math.round(sourceScores.reduce((sum, score) => sum + score, 0) / sourceScores.length)
    : 0
  const hasAuthoritativeSource = sourceAssessments.some((assessment) => assessment.authoritative)
  const hasLowQualitySources = sourceAssessments.some((assessment) => assessment.lowQuality)

  if (!hasAuthoritativeSource && input.sources.length > 0 && policy.riskLevel !== 'low') {
    warnings.push({
      code: 'missing-authoritative-source',
      severity: policy.riskLevel === 'critical' ? 'critical' : 'warning',
      message: `No authoritative sources were provided for this ${input.domain} page. Preferred sources: ${policy.preferredSourceTypes.join(', ')}.`,
    })
    blockingCodes.add('missing-authoritative-source')
  }

  if (hasLowQualitySources) {
    warnings.push({
      code: 'low-quality-sources',
      severity: policy.riskLevel === 'critical' ? 'critical' : 'warning',
      message: 'One or more sources are community, anonymous, generated, stale, or otherwise low-confidence. They should not silently mix with trusted knowledge.',
    })
    if (policy.riskLevel !== 'low') blockingCodes.add('low-quality-sources')
  }

  if (qualityScore < 60 && policy.riskLevel !== 'low' && input.sources.length > 0) {
    warnings.push({
      code: 'low-quality-score',
      severity: 'critical',
      message: `Overall source quality is too weak (${qualityScore}/100) for the selected ${input.domain} domain without an explicit override.`,
    })
    blockingCodes.add('low-quality-score')
  }

  const overrideReason = input.overrideReason?.trim() || null
  const overrideUsed = Boolean(input.allowLowerQualitySources && overrideReason)
  const requiresUserOverride = blockingCodes.size > 0 && !overrideUsed

  if (blockingCodes.size > 0 && input.allowLowerQualitySources && !overrideReason) {
    warnings.push({
      code: 'override-reason-required',
      severity: 'critical',
      message: 'A user override reason is required before weak sources can be admitted into the Knowledge Base.',
    })
  }

  let reviewStatus: KnowledgeBaseGovernanceReviewStatus = 'approved'
  if (requiresUserOverride) reviewStatus = 'override_required'
  else if (overrideUsed) reviewStatus = 'overridden'
  else if (warnings.length > 0) reviewStatus = 'approved_with_warnings'

  const qualityLabel: KnowledgeBaseGovernanceQualityLabel =
    qualityScore >= 85 ? 'trusted'
      : qualityScore >= 70 ? 'supported'
        : qualityScore >= 50 ? 'caution'
          : 'low-confidence'

  return {
    domain: input.domain,
    riskLevel: policy.riskLevel,
    qualityScore,
    qualityLabel,
    reviewStatus,
    sourceCount: input.sources.length,
    warnings,
    recommendedSourceTypes: policy.preferredSourceTypes,
    hasAuthoritativeSource,
    hasLowQualitySources,
    requiresUserOverride: requiresUserOverride || Boolean(input.allowLowerQualitySources && !overrideReason && blockingCodes.size > 0),
    overrideUsed,
    overrideReason,
    sources: input.sources,
    sourceAssessments,
    verificationResults: sourceAssessments
      .map((assessment) => assessment.verification)
      .filter((verification): verification is KnowledgeBaseSourceVerificationResult => Boolean(verification)),
    ingestionMethod,
  }
}

export function evaluateKnowledgeBaseGovernance(input: KnowledgeBaseGovernanceInput): KnowledgeBaseGovernanceReview {
  const policy = DOMAIN_POLICIES[input.domain]
  const nowMs = Date.now()
  const sourceAssessments = input.sources.map((source) =>
    scoreSourceAssessment({
      source,
      policy,
      nowMs,
      verification: null,
    }),
  )
  return buildGovernanceReview(input, sourceAssessments, 'manual')
}

export async function reviewKnowledgeBaseGovernance(
  input: KnowledgeBaseGovernanceInput,
  options: ReviewKnowledgeBaseGovernanceOptions = {},
): Promise<KnowledgeBaseGovernanceReview> {
  const policy = DOMAIN_POLICIES[input.domain]
  const nowMs = Date.now()
  const registry = options.registry || getKnowledgeBaseAuthoritativeHostRegistry()
  const verificationResults = await Promise.all(input.sources.map(async (source) => {
    if (!source.url || !isHighRiskDomain(input.domain)) return null
    return verifyKnowledgeBaseSourceUrl(source, input.domain, {
      fetchImpl: options.fetchImpl,
      lookupImpl: options.lookupImpl,
      registry,
    })
  }))
  const sourceAssessments = input.sources.map((source, index) =>
    scoreSourceAssessment({
      source,
      policy,
      nowMs,
      verification: verificationResults[index],
    }),
  )
  return buildGovernanceReview(input, sourceAssessments, options.ingestionMethod || 'manual')
}

export function summarizeKnowledgeBaseGovernance(
  record: Pick<KnowledgeBaseGovernanceReview, 'reviewStatus' | 'qualityLabel' | 'riskLevel' | 'overrideUsed' | 'warnings'> | null | undefined,
): KnowledgeBaseGovernanceSummary {
  if (!record) {
    const unreviewed = buildUnreviewedKnowledgeBaseGovernanceReview()
    return {
      reviewStatus: unreviewed.reviewStatus,
      qualityLabel: unreviewed.qualityLabel,
      riskLevel: unreviewed.riskLevel,
      overrideUsed: unreviewed.overrideUsed,
      warningCount: unreviewed.warnings.length,
      warnings: unreviewed.warnings,
    }
  }
  return {
    reviewStatus: record.reviewStatus,
    qualityLabel: record.qualityLabel,
    riskLevel: record.riskLevel,
    overrideUsed: record.overrideUsed,
    warningCount: record.warnings.length,
    warnings: record.warnings,
  }
}

export function getLatestKnowledgeBaseGovernanceRecord(
  runtimeProfileName: string,
  path: string,
): KnowledgeBaseGovernanceRecord | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT *
    FROM knowledge_base_source_reviews
    WHERE runtime_profile_name = ? AND path = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(runtimeProfileName, path) as GovernanceRow | undefined

  return mapGovernanceRow(row)
}

export function getEffectiveKnowledgeBaseGovernanceRecord(
  runtimeProfileName: string,
  path: string,
): KnowledgeBaseGovernanceRecord {
  return getLatestKnowledgeBaseGovernanceRecord(runtimeProfileName, path)
    || buildSyntheticKnowledgeBaseGovernanceRecord(runtimeProfileName, path)
}

export function listLatestKnowledgeBaseGovernanceRecords(
  runtimeProfileName: string,
  paths?: string[],
): KnowledgeBaseGovernanceRecord[] {
  const db = getDatabase()
  const pathFilter = Array.isArray(paths) && paths.length > 0
    ? `AND path IN (${paths.map(() => '?').join(', ')})`
    : ''
  const rows = db.prepare(`
    SELECT reviews.*
    FROM knowledge_base_source_reviews reviews
    INNER JOIN (
      SELECT runtime_profile_name, path, MAX(id) AS max_id
      FROM knowledge_base_source_reviews
      WHERE runtime_profile_name = ?
      ${pathFilter}
      GROUP BY runtime_profile_name, path
    ) latest ON latest.max_id = reviews.id
    ORDER BY reviews.path ASC
  `).all(runtimeProfileName, ...(paths || [])) as GovernanceRow[]
  return rows.map((row) => mapGovernanceRow(row)).filter((row): row is KnowledgeBaseGovernanceRecord => Boolean(row))
}

export function buildKnowledgeBaseContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function recordKnowledgeBaseGovernanceDecision(args: {
  runtimeProfileName: string
  path: string
  actor: string
  contentHash: string | null
  review: KnowledgeBaseGovernanceReview
}) {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO knowledge_base_source_reviews (
      runtime_profile_name,
      path,
      content_hash,
      domain,
      risk_level,
      quality_score,
      quality_label,
      review_status,
      override_used,
      override_reason,
      source_count,
      warnings_json,
      sources_json,
      source_assessments_json,
      verification_json,
      ingestion_method,
      actor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    args.runtimeProfileName,
    args.path,
    args.contentHash,
    args.review.domain,
    args.review.riskLevel,
    args.review.qualityScore,
    args.review.qualityLabel,
    args.review.reviewStatus,
    args.review.overrideUsed ? 1 : 0,
    args.review.overrideReason,
    args.review.sourceCount,
    JSON.stringify(args.review.warnings),
    JSON.stringify(args.review.sources),
    JSON.stringify(args.review.sourceAssessments),
    JSON.stringify(args.review.verificationResults),
    args.review.ingestionMethod,
    args.actor,
  )

  logAuditEvent({
    action: args.review.overrideUsed ? 'knowledge_base_low_quality_override' : 'knowledge_base_source_review_recorded',
    actor: args.actor,
    target_type: 'knowledge_base',
    detail: {
      runtimeProfileName: args.runtimeProfileName,
      path: args.path,
      domain: args.review.domain,
      riskLevel: args.review.riskLevel,
      qualityScore: args.review.qualityScore,
      qualityLabel: args.review.qualityLabel,
      reviewStatus: args.review.reviewStatus,
      overrideUsed: args.review.overrideUsed,
      overrideReason: args.review.overrideReason,
      warnings: args.review.warnings,
      sourceCount: args.review.sourceCount,
      verificationResults: args.review.verificationResults,
      ingestionMethod: args.review.ingestionMethod,
    },
  })
}

export async function backfillKnowledgeBaseGovernanceRecords(args: {
  context: KnowledgeBaseContext
  actor: string
}): Promise<{ created: number; totalPages: number }> {
  if (!args.context.wikiExists) return { created: 0, totalPages: 0 }

  const files = await scanMemoryFiles(args.context.wikiRoot, {
    extensions: ['.md', '.txt', '.json'],
    maxFiles: 5000,
  })
  const allowedFiles = files.filter((file) => file.path.split(/[\\/]/, 1)[0] && file.path)
  const existing = new Set(listLatestKnowledgeBaseGovernanceRecords(
    args.context.runtimeProfile.name,
    allowedFiles.map((file) => file.path.replace(/\\/g, '/')),
  ).map((record) => record.path))

  let created = 0
  for (const file of allowedFiles) {
    const normalizedPath = file.path.replace(/\\/g, '/')
    if (existing.has(normalizedPath)) continue
    const absolutePath = join(args.context.wikiRoot, normalizedPath)
    let contentHash: string | null = null
    try {
      const content = await readFile(absolutePath, 'utf8')
      contentHash = buildKnowledgeBaseContentHash(content)
    } catch {
      contentHash = null
    }
    recordKnowledgeBaseGovernanceDecision({
      runtimeProfileName: args.context.runtimeProfile.name,
      path: normalizedPath,
      actor: args.actor,
      contentHash,
      review: buildUnreviewedKnowledgeBaseGovernanceReview(normalizedPath),
    })
    created += 1
  }

  return {
    created,
    totalPages: allowedFiles.length,
  }
}

function governanceQueueSortWeight(record: KnowledgeBaseGovernanceRecord) {
  let weight = 0
  if (record.reviewStatus === 'unreviewed') weight += 500
  else if (record.reviewStatus === 'overridden') weight += 350
  else if (record.reviewStatus === 'override_required') weight += 300
  else if (record.reviewStatus === 'approved_with_warnings') weight += 150

  if (record.riskLevel === 'critical') weight += 120
  else if (record.riskLevel === 'high') weight += 80

  weight += record.warnings.length * 10
  if (record.overrideUsed) weight += 50
  return weight
}

export async function listKnowledgeBaseGovernanceQueue(
  context: KnowledgeBaseContext,
  filters: KnowledgeBaseGovernanceQueueFilters = {},
): Promise<KnowledgeBaseGovernanceQueueResult> {
  if (!context.wikiExists) {
    return {
      items: [],
      totalPages: 0,
      stats: { unreviewed: 0, overridden: 0, highRisk: 0, warnings: 0, backfillEligible: 0 },
    }
  }

  const files = await scanMemoryFiles(context.wikiRoot, {
    extensions: ['.md', '.txt', '.json'],
    maxFiles: 5000,
  })
  const normalizedPaths = files.map((file) => file.path.replace(/\\/g, '/'))
  const latestMap = new Map(
    listLatestKnowledgeBaseGovernanceRecords(context.runtimeProfile.name, normalizedPaths)
      .map((record) => [record.path, record] as const),
  )

  const allItems = normalizedPaths.map((path) => {
    const record = latestMap.get(path) || buildSyntheticKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, path)
    return {
      path,
      pageType: path.split('/', 1)[0] || 'root',
      record,
      current: record.id !== 0,
    }
  })

  const filtered = allItems.filter((item) => {
    if (filters.unreviewedOnly && item.record.reviewStatus !== 'unreviewed') return false
    if (filters.reviewStatus && filters.reviewStatus !== 'all' && item.record.reviewStatus !== filters.reviewStatus) return false
    if (filters.riskLevel && filters.riskLevel !== 'all' && item.record.riskLevel !== filters.riskLevel) return false
    if (filters.domain && filters.domain !== 'all' && item.record.domain !== filters.domain) return false
    if (typeof filters.overrideUsed === 'boolean' && item.record.overrideUsed !== filters.overrideUsed) return false
    return true
  })

  filtered.sort((a, b) => {
    const weightDiff = governanceQueueSortWeight(b.record) - governanceQueueSortWeight(a.record)
    if (weightDiff !== 0) return weightDiff
    const createdAtDiff = (b.record.createdAt || 0) - (a.record.createdAt || 0)
    if (createdAtDiff !== 0) return createdAtDiff
    return a.path.localeCompare(b.path)
  })

  const limited = filtered.slice(0, Math.max(1, Math.min(filters.limit ?? 200, 500)))
  return {
    items: limited,
    totalPages: allItems.length,
    stats: {
      unreviewed: allItems.filter((item) => item.record.reviewStatus === 'unreviewed').length,
      overridden: allItems.filter((item) => item.record.overrideUsed).length,
      highRisk: allItems.filter((item) => item.record.riskLevel !== 'low').length,
      warnings: allItems.filter((item) => item.record.warnings.length > 0).length,
      backfillEligible: allItems.filter((item) => item.record.id === 0).length,
    },
  }
}
