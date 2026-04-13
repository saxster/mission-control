import { existsSync, readFileSync } from 'node:fs'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, sep } from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { resolveWithin } from '@/lib/paths'
import { extractWikiLinks, scanMemoryFiles } from '@/lib/memory-utils'
import { getHermesMemory } from '@/lib/hermes-memory'
import { resolveHermesRuntimeProfileByName, type HermesRuntimeProfile } from '@/lib/hermes-runtime-profiles'
import {
  getEffectiveKnowledgeBaseGovernanceRecord,
  listLatestKnowledgeBaseGovernanceRecords,
  summarizeKnowledgeBaseGovernance,
  type KnowledgeBaseGovernanceSummary,
} from '@/lib/knowledge-base-governance'
import { logger } from '@/lib/logger'

export const KNOWLEDGE_BASE_WIKI_ROOTS = ['entities', 'concepts', 'comparisons', 'queries', 'articles', 'raw'] as const
export const KNOWLEDGE_BASE_WRITABLE_WIKI_ROOTS = ['entities', 'concepts', 'comparisons', 'queries', 'articles'] as const
export const KNOWLEDGE_BASE_STRUCTURED_TYPES = ['note', 'person', 'project', 'decision'] as const

export type KnowledgeBaseWikiRoot = typeof KNOWLEDGE_BASE_WIKI_ROOTS[number]
export type KnowledgeBaseStructuredType = typeof KNOWLEDGE_BASE_STRUCTURED_TYPES[number]
export type KnowledgeBaseScope = 'wiki' | 'structured'

export interface KnowledgeBaseFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: KnowledgeBaseFileNode[]
  pageType?: string
  readOnly?: boolean
}

export interface KnowledgeBaseStructuredEntry {
  type: KnowledgeBaseStructuredType
  id: number
  title: string
  summary: string
  tags: string[]
  createdAt: number | null
  updatedAt: number | null
  status?: string | null
  source?: string | null
  linkedPath?: string | null
  details?: string | null
  metadata?: Record<string, unknown>
}

interface HermesKnowledgeConfig {
  vaultPath?: string
  wikiPath?: string
  agentPrefix: string
}

interface StructuredFolderConfig {
  type: KnowledgeBaseStructuredType
  label: string
  folderName: string
  rootPath: string
}

export interface KnowledgeBaseContext {
  runtimeProfile: HermesRuntimeProfile
  hermesHome: string
  stateDbPath: string
  wikiRoot: string
  wikiExists: boolean
  wikiConfigured: boolean
  wikiRoots: string[]
  writableWikiRoots: string[]
  structuredVaultPath: string | null
  structuredFolders: StructuredFolderConfig[]
  agentPrefix: string
  legacyWikiRoot: string
  firstRunReason: string | null
}

const STRUCTURED_FOLDER_DEFINITIONS: Array<{
  type: KnowledgeBaseStructuredType
  label: string
  folderName: string
}> = [
  { type: 'person', label: 'People', folderName: 'People' },
  { type: 'project', label: 'Projects', folderName: 'Projects' },
  { type: 'decision', label: 'Decisions', folderName: 'Decisions' },
  { type: 'note', label: 'Notes', folderName: 'Notes' },
]

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function expandHomePath(value: string): string {
  if (!value) return value
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return join(os.homedir(), value.slice(2))
  return value
}

function parseEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {}
  const content = readFileSync(envPath, 'utf8')
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function parseYamlScalar(value: string): string | boolean {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

function parseHermesKnowledgeConfig(content: string): HermesKnowledgeConfig {
  const result: HermesKnowledgeConfig = { agentPrefix: 'Hermes' }
  let inKnowledge = false
  let knowledgeIndent = 0

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = rawLine.match(/^ */)?.[0].length ?? 0

    if (!inKnowledge) {
      if (trimmed === 'knowledge:' || trimmed.startsWith('knowledge: #')) {
        inKnowledge = true
        knowledgeIndent = indent
      }
      continue
    }

    if (indent <= knowledgeIndent) {
      inKnowledge = false
      if (trimmed === 'knowledge:' || trimmed.startsWith('knowledge: #')) {
        inKnowledge = true
        knowledgeIndent = indent
      }
      continue
    }

    const match = rawLine.match(/^\s+([A-Za-z0-9_]+):\s*(.*?)\s*(?:#.*)?$/)
    if (!match) continue
    const key = match[1]
    const parsed = parseYamlScalar(match[2])
    if (typeof parsed !== 'string' && key !== 'sync_episodes') continue
    if (key === 'vault_path' && typeof parsed === 'string') result.vaultPath = parsed
    if (key === 'wiki_path' && typeof parsed === 'string') result.wikiPath = parsed
    if (key === 'agent_prefix' && typeof parsed === 'string' && parsed.trim()) result.agentPrefix = parsed.trim()
  }

  return result
}

function loadKnowledgeConfig(hermesHome: string): HermesKnowledgeConfig {
  for (const fileName of ['config.yaml', 'cli-config.yaml']) {
    const filePath = join(hermesHome, fileName)
    if (!existsSync(filePath)) continue
    try {
      return parseHermesKnowledgeConfig(readFileSync(filePath, 'utf8'))
    } catch (err) {
      logger.warn({ err, filePath }, 'Failed to parse Hermes knowledge config')
    }
  }
  return { agentPrefix: 'Hermes' }
}

function resolveKnowledgeBasePaths(runtimeProfileName?: string | null): KnowledgeBaseContext {
  const runtimeProfile = resolveHermesRuntimeProfileByName(runtimeProfileName)
  const hermesHome = runtimeProfile.hermesHome
  const env = parseEnvFile(join(hermesHome, '.env'))
  const config = loadKnowledgeConfig(hermesHome)
  const legacyWikiRoot = join(os.homedir(), 'hermes-kb')
  const wikiPathFromEnv = env.LLM_WIKI_PATH || process.env.LLM_WIKI_PATH || ''
  const vaultPathFromEnv = env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || ''
  const vaultPath = expandHomePath(vaultPathFromEnv || config.vaultPath || '')
  const agentPrefix = config.agentPrefix || 'Hermes'
  const explicitWikiPath = expandHomePath(wikiPathFromEnv || config.wikiPath || '')

  let wikiRoot = explicitWikiPath
  if (!wikiRoot) {
    if (existsSync(legacyWikiRoot)) {
      wikiRoot = legacyWikiRoot
    } else if (vaultPath) {
      wikiRoot = join(vaultPath, agentPrefix, 'Wiki')
    } else {
      wikiRoot = legacyWikiRoot
    }
  }

  const structuredVaultPath = vaultPath ? join(vaultPath, agentPrefix) : null
  const structuredFolders = structuredVaultPath
    ? STRUCTURED_FOLDER_DEFINITIONS.map((folder) => ({
        ...folder,
        rootPath: join(structuredVaultPath, folder.folderName),
      }))
    : []

  const wikiExists = existsSync(wikiRoot)
  const wikiConfigured = Boolean(explicitWikiPath || existsSync(legacyWikiRoot) || vaultPath)
  const firstRunReason = wikiExists
    ? null
    : 'No Hermes wiki was found for this runtime profile. Initialize it through Hermes (/wiki init) or configure knowledge.wiki_path / Obsidian vault settings.'

  return {
    runtimeProfile,
    hermesHome,
    stateDbPath: join(hermesHome, 'state.db'),
    wikiRoot,
    wikiExists,
    wikiConfigured,
    wikiRoots: [...KNOWLEDGE_BASE_WIKI_ROOTS],
    writableWikiRoots: [...KNOWLEDGE_BASE_WRITABLE_WIKI_ROOTS],
    structuredVaultPath,
    structuredFolders,
    agentPrefix,
    legacyWikiRoot,
    firstRunReason,
  }
}

function isWithinBase(base: string, candidate: string): boolean {
  if (candidate === base) return true
  return candidate.startsWith(base + sep)
}

async function resolveSafePath(baseDir: string, relativePath: string): Promise<string> {
  const baseReal = await realpath(baseDir)
  const fullPath = resolveWithin(baseDir, relativePath)

  let current = dirname(fullPath)
  let parentReal = ''
  while (!parentReal) {
    try {
      parentReal = await realpath(current)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
      const next = dirname(current)
      if (next === current) throw new Error('Parent directory not found')
      current = next
    }
  }

  if (!isWithinBase(baseReal, parentReal)) {
    throw new Error('Path escapes base directory (symlink)')
  }

  try {
    const st = await lstat(fullPath)
    if (st.isSymbolicLink()) throw new Error('Symbolic links are not allowed')
    const fullReal = await realpath(fullPath)
    if (!isWithinBase(baseReal, fullReal)) {
      throw new Error('Path escapes base directory (symlink)')
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }

  return fullPath
}

export function getKnowledgeBaseContext(runtimeProfileName?: string | null): KnowledgeBaseContext {
  return resolveKnowledgeBasePaths(runtimeProfileName)
}

export function isKnowledgeBaseWikiPathAllowed(context: KnowledgeBaseContext, relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) return false
  return context.wikiRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

export function isKnowledgeBaseWikiPathWritable(context: KnowledgeBaseContext, relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) return false
  return context.writableWikiRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

export function isKnowledgeBaseStructuredPathAllowed(context: KnowledgeBaseContext, relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized || !context.structuredVaultPath) return false
  const roots = context.structuredFolders.map((folder) => normalizeRelativePath(join(context.agentPrefix, folder.folderName)))
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

export async function resolveKnowledgeBaseContentPath(
  context: KnowledgeBaseContext,
  relativePath: string,
  scope: KnowledgeBaseScope = 'wiki',
): Promise<string> {
  if (scope === 'structured') {
    if (!context.structuredVaultPath || !isKnowledgeBaseStructuredPathAllowed(context, relativePath)) {
      throw new Error('Path not allowed')
    }
    return resolveSafePath(dirname(context.structuredVaultPath), relativePath)
  }

  if (!context.wikiExists) throw new Error('Knowledge Base wiki not initialized')
  if (!isKnowledgeBaseWikiPathAllowed(context, relativePath)) throw new Error('Path not allowed')
  return resolveSafePath(context.wikiRoot, relativePath)
}

export function getKnowledgeBasePageType(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  return normalized.split('/')[0] || 'root'
}

async function buildTreeFrom(
  baseDir: string,
  dirPath: string,
  relativeBase: string,
  maxDepth: number,
  readOnlyRoots = new Set<string>(),
): Promise<KnowledgeBaseFileNode[]> {
  const items = await readdir(dirPath, { withFileTypes: true })
  const nodes: KnowledgeBaseFileNode[] = []

  for (const item of items) {
    if (item.isSymbolicLink()) continue
    const itemPath = join(dirPath, item.name)
    const relativePath = normalizeRelativePath(join(relativeBase, item.name))
    try {
      const info = await stat(itemPath)
      const pageType = getKnowledgeBasePageType(relativePath)
      if (item.isDirectory()) {
        const children = maxDepth > 0
          ? await buildTreeFrom(baseDir, itemPath, relativePath, maxDepth - 1, readOnlyRoots)
          : undefined
        nodes.push({
          path: relativePath,
          name: item.name,
          type: 'directory',
          modified: info.mtime.getTime(),
          children,
          pageType,
          readOnly: readOnlyRoots.has(pageType),
        })
      } else if (item.isFile()) {
        nodes.push({
          path: relativePath,
          name: item.name,
          type: 'file',
          size: info.size,
          modified: info.mtime.getTime(),
          pageType,
          readOnly: readOnlyRoots.has(pageType),
        })
      }
    } catch {
      // Skip unreadable files
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function getKnowledgeBaseTree(
  context: KnowledgeBaseContext,
  options?: { path?: string; depth?: number },
): Promise<KnowledgeBaseFileNode[]> {
  if (!context.wikiExists) return []

  const maxDepth = Number.isFinite(options?.depth) ? Math.max(0, Math.min(options?.depth ?? 0, 8)) : Number.POSITIVE_INFINITY
  const readOnlyRoots = new Set<string>(['raw'])

  if (options?.path) {
    const safePath = await resolveKnowledgeBaseContentPath(context, options.path, 'wiki')
    const info = await stat(safePath)
    if (!info.isDirectory()) throw new Error('Directory not found')
    return buildTreeFrom(context.wikiRoot, safePath, normalizeRelativePath(options.path), maxDepth, readOnlyRoots)
  }

  const tree: KnowledgeBaseFileNode[] = []
  for (const root of context.wikiRoots) {
    const rootPath = join(context.wikiRoot, root)
    if (!existsSync(rootPath)) {
      tree.push({
        path: root,
        name: root,
        type: 'directory',
        children: [],
        pageType: root,
        readOnly: root === 'raw',
      })
      continue
    }
    try {
      const info = await stat(rootPath)
      if (!info.isDirectory()) continue
      tree.push({
        path: root,
        name: root,
        type: 'directory',
        modified: info.mtime.getTime(),
        children: await buildTreeFrom(context.wikiRoot, rootPath, root, maxDepth, readOnlyRoots),
        pageType: root,
        readOnly: root === 'raw',
      })
    } catch {
      // Ignore unreadable roots
    }
  }
  return tree
}

export async function readKnowledgeBaseContent(
  context: KnowledgeBaseContext,
  relativePath: string,
  scope: KnowledgeBaseScope = 'wiki',
): Promise<{ path: string; content: string; size: number; modified: number; wikiLinks: ReturnType<typeof extractWikiLinks>; pageType: string; readOnly: boolean }> {
  const normalized = normalizeRelativePath(relativePath)
  const safePath = await resolveKnowledgeBaseContentPath(context, normalized, scope)
  const content = await readFile(safePath, 'utf8')
  const info = await stat(safePath)
  const pageType = getKnowledgeBasePageType(normalized)
  return {
    path: normalized,
    content,
    size: info.size,
    modified: info.mtime.getTime(),
    wikiLinks: normalized.endsWith('.md') ? extractWikiLinks(content) : [],
    pageType,
    readOnly: scope === 'structured' || pageType === 'raw',
  }
}

export async function searchKnowledgeBase(
  context: KnowledgeBaseContext,
  query: string,
  limit = 100,
): Promise<Array<{
  path: string
  name: string
  matches: number
  pageType: string
  snippet: string
  governance: KnowledgeBaseGovernanceSummary
  rank: number
}>> {
  if (!context.wikiExists) return []
  const q = query.trim().toLowerCase()
  if (!q) return []

  const files = await scanMemoryFiles(context.wikiRoot, { extensions: ['.md', '.txt'], maxFiles: 4000 })
  const latestGovernance = new Map(
    listLatestKnowledgeBaseGovernanceRecords(context.runtimeProfile.name, files.map((file) => file.path.replace(/\\/g, '/')))
      .map((record) => [record.path, record] as const),
  )
  const results: Array<{
    path: string
    name: string
    matches: number
    pageType: string
    snippet: string
    governance: KnowledgeBaseGovernanceSummary
    rank: number
  }> = []

  for (const file of files) {
    if (!isKnowledgeBaseWikiPathAllowed(context, file.path)) continue
    try {
      const content = await readFile(join(context.wikiRoot, file.path), 'utf8')
      const lower = content.toLowerCase()
      let matches = 0
      let index = lower.indexOf(q)
      while (index !== -1) {
        matches += 1
        index = lower.indexOf(q, index + q.length)
      }
      if (matches === 0) continue
      const firstMatch = lower.indexOf(q)
      const snippetStart = Math.max(0, firstMatch - 60)
      const snippetEnd = Math.min(content.length, firstMatch + q.length + 80)
      const normalizedPath = file.path.replace(/\\/g, '/')
      const governanceRecord = latestGovernance.get(normalizedPath)
        || getEffectiveKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, normalizedPath)
      const governance = summarizeKnowledgeBaseGovernance(governanceRecord)
      let governanceWeight = governance.warningCount * -4
      if (governance.reviewStatus === 'approved') governanceWeight += 28
      else if (governance.reviewStatus === 'approved_with_warnings') governanceWeight += 10
      else if (governance.reviewStatus === 'overridden') governanceWeight -= 18
      else if (governance.reviewStatus === 'override_required') governanceWeight -= 24
      else if (governance.reviewStatus === 'unreviewed') governanceWeight -= 22

      if (governance.qualityLabel === 'trusted') governanceWeight += 18
      else if (governance.qualityLabel === 'supported') governanceWeight += 10
      else if (governance.qualityLabel === 'caution') governanceWeight -= 6
      else governanceWeight -= 16

      if (governance.overrideUsed) governanceWeight -= 10
      if (governance.riskLevel === 'critical' && governance.reviewStatus !== 'approved') governanceWeight -= 12

      results.push({
        path: normalizedPath,
        name: file.name,
        matches,
        pageType: getKnowledgeBasePageType(file.path),
        snippet: content.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ').trim(),
        governance,
        rank: matches * 100 + governanceWeight,
      })
    } catch {
      // Ignore unreadable files
    }
  }

  return results
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank
      if (b.matches !== a.matches) return b.matches - a.matches
      return a.path.localeCompare(b.path)
    })
    .slice(0, Math.max(1, Math.min(limit, 200)))
}

function getTagsForRows(db: Database.Database, entityType: KnowledgeBaseStructuredType, ids: number[]): Map<number, string[]> {
  const tagsById = new Map<number, string[]>()
  if (ids.length === 0) return tagsById
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT entity_id, tag FROM knowledge_tags WHERE entity_type = ? AND entity_id IN (${placeholders}) ORDER BY tag ASC`
  ).all(entityType, ...ids) as Array<{ entity_id: number; tag: string }>
  for (const row of rows) {
    const tags = tagsById.get(row.entity_id) || []
    tags.push(row.tag)
    tagsById.set(row.entity_id, tags)
  }
  return tagsById
}

export function listStructuredKnowledge(
  context: KnowledgeBaseContext,
  options?: { query?: string; type?: KnowledgeBaseStructuredType | 'all'; limit?: number },
): KnowledgeBaseStructuredEntry[] {
  if (!existsSync(context.stateDbPath)) return []

  const query = (options?.query || '').trim()
  const likeQuery = `%${query}%`
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 200))
  const requestedTypes = options?.type && options.type !== 'all'
    ? [options.type]
    : [...KNOWLEDGE_BASE_STRUCTURED_TYPES]

  const db = new Database(context.stateDbPath, { readonly: true, fileMustExist: true })
  try {
    const results: KnowledgeBaseStructuredEntry[] = []
    for (const type of requestedTypes) {
      if (type === 'note') {
        const rows = query
          ? db.prepare(
              'SELECT id, content, source, file_path, created_at, updated_at FROM knowledge_notes WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?'
            ).all(likeQuery, limit)
          : db.prepare(
              'SELECT id, content, source, file_path, created_at, updated_at FROM knowledge_notes ORDER BY updated_at DESC LIMIT ?'
            ).all(limit)
        const ids = rows.map((row: any) => Number(row.id))
        const tags = getTagsForRows(db, 'note', ids)
        for (const row of rows as any[]) {
          const content = String(row.content || '')
          results.push({
            type,
            id: Number(row.id),
            title: content.split(/\r?\n/, 1)[0]?.replace(/^#+\s*/, '').slice(0, 80) || `Note ${row.id}`,
            summary: content.slice(0, 240),
            tags: tags.get(Number(row.id)) || [],
            createdAt: typeof row.created_at === 'number' ? row.created_at : null,
            updatedAt: typeof row.updated_at === 'number' ? row.updated_at : null,
            source: row.source ? String(row.source) : null,
            linkedPath: row.file_path ? String(row.file_path) : null,
          })
        }
        continue
      }

      if (type === 'person') {
        const rows = query
          ? db.prepare(
              'SELECT id, name, role, organization, details, file_path, created_at, updated_at FROM knowledge_people WHERE name LIKE ? OR organization LIKE ? OR details LIKE ? ORDER BY updated_at DESC LIMIT ?'
            ).all(likeQuery, likeQuery, likeQuery, limit)
          : db.prepare(
              'SELECT id, name, role, organization, details, file_path, created_at, updated_at FROM knowledge_people ORDER BY updated_at DESC LIMIT ?'
            ).all(limit)
        const ids = rows.map((row: any) => Number(row.id))
        const tags = getTagsForRows(db, 'person', ids)
        for (const row of rows as any[]) {
          const title = String(row.name || `Person ${row.id}`)
          const summaryParts = [row.role, row.organization].filter(Boolean)
          results.push({
            type,
            id: Number(row.id),
            title,
            summary: summaryParts.length > 0 ? summaryParts.join(' — ') : String(row.details || ''),
            tags: tags.get(Number(row.id)) || [],
            createdAt: typeof row.created_at === 'number' ? row.created_at : null,
            updatedAt: typeof row.updated_at === 'number' ? row.updated_at : null,
            linkedPath: row.file_path ? String(row.file_path) : null,
            details: row.details ? String(row.details) : null,
            metadata: {
              role: row.role || null,
              organization: row.organization || null,
            },
          })
        }
        continue
      }

      if (type === 'project') {
        const rows = query
          ? db.prepare(
              'SELECT id, name, status, description, file_path, created_at, updated_at FROM knowledge_projects WHERE name LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT ?'
            ).all(likeQuery, likeQuery, limit)
          : db.prepare(
              'SELECT id, name, status, description, file_path, created_at, updated_at FROM knowledge_projects ORDER BY updated_at DESC LIMIT ?'
            ).all(limit)
        const ids = rows.map((row: any) => Number(row.id))
        const tags = getTagsForRows(db, 'project', ids)
        for (const row of rows as any[]) {
          results.push({
            type,
            id: Number(row.id),
            title: String(row.name || `Project ${row.id}`),
            summary: String(row.description || ''),
            tags: tags.get(Number(row.id)) || [],
            createdAt: typeof row.created_at === 'number' ? row.created_at : null,
            updatedAt: typeof row.updated_at === 'number' ? row.updated_at : null,
            status: row.status ? String(row.status) : null,
            linkedPath: row.file_path ? String(row.file_path) : null,
          })
        }
        continue
      }

      const rows = query
        ? db.prepare(
            'SELECT id, title, rationale, status, file_path, created_at, updated_at FROM knowledge_decisions WHERE title LIKE ? OR rationale LIKE ? ORDER BY updated_at DESC LIMIT ?'
          ).all(likeQuery, likeQuery, limit)
        : db.prepare(
            'SELECT id, title, rationale, status, file_path, created_at, updated_at FROM knowledge_decisions ORDER BY updated_at DESC LIMIT ?'
          ).all(limit)
      const ids = rows.map((row: any) => Number(row.id))
      const tags = getTagsForRows(db, 'decision', ids)
      for (const row of rows as any[]) {
        results.push({
          type,
          id: Number(row.id),
          title: String(row.title || `Decision ${row.id}`),
          summary: String(row.rationale || ''),
          tags: tags.get(Number(row.id)) || [],
          createdAt: typeof row.created_at === 'number' ? row.created_at : null,
          updatedAt: typeof row.updated_at === 'number' ? row.updated_at : null,
          status: row.status ? String(row.status) : null,
          linkedPath: row.file_path ? String(row.file_path) : null,
        })
      }
    }

    return results
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, limit)
  } finally {
    db.close()
  }
}

export function getKnowledgeBaseMemory(runtimeProfileName?: string | null) {
  const context = getKnowledgeBaseContext(runtimeProfileName)
  return {
    ...getHermesMemory(context.hermesHome),
    runtimeProfileName: context.runtimeProfile.name,
  }
}
