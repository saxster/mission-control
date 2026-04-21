import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  getKnowledgeBaseContext,
  resolveKnowledgeBaseContentPath,
  type KnowledgeBaseContext,
} from '@/lib/knowledge-base'
import {
  getEffectiveKnowledgeBaseGovernanceRecord,
  summarizeKnowledgeBaseGovernance,
  type KnowledgeBaseGovernanceDomain,
  type KnowledgeBaseGovernanceInput,
  type KnowledgeBaseSourceInput,
} from '@/lib/knowledge-base-governance'
import { performGovernedKnowledgeBaseWrite } from '@/lib/knowledge-base-content-write'
import { importObsidianCandidate, listObsidianImportCandidates } from '@/lib/obsidian'

export type KnowledgeSourceKind =
  | 'file'
  | 'obsidian_note'
  | 'url'
  | 'teach_card'
  | 'web_capture'
  | 'import_candidate'

export type KnowledgeSourceStatus =
  | 'new'
  | 'imported'
  | 'indexed'
  | 'needs_review'
  | 'conflict'
  | 'failed'

export type KnowledgeSourcePromoteTarget =
  | 'entity'
  | 'concept'
  | 'article'
  | 'comparison'
  | 'query'
  | 'structured_note'

export interface KnowledgeSourceRecord {
  id: string
  kind: KnowledgeSourceKind
  status: KnowledgeSourceStatus
  title: string
  originalLocation: string | null
  managedPath: string | null
  summary: string | null
  excerpt: string | null
  syncStatus: string | null
  conflictState: string | null
  governanceSummary: ReturnType<typeof summarizeKnowledgeBaseGovernance> | null
  domain: KnowledgeBaseGovernanceDomain | null
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

interface KnowledgeSourceRegistry {
  sources: KnowledgeSourceRecord[]
}

interface TeachCardRow {
  id: string
  topic: string
  domain: string | null
  card_json: string
  created_at: number
}

interface TeachCardPayload {
  type: string
  topic: string
  domain?: string | null
  summary?: string | null
  plain_language_definition?: string | null
  analogy?: string | null
  why_it_matters?: string | null
  definition?: string | null
  key_points?: string[] | null
  formula?: string | null
  etymology?: string | null
  translation?: string | null
  code_example?: string | null
  example?: string | null
  context?: string | null
  related_concepts?: string[] | null
  prior_knowledge?: string[] | null
  common_misconceptions?: string[] | null
  flashcard?: { front: string; back: string } | null
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function registryPath(context: KnowledgeBaseContext): string {
  return join(context.hermesHome, 'knowledge-source-registry.json')
}

function loadRegistry(context: KnowledgeBaseContext): KnowledgeSourceRegistry {
  const path = registryPath(context)
  if (!existsSync(path)) return { sources: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as KnowledgeSourceRegistry
    return { sources: Array.isArray(parsed.sources) ? parsed.sources : [] }
  } catch {
    return { sources: [] }
  }
}

function saveRegistry(context: KnowledgeBaseContext, registry: KnowledgeSourceRegistry): void {
  mkdirSync(context.hermesHome, { recursive: true })
  writeFileSync(registryPath(context), JSON.stringify(registry, null, 2), 'utf8')
}

function excerptFromPath(path: string): { summary: string | null; excerpt: string | null } {
  const lower = path.toLowerCase()
  const textLike = ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.ts', '.tsx', '.js', '.jsx', '.swift', '.py']
  if (!textLike.some((ext) => lower.endsWith(ext))) {
    return { summary: `Imported file at ${path}.`, excerpt: null }
  }
  try {
    const raw = readFileSync(path, 'utf8').trim()
    if (!raw) return { summary: `Imported file at ${path}.`, excerpt: null }
    return {
      summary: raw.split(/\r?\n/).find((line) => line.trim())?.slice(0, 180) ?? `Imported file at ${path}.`,
      excerpt: raw.slice(0, 1200),
    }
  } catch {
    return { summary: `Imported file at ${path}.`, excerpt: null }
  }
}

function resolveGovernanceSummary(context: KnowledgeBaseContext, managedPath: string | null) {
  if (!managedPath) return null
  return summarizeKnowledgeBaseGovernance(
    getEffectiveKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, managedPath),
  )
}

function listTeachCardRows(context: KnowledgeBaseContext): TeachCardRow[] {
  if (!existsSync(context.stateDbPath)) return []
  const db = new Database(context.stateDbPath, { readonly: true })
  try {
    return db.prepare(`
        SELECT id, topic, domain, card_json, created_at
        FROM teach_cards
        ORDER BY created_at DESC
        LIMIT 100
      `).all() as TeachCardRow[]
  } catch {
    return []
  } finally {
    db.close()
  }
}

function parseTeachCard(row: TeachCardRow): TeachCardPayload | null {
  try {
    const parsed = JSON.parse(row.card_json) as TeachCardPayload
    return parsed?.type === 'teach_card' ? parsed : null
  } catch {
    return null
  }
}

function buildTeachSourceRecord(row: TeachCardRow): KnowledgeSourceRecord | null {
  const card = parseTeachCard(row)
  if (!card) return null
  return {
    id: `teach-card:${row.id}`,
    kind: 'teach_card',
    status: 'new',
    title: card.topic || row.topic,
    originalLocation: 'teach_cards',
    managedPath: null,
    summary: card.summary ?? card.plain_language_definition ?? null,
    excerpt: card.definition ?? card.example ?? null,
    syncStatus: null,
    conflictState: null,
    governanceSummary: null,
    domain: (card.domain as KnowledgeBaseGovernanceDomain | undefined) ?? (row.domain as KnowledgeBaseGovernanceDomain | null),
    createdAt: row.created_at,
    updatedAt: row.created_at,
    metadata: {
      card,
      cardId: row.id,
    },
  }
}

function buildImportCandidateSource(candidate: ReturnType<typeof listObsidianImportCandidates>[number]): KnowledgeSourceRecord {
  return {
    id: `import-candidate:${candidate.vaultRelativePath}`,
    kind: 'import_candidate',
    status: candidate.imported ? 'imported' : 'new',
    title: candidate.title,
    originalLocation: candidate.vaultRelativePath,
    managedPath: candidate.importedManagedPath ?? null,
    summary: candidate.imported ? `Imported from ${candidate.vaultRelativePath}.` : `Available to import from ${candidate.vaultRelativePath}.`,
    excerpt: null,
    syncStatus: candidate.imported ? 'synced' : null,
    conflictState: null,
    governanceSummary: null,
    domain: null,
    createdAt: candidate.updatedAt,
    updatedAt: candidate.updatedAt,
  }
}

function mergeSyntheticSources(
  registrySources: KnowledgeSourceRecord[],
  syntheticSources: KnowledgeSourceRecord[],
): KnowledgeSourceRecord[] {
  const seen = new Set(registrySources.map((source) => source.id))
  return [
    ...registrySources,
    ...syntheticSources.filter((source) => !seen.has(source.id)),
  ].sort((a, b) => b.updatedAt - a.updatedAt)
}

function governanceInputForSource(
  source: KnowledgeSourceRecord,
  domain: KnowledgeBaseGovernanceDomain,
  overrideReason?: string | null,
): KnowledgeBaseGovernanceInput {
  const sourceInput: KnowledgeBaseSourceInput = source.kind === 'url' || source.kind === 'web_capture'
    ? {
        title: source.title,
        url: source.originalLocation,
        sourceType: 'community',
      }
    : source.kind === 'teach_card'
      ? {
          title: source.title,
          sourceType: 'generated_summary',
        }
      : {
          title: source.title,
          sourceType: 'user_authored',
        }

  return {
    domain,
    sources: [sourceInput],
    allowLowerQualitySources: Boolean(overrideReason),
    overrideReason: overrideReason ?? null,
  }
}

function sanitizeFileStem(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || 'untitled'
}

function pagePathForTarget(target: KnowledgeSourcePromoteTarget, title: string): string {
  const stem = sanitizeFileStem(title)
  switch (target) {
    case 'entity':
      return `entities/${stem}.md`
    case 'concept':
      return `concepts/${stem}.md`
    case 'article':
      return `articles/${stem}.md`
    case 'comparison':
      return `comparisons/${stem}.md`
    case 'query':
      return `queries/${stem}.md`
    case 'structured_note':
      return `Notes/${stem}.md`
  }
}

function renderTeachCardMarkdown(card: TeachCardPayload): string {
  const sections: string[] = [`# ${card.topic}`]
  if (card.summary) sections.push(`> ${card.summary}`)
  if (card.plain_language_definition) sections.push(`## Definition (plain)\n\n${card.plain_language_definition}`)
  if (card.why_it_matters) sections.push(`## Why it matters\n\n${card.why_it_matters}`)
  if (card.analogy) sections.push(`## Analogy\n\n${card.analogy}`)
  if (card.definition) sections.push(`## Technical definition\n\n${card.definition}`)
  if (card.key_points?.length) {
    sections.push(`## Key points\n\n${card.key_points.map((item) => `- ${item}`).join('\n')}`)
  }
  if (card.formula) sections.push(`## Formula\n\n\`\`\`\n${card.formula}\n\`\`\``)
  if (card.code_example) sections.push(`## Code example\n\n\`\`\`\n${card.code_example}\n\`\`\``)
  if (card.example) sections.push(`## Example\n\n${card.example}`)
  if (card.context) sections.push(`## Context\n\n${card.context}`)
  if (card.related_concepts?.length) {
    sections.push(`## Related concepts\n\n${card.related_concepts.map((item) => `- [[${item}]]`).join('\n')}`)
  }
  return sections.join('\n\n')
}

function renderImportedSourceMarkdown(source: KnowledgeSourceRecord): string {
  const sections = [
    `# ${source.title}`,
    source.summary ? `> ${source.summary}` : null,
    '## Provenance',
    `- Source kind: ${source.kind}`,
    source.originalLocation ? `- Original location: ${source.originalLocation}` : null,
    source.domain ? `- Domain: ${source.domain}` : null,
    '## Notes',
    source.excerpt || 'Add synthesized notes and verified takeaways here.',
  ].filter(Boolean)
  return sections.join('\n\n')
}

function resolveSourceByID(context: KnowledgeBaseContext, sourceID: string): KnowledgeSourceRecord | null {
  const registry = loadRegistry(context)
  const fromRegistry = registry.sources.find((source) => source.id === sourceID)
  if (fromRegistry) {
    return {
      ...fromRegistry,
      governanceSummary: resolveGovernanceSummary(context, fromRegistry.managedPath),
    }
  }

  if (sourceID.startsWith('teach-card:')) {
    const teachID = sourceID.slice('teach-card:'.length)
    const row = listTeachCardRows(context).find((candidate) => candidate.id === teachID)
    return row ? buildTeachSourceRecord(row) : null
  }

  if (sourceID.startsWith('import-candidate:')) {
    const vaultRelativePath = sourceID.slice('import-candidate:'.length)
    const candidate = listObsidianImportCandidates(context).find((entry) => entry.vaultRelativePath === vaultRelativePath)
    return candidate ? buildImportCandidateSource(candidate) : null
  }

  return null
}

export function listKnowledgeBaseSources(context: KnowledgeBaseContext): KnowledgeSourceRecord[] {
  const registry = loadRegistry(context)
  const registrySources = registry.sources.map((source) => ({
    ...source,
    governanceSummary: resolveGovernanceSummary(context, source.managedPath),
  }))
  const teachSources = listTeachCardRows(context)
    .map(buildTeachSourceRecord)
    .filter((source): source is KnowledgeSourceRecord => Boolean(source))
  const importCandidates = listObsidianImportCandidates(context).map(buildImportCandidateSource)
  return mergeSyntheticSources(registrySources, [...teachSources, ...importCandidates])
}

function persistSource(context: KnowledgeBaseContext, next: KnowledgeSourceRecord): KnowledgeSourceRecord {
  const registry = loadRegistry(context)
  const remaining = registry.sources.filter((source) => source.id !== next.id)
  const saved = {
    ...next,
    updatedAt: Date.now(),
  }
  saveRegistry(context, { sources: [saved, ...remaining].sort((a, b) => b.updatedAt - a.updatedAt) })
  return saved
}

export function importKnowledgeBaseSources(args: {
  runtimeProfileName?: string | null
  kind: KnowledgeSourceKind
  filePaths?: string[]
  url?: string | null
  path?: string | null
  title?: string | null
  domain?: KnowledgeBaseGovernanceDomain | null
  teachCard?: TeachCardPayload | null
}): KnowledgeSourceRecord[] {
  const context = getKnowledgeBaseContext(args.runtimeProfileName)
  const now = Date.now()

  if (args.kind === 'file') {
    const imported = (args.filePaths || [])
      .filter((path) => path && existsSync(path))
      .map((path) => {
        const extracted = excerptFromPath(path)
        return persistSource(context, {
          id: `kb-source:${randomUUID()}`,
          kind: 'file',
          status: 'imported',
          title: args.title || path.split('/').pop() || 'Imported File',
          originalLocation: path,
          managedPath: null,
          summary: extracted.summary,
          excerpt: extracted.excerpt,
          syncStatus: null,
          conflictState: null,
          governanceSummary: null,
          domain: args.domain ?? null,
          createdAt: now,
          updatedAt: now,
        })
      })
    return imported
  }

  if (args.kind === 'url' || args.kind === 'web_capture') {
    if (!args.url) throw new Error('url is required')
    return [
      persistSource(context, {
        id: `kb-source:${randomUUID()}`,
        kind: args.kind,
        status: 'imported',
        title: args.title || args.url,
        originalLocation: args.url,
        managedPath: null,
        summary: `Imported web source from ${args.url}.`,
        excerpt: null,
        syncStatus: null,
        conflictState: null,
        governanceSummary: null,
        domain: args.domain ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    ]
  }

  if (args.kind === 'teach_card') {
    if (!args.teachCard) throw new Error('teachCard is required')
    const card = args.teachCard
    return [
      persistSource(context, {
        id: `kb-source:${randomUUID()}`,
        kind: 'teach_card',
        status: 'imported',
        title: card.topic,
        originalLocation: 'teach_cards',
        managedPath: null,
        summary: card.summary ?? card.plain_language_definition ?? null,
        excerpt: card.definition ?? card.example ?? null,
        syncStatus: null,
        conflictState: null,
        governanceSummary: null,
        domain: (args.domain ?? card.domain ?? null) as KnowledgeBaseGovernanceDomain | null,
        createdAt: now,
        updatedAt: now,
        metadata: { card },
      }),
    ]
  }

  if (args.kind === 'import_candidate' || args.kind === 'obsidian_note') {
    if (!args.path) throw new Error('path is required')
    const result = importObsidianCandidate(context, args.path, 'Notes')
    return [
      persistSource(context, {
        id: `kb-source:${randomUUID()}`,
        kind: 'obsidian_note',
        status: 'imported',
        title: args.title || args.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Imported Obsidian Note',
        originalLocation: args.path,
        managedPath: result.importedManagedPath,
        summary: `Imported from external Obsidian note ${args.path}.`,
        excerpt: null,
        syncStatus: 'synced',
        conflictState: null,
        governanceSummary: resolveGovernanceSummary(context, result.importedManagedPath),
        domain: args.domain ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    ]
  }

  throw new Error(`Unsupported source kind: ${args.kind}`)
}

export async function promoteKnowledgeBaseSource(args: {
  runtimeProfileName?: string | null
  sourceID: string
  targetType: KnowledgeSourcePromoteTarget
  title?: string | null
  domain?: KnowledgeBaseGovernanceDomain | null
  overrideReason?: string | null
  actor: string
}): Promise<{ ok: true; path: string; source: KnowledgeSourceRecord; governance: unknown } | { ok: false; status: number; error: string; governance: unknown }> {
  const context = getKnowledgeBaseContext(args.runtimeProfileName)
  const source = resolveSourceByID(context, args.sourceID)
  if (!source) {
    return { ok: false, status: 404, error: 'Source not found', governance: null }
  }

  const title = args.title?.trim() || source.title
  const domain = args.domain ?? source.domain ?? 'general'
  const targetPath = pagePathForTarget(args.targetType, title)

  if (args.targetType === 'structured_note') {
    const content = source.kind === 'teach_card' && source.metadata?.card
      ? renderTeachCardMarkdown(source.metadata.card as TeachCardPayload)
      : renderImportedSourceMarkdown(source)
    const fullPath = await resolveKnowledgeBaseContentPath(context, targetPath, 'structured')
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf8')
    const updated = persistSource(context, {
      ...source,
      status: 'indexed',
      managedPath: targetPath,
      governanceSummary: summarizeKnowledgeBaseGovernance(null),
    })
    return { ok: true, path: targetPath, source: updated, governance: null }
  }

  const content = source.kind === 'teach_card' && source.metadata?.card
    ? renderTeachCardMarkdown(source.metadata.card as TeachCardPayload)
    : renderImportedSourceMarkdown(source)

  const writeResult = await performGovernedKnowledgeBaseWrite({
    runtimeProfileName: args.runtimeProfileName,
    action: 'create',
    path: targetPath,
    content,
    actor: args.actor,
    governance: governanceInputForSource(source, domain, args.overrideReason),
    ingestionMethod: 'manual',
  })

  if (writeResult.status < 200 || writeResult.status >= 300) {
    return {
      ok: false,
      status: writeResult.status,
      error: writeResult.body.error || 'Failed to promote source',
      governance: writeResult.body.governance,
    }
  }

  const updated = persistSource(context, {
    ...source,
    status: 'indexed',
    managedPath: targetPath,
    governanceSummary: resolveGovernanceSummary(context, targetPath),
  })

  return {
    ok: true,
    path: targetPath,
    source: updated,
    governance: writeResult.body.governance,
  }
}
