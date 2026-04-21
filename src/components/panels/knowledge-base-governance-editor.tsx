'use client'

import type {
  KnowledgeBaseGovernanceDomain,
  KnowledgeBaseGovernanceRecord,
  KnowledgeBaseGovernanceReview,
  KnowledgeBaseSourceInput,
  KnowledgeBaseSourceType,
} from '@/lib/knowledge-base-governance'

type GovernanceFormState = {
  domain: KnowledgeBaseGovernanceDomain
  sources: KnowledgeBaseSourceInput[]
  allowLowerQualitySources?: boolean
  overrideReason?: string | null
}

const DOMAIN_OPTIONS: KnowledgeBaseGovernanceDomain[] = [
  'general',
  'programming',
  'medicine',
  'security',
  'legal',
  'finance',
]

const SOURCE_TYPE_OPTIONS: Array<{ value: KnowledgeBaseSourceType; label: string }> = [
  { value: 'official_docs', label: 'Official docs' },
  { value: 'official_guidance', label: 'Official guidance' },
  { value: 'peer_reviewed', label: 'Peer reviewed' },
  { value: 'standards', label: 'Standards / RFCs' },
  { value: 'vendor', label: 'Vendor advisory' },
  { value: 'expert_secondary', label: 'Expert secondary' },
  { value: 'community', label: 'Community' },
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'user_authored', label: 'User authored' },
  { value: 'generated_summary', label: 'Generated summary' },
]

function severityClass(severity: 'info' | 'warning' | 'critical') {
  if (severity === 'critical') return 'text-red-300 border-red-500/20 bg-red-500/5'
  if (severity === 'warning') return 'text-amber-300 border-amber-500/20 bg-amber-500/5'
  return 'text-sky-300 border-sky-500/20 bg-sky-500/5'
}

function qualityClass(label: KnowledgeBaseGovernanceReview['qualityLabel']) {
  if (label === 'trusted') return 'text-green-300 border-green-500/20 bg-green-500/10'
  if (label === 'supported') return 'text-sky-300 border-sky-500/20 bg-sky-500/10'
  if (label === 'caution') return 'text-amber-300 border-amber-500/20 bg-amber-500/10'
  return 'text-red-300 border-red-500/20 bg-red-500/10'
}

function riskClass(level: KnowledgeBaseGovernanceReview['riskLevel']) {
  if (level === 'critical') return 'text-red-300'
  if (level === 'high') return 'text-amber-300'
  return 'text-muted-foreground'
}

function reviewStatusClass(status: KnowledgeBaseGovernanceReview['reviewStatus']) {
  if (status === 'approved') return 'text-green-300 border-green-500/20 bg-green-500/10'
  if (status === 'approved_with_warnings') return 'text-amber-300 border-amber-500/20 bg-amber-500/10'
  if (status === 'overridden') return 'text-amber-200 border-amber-500/30 bg-amber-500/10'
  if (status === 'override_required') return 'text-red-300 border-red-500/20 bg-red-500/10'
  return 'text-sky-300 border-sky-500/20 bg-sky-500/10'
}

function formatTimestamp(value?: number | null) {
  if (!value) return null
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export function createEmptyGovernanceSource(): KnowledgeBaseSourceInput {
  return {
    title: '',
    url: '',
    sourceType: 'official_docs',
    publisher: '',
    author: '',
    publishedAt: '',
  }
}

export function createDefaultGovernanceForm(): GovernanceFormState {
  return {
    domain: 'general',
    sources: [createEmptyGovernanceSource()],
    allowLowerQualitySources: false,
    overrideReason: '',
  }
}

export function governanceFormFromRecord(record?: KnowledgeBaseGovernanceRecord | KnowledgeBaseGovernanceReview | null): GovernanceFormState {
  if (!record) return createDefaultGovernanceForm()
  return {
    domain: record.domain,
    sources: record.sources.length > 0 ? record.sources : [createEmptyGovernanceSource()],
    allowLowerQualitySources: record.overrideUsed,
    overrideReason: record.overrideReason || '',
  }
}

export function KnowledgeBaseGovernanceEditor({
  value,
  review,
  editable,
  error,
  onChange,
}: {
  value: GovernanceFormState
  review: KnowledgeBaseGovernanceReview | KnowledgeBaseGovernanceRecord | null
  editable: boolean
  error?: string | null
  onChange: (next: GovernanceFormState) => void
}) {
  const sources = value.sources.length > 0 ? value.sources : [createEmptyGovernanceSource()]
  const overrideVisible = editable && Boolean(review?.warnings.length || value.allowLowerQualitySources)
  const showReadonlyEmpty = !editable && !review

  const updateSource = (index: number, patch: Partial<KnowledgeBaseSourceInput>) => {
    const nextSources = sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...patch } : source)
    onChange({ ...value, sources: nextSources })
  }

  const removeSource = (index: number) => {
    const nextSources = sources.filter((_, sourceIndex) => sourceIndex !== index)
    onChange({ ...value, sources: nextSources.length > 0 ? nextSources : [createEmptyGovernanceSource()] })
  }

  return (
    <div className="border-b border-border/50 bg-[hsl(var(--surface-0))] px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 font-mono">Source Governance</div>
          <div className="text-xs text-muted-foreground mt-1">
            High-risk domains should be grounded in authoritative, current sources. Low-confidence material requires explicit override and stays labeled.
          </div>
        </div>
        {review && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className={`px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-[0.12em] ${reviewStatusClass(review.reviewStatus)}`}>
              {review.reviewStatus.replace(/_/g, ' ')}
            </span>
            <span className={`px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-[0.12em] ${qualityClass(review.qualityLabel)}`}>
              {review.qualityLabel} · {review.qualityScore}/100
            </span>
            <span className={`text-[10px] font-mono uppercase tracking-[0.12em] ${riskClass(review.riskLevel)}`}>
              {review.domain} · {review.riskLevel} risk
            </span>
          </div>
        )}
      </div>

      {review && 'actor' in review && (
        <div className="text-[11px] font-mono text-muted-foreground/60">
          Last review by {review.actor} {formatTimestamp(review.createdAt) ? `· ${formatTimestamp(review.createdAt)}` : ''}
          {review.overrideUsed && review.overrideReason ? ` · override: ${review.overrideReason}` : ''}
        </div>
      )}

      {review?.reviewStatus === 'unreviewed' && (
        <div className="border border-sky-500/20 rounded-lg bg-sky-500/5 px-3 py-3 text-xs text-sky-200">
          This page is still unreviewed under the current governance policy. Review the domain and sources before relying on it in high-risk work.
        </div>
      )}

      {showReadonlyEmpty ? (
        <div className="border border-border/50 rounded-lg bg-[hsl(var(--surface-1))] px-3 py-3 text-xs text-muted-foreground">
          No source-governance review has been recorded for this page yet. Enter edit mode to classify the domain and attach provenance.
        </div>
      ) : (
      <div className="grid gap-3 md:grid-cols-[220px,1fr]">
        <div>
          <label className="block text-[11px] font-mono text-muted-foreground mb-1">Domain</label>
          <select
            value={value.domain}
            disabled={!editable}
            onChange={(event) => onChange({ ...value, domain: event.target.value as KnowledgeBaseGovernanceDomain })}
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground disabled:opacity-70"
          >
            {DOMAIN_OPTIONS.map((domain) => (
              <option key={domain} value={domain}>{domain}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-mono text-muted-foreground">Sources</div>
            {editable && (
              <button
                type="button"
                onClick={() => onChange({ ...value, sources: [...sources, createEmptyGovernanceSource()] })}
                className="px-2 py-0.5 text-[11px] font-mono text-primary/80 hover:text-primary rounded hover:bg-primary/10"
              >
                add source
              </button>
            )}
          </div>

          <div className="space-y-2">
            {sources.map((source, index) => (
              <div key={`${index}-${source.title}-${source.url}`} className="border border-border/50 rounded-lg p-3 bg-[hsl(var(--surface-1))] space-y-2">
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    value={source.title}
                    disabled={!editable}
                    onChange={(event) => updateSource(index, { title: event.target.value })}
                    placeholder="Source title"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground disabled:opacity-70"
                  />
                  <select
                    value={source.sourceType}
                    disabled={!editable}
                    onChange={(event) => updateSource(index, { sourceType: event.target.value as KnowledgeBaseSourceType })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground disabled:opacity-70"
                  >
                    {SOURCE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    value={source.url || ''}
                    disabled={!editable}
                    onChange={(event) => updateSource(index, { url: event.target.value })}
                    placeholder="https://source.example"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground disabled:opacity-70"
                  />
                  <input
                    value={source.publisher || ''}
                    disabled={!editable}
                    onChange={(event) => updateSource(index, { publisher: event.target.value })}
                    placeholder="Publisher / institution"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground disabled:opacity-70"
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    value={source.author || ''}
                    disabled={!editable}
                    onChange={(event) => updateSource(index, { author: event.target.value })}
                    placeholder="Author"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground disabled:opacity-70"
                  />
                  <input
                    type="date"
                    value={source.publishedAt || ''}
                    disabled={!editable}
                    onChange={(event) => updateSource(index, { publishedAt: event.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground disabled:opacity-70"
                  />
                </div>
                {editable && sources.length > 1 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeSource(index)}
                      className="px-2 py-0.5 text-[11px] font-mono text-red-400/80 hover:text-red-400 rounded hover:bg-red-500/10"
                    >
                      remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {review && review.warnings.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-muted-foreground">Warnings</div>
          {review.warnings.map((warning) => (
            <div key={`${warning.code}-${warning.message}`} className={`border rounded-md px-3 py-2 text-xs ${severityClass(warning.severity)}`}>
              <div className="font-mono uppercase tracking-[0.12em] mb-1">{warning.severity}</div>
              <div>{warning.message}</div>
            </div>
          ))}
          <div className="text-[11px] font-mono text-muted-foreground/70">
            Preferred sources for this domain: {review.recommendedSourceTypes.join(', ')}
          </div>
        </div>
      )}

      {review && review.verificationResults.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-muted-foreground">Live verification</div>
          <div className="space-y-2">
            {review.verificationResults.map((verification) => (
              <div key={`${verification.sourceUrl}-${verification.checkedAt}`} className="border border-border/50 rounded-lg bg-[hsl(var(--surface-1))] px-3 py-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-foreground truncate">{verification.sourceUrl || 'URL-backed source'}</div>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-[0.12em] ${reviewStatusClass(verification.verificationState === 'verified' ? 'approved' : verification.verificationState === 'blocked' ? 'override_required' : 'approved_with_warnings')}`}>
                    {verification.verificationState}
                  </span>
                </div>
                <div className="text-muted-foreground/70 font-mono">
                  host: {verification.finalHost || verification.normalizedHost || 'n/a'}
                  {verification.httpStatus ? ` · http ${verification.httpStatus}` : ''}
                  {verification.https ? ' · https' : ' · non-https'}
                  {verification.authoritativeHostMatch ? ' · authoritative host' : ''}
                </div>
                {(verification.lastModified || verification.publishedAt) && (
                  <div className="text-muted-foreground/70 font-mono">
                    {verification.lastModified ? `last-modified: ${verification.lastModified}` : ''}
                    {verification.lastModified && verification.publishedAt ? ' · ' : ''}
                    {verification.publishedAt ? `published: ${verification.publishedAt}` : ''}
                  </div>
                )}
                {verification.redirectTarget && (
                  <div className="text-muted-foreground/70 font-mono truncate">redirect: {verification.redirectTarget}</div>
                )}
                {verification.failureMessage && (
                  <div className={verification.verificationState === 'blocked' ? 'text-red-300' : 'text-amber-300'}>
                    {verification.failureMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editable && overrideVisible && (
        <div className="border rounded-lg border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={Boolean(value.allowLowerQualitySources)}
              onChange={(event) => onChange({ ...value, allowLowerQualitySources: event.target.checked })}
              className="mt-0.5"
            />
            <span>
              Allow lower-quality inputs only if the user explicitly insists. This keeps the page labeled as weaker evidence and records the override.
            </span>
          </label>
          <textarea
            value={value.overrideReason || ''}
            onChange={(event) => onChange({ ...value, overrideReason: event.target.value })}
            placeholder="Why is this override necessary?"
            className="w-full min-h-20 px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground resize-none"
          />
        </div>
      )}

      {error && (
        <div className="border border-red-500/20 bg-red-500/5 rounded-md px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
