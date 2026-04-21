import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { KnowledgeBaseContext, KnowledgeBaseScope } from '@/lib/knowledge-base'
import {
  getEffectiveKnowledgeBaseGovernanceRecord,
  summarizeKnowledgeBaseGovernance,
  type KnowledgeBaseGovernanceSummary,
} from '@/lib/knowledge-base-governance'

export const OBSIDIAN_MANAGED_FOLDERS = [
  'Wiki',
  'Notes',
  'People',
  'Projects',
  'Decisions',
  'Episodes',
  'Research',
  'Assets',
  'Canvas',
] as const

type ManagedFolder = typeof OBSIDIAN_MANAGED_FOLDERS[number]
type SyncDirection = 'db_to_vault' | 'vault_to_db' | 'vault_scan' | 'import'
type SyncStatus = 'synced' | 'vault_modified' | 'db_modified' | 'conflict' | 'deleted' | 'import_pending'
type ConflictStatus = 'none' | 'open' | 'resolved'
type SyncAction = 'reconcile' | 'sync_note'

export interface ObsidianAttachmentRef {
  ownerPath: string
  targetPath: string
  targetType: 'embed' | 'markdown'
  exists: boolean
  mimeType: string | null
}

export interface ObsidianCanvasRef {
  canvasPath: string
  nodeId: string
  nodeType: string
  targetPath: string | null
  broken: boolean
  metadata?: Record<string, unknown>
}

export interface ObsidianManagedFileRecord {
  id: number
  uuid: string | null
  vaultRelativePath: string
  managedRelativePath: string
  entityType: string | null
  wikiPageType: string | null
  fileExt: string | null
  contentHash: string | null
  lastVaultMtime: number | null
  lastVaultSize: number | null
  lastDbRevisionId: number | null
  lastSyncDirection: SyncDirection | null
  syncStatus: SyncStatus
  conflictState: ConflictStatus
  sourceOrigin: 'managed' | 'external_import'
  tombstoned: boolean
  metadata: Record<string, unknown>
  updatedAt: number
  createdAt: number
}

export interface ObsidianConflictRecord {
  id: number
  vaultRelativePath: string
  uuid: string | null
  entityType: string | null
  conflictType: string
  status: 'open' | 'resolved'
  summary: string
  dbSnapshot: string | null
  vaultSnapshot: string | null
  resolution: string | null
  reviewPath: string | null
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
}

export interface ObsidianFileRevisionRecord {
  id: number
  vaultRelativePath: string
  contentHash: string
  contentText: string | null
  source: string
  actor: string | null
  metadata: Record<string, unknown>
  createdAt: number
}

export interface ObsidianImportCandidate {
  id: number
  vaultRelativePath: string
  title: string
  fileUuid: string | null
  contentHash: string | null
  lastVaultMtime: number | null
  imported: boolean
  importedManagedPath: string | null
  metadata: Record<string, unknown>
  updatedAt: number
}

export interface ObsidianPluginConnection {
  id: number
  clientId: string
  clientName: string
  clientVersion: string | null
  vaultName: string | null
  status: 'connected' | 'disconnected'
  lastSeenAt: number
  connectedAt: number | null
  disconnectedAt: number | null
  metadata: Record<string, unknown>
}

export interface ObsidianStatusPayload {
  configured: boolean
  runtimeProfileName: string
  vaultPath: string | null
  managedRoot: string | null
  managedFolders: string[]
  watcher: {
    status: string | null
    lastStartedAt: number | null
    lastCompletedAt: number | null
    lastError: string | null
    lastScanCount: number
    lastChangeCount: number
  } | null
  lastCheckpoint: {
    scope: string
    status: string | null
    lastStartedAt: number | null
    lastCompletedAt: number | null
    lastScanCount: number
    lastChangeCount: number
    lastError: string | null
  } | null
  pluginConnection: ObsidianPluginConnection | null
  syncHealth: {
    managedFiles: number
    vaultModified: number
    pendingConflicts: number
    importCandidates: number
    attachmentRefs: number
    brokenAttachmentRefs: number
    canvasRefs: number
    brokenCanvasRefs: number
  }
  activeNote?: ObsidianActiveNoteStatus | null
  recentEvents: Array<{
    id: number
    eventType: string
    path: string | null
    direction: string | null
    status: string
    detail: string | null
    createdAt: number
  }>
}

export interface ObsidianActiveNoteStatus {
  path: string
  managed: boolean
  importCandidate: boolean
  sourceOrigin: 'managed' | 'external_import' | 'external'
  managedPath: string | null
  syncStatus: SyncStatus | null
  conflictState: ConflictStatus | null
  conflictId: number | null
  conflictSummary: string | null
  reviewPath: string | null
  lastSyncedAt: number | null
  lastVaultModifiedAt: number | null
  importedFrom: string | null
  governance: KnowledgeBaseGovernanceSummary | null
  recommendedActions: Array<'sync_note' | 'import_note' | 'resolve_conflict' | 'open_mission_control'>
}

export interface ObsidianContentMetadata {
  vaultBacked: boolean
  vaultRelativePath: string | null
  managedRelativePath: string | null
  syncStatus: SyncStatus | null
  conflictState: ConflictStatus | null
  fileUuid: string | null
  contentHash: string | null
  lastDbRevisionId: number | null
  sourceOrigin: 'managed' | 'external_import' | 'external'
  attachmentRefs: ObsidianAttachmentRef[]
  canvasRefs: ObsidianCanvasRef[]
}

interface SyncSummary {
  configured: boolean
  runtimeProfileName: string
  vaultPath: string | null
  managedRoot: string | null
  managedFilesScanned: number
  importsIndexed: number
  conflictsOpened: number
  deletedFiles: number
  changedFiles: number
  scope: SyncAction
  path?: string | null
  checkpointStatus: 'ok' | 'error'
  error?: string
}

type FrontmatterParseResult = {
  frontmatter: Record<string, unknown>
  body: string
  rawFrontmatter: string | null
  orderedKeys: string[]
}

interface MarkdownReferenceSummary {
  wikiLinks: string[]
  embeds: string[]
  markdownLinks: string[]
  tags: string[]
  taskCount: number
  calloutCount: number
  dataviewFields: string[]
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function computeHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function ensureHermesObsidianSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS obsidian_managed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT,
      vault_relative_path TEXT NOT NULL UNIQUE,
      managed_relative_path TEXT NOT NULL,
      entity_type TEXT,
      wiki_page_type TEXT,
      file_ext TEXT,
      content_hash TEXT,
      last_vault_mtime REAL,
      last_vault_size INTEGER,
      last_db_revision_id INTEGER,
      last_sync_direction TEXT NOT NULL DEFAULT 'vault_scan',
      sync_status TEXT NOT NULL DEFAULT 'synced',
      conflict_state TEXT NOT NULL DEFAULT 'none',
      source_origin TEXT NOT NULL DEFAULT 'managed',
      tombstoned INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_managed_uuid ON obsidian_managed_files(uuid);
    CREATE INDEX IF NOT EXISTS idx_obsidian_managed_status ON obsidian_managed_files(sync_status, tombstoned);

    CREATE TABLE IF NOT EXISTS obsidian_sync_checkpoints (
      scope TEXT PRIMARY KEY,
      last_started_at REAL,
      last_completed_at REAL,
      last_status TEXT,
      last_error TEXT,
      last_scan_count INTEGER NOT NULL DEFAULT 0,
      last_change_count INTEGER NOT NULL DEFAULT 0,
      updated_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS obsidian_sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      path TEXT,
      direction TEXT,
      status TEXT NOT NULL,
      detail TEXT,
      metadata_json TEXT,
      created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_sync_events_created ON obsidian_sync_events(created_at DESC);

    CREATE TABLE IF NOT EXISTS obsidian_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_relative_path TEXT NOT NULL,
      uuid TEXT,
      entity_type TEXT,
      conflict_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      summary TEXT NOT NULL,
      db_snapshot TEXT,
      vault_snapshot TEXT,
      resolution TEXT,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      resolved_at REAL
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_conflicts_status ON obsidian_conflicts(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS obsidian_file_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_text TEXT,
      source TEXT NOT NULL,
      actor TEXT,
      metadata_json TEXT,
      created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_file_revisions_path ON obsidian_file_revisions(vault_relative_path, created_at DESC);

    CREATE TABLE IF NOT EXISTS obsidian_attachment_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      target_type TEXT NOT NULL,
      exists_flag INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      UNIQUE(owner_path, target_path, target_type)
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_attachment_owner ON obsidian_attachment_index(owner_path);

    CREATE TABLE IF NOT EXISTS obsidian_canvas_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canvas_path TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      target_path TEXT,
      broken INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      updated_at REAL NOT NULL,
      UNIQUE(canvas_path, node_id)
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_canvas_path ON obsidian_canvas_index(canvas_path);

    CREATE TABLE IF NOT EXISTS obsidian_import_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_relative_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      file_uuid TEXT,
      content_hash TEXT,
      last_vault_mtime REAL,
      imported INTEGER NOT NULL DEFAULT 0,
      imported_managed_path TEXT,
      metadata_json TEXT,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_import_imported ON obsidian_import_candidates(imported, updated_at DESC);

    CREATE TABLE IF NOT EXISTS obsidian_plugin_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      client_name TEXT NOT NULL,
      client_version TEXT,
      vault_name TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      metadata_json TEXT,
      connected_at REAL,
      disconnected_at REAL,
      last_seen_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obsidian_plugin_status ON obsidian_plugin_connections(status, last_seen_at DESC);
  `)
  try {
    db.exec(`ALTER TABLE obsidian_conflicts ADD COLUMN review_path TEXT`)
  } catch {}
}

function openHermesStateDb(context: KnowledgeBaseContext, writable = false) {
  const db = new Database(context.stateDbPath, writable ? {} : { readonly: false, fileMustExist: false })
  ensureHermesObsidianSchema(db)
  return db
}

function getVaultPaths(context: KnowledgeBaseContext): { vaultPath: string | null; managedRoot: string | null } {
  if (!context.structuredVaultPath) {
    return { vaultPath: null, managedRoot: null }
  }
  return {
    vaultPath: dirname(context.structuredVaultPath),
    managedRoot: context.structuredVaultPath,
  }
}

function parseFrontmatter(content: string): FrontmatterParseResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: {}, body: content, rawFrontmatter: null, orderedKeys: [] }
  const rawFrontmatter = match[1]
  const frontmatter: Record<string, unknown> = {}
  const orderedKeys: string[] = []
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    orderedKeys.push(key)
    const rawValue = trimmed.slice(idx + 1).trim()
    if (!rawValue) {
      frontmatter[key] = ''
      continue
    }
    if (rawValue === 'true' || rawValue === 'false') {
      frontmatter[key] = rawValue === 'true'
      continue
    }
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith('\'') && rawValue.endsWith('\''))) {
      frontmatter[key] = rawValue.slice(1, -1)
      continue
    }
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      frontmatter[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      continue
    }
    frontmatter[key] = rawValue
  }
  return {
    frontmatter,
    body: content.slice(match[0].length),
    rawFrontmatter,
    orderedKeys,
  }
}

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string, orderedKeys: string[] = []) {
  const lines = ['---']
  const keys = [...orderedKeys.filter((key) => key in frontmatter), ...Object.keys(frontmatter).filter((key) => !orderedKeys.includes(key))]
  for (const key of keys) {
    const value = frontmatter[key]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((item) => `"${String(item).replace(/"/g, '\\"')}"`).join(', ')}]`)
      continue
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${String(value)}`)
      continue
    }
    lines.push(`${key}: "${String(value).replace(/"/g, '\\"')}"`)
  }
  lines.push('---', '')
  return `${lines.join('\n')}${body}`
}

function extractMarkdownReferenceSummary(content: string): MarkdownReferenceSummary {
  const wikiLinks = Array.from(content.matchAll(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map((match) => match[1].trim())
  const embeds = Array.from(content.matchAll(/!\[\[([^\]]+)\]\]/g)).map((match) => match[1].trim())
  const markdownLinks = Array.from(content.matchAll(/!?\[[^\]]*?\]\(([^)]+)\)/g)).map((match) => match[1].trim())
  const tags = Array.from(content.matchAll(/(^|\s)#([A-Za-z0-9/_-]+)/g)).map((match) => match[2])
  const taskCount = Array.from(content.matchAll(/^\s*[-*]\s+\[[ xX]\]/gm)).length
  const calloutCount = Array.from(content.matchAll(/^\s*>\s*\[[!][A-Z0-9_-]+\]/gim)).length
  const dataviewFields = Array.from(content.matchAll(/^\s*([A-Za-z0-9_-]+)::\s+(.+)$/gm)).map((match) => match[1])
  return { wikiLinks, embeds, markdownLinks, tags, taskCount, calloutCount, dataviewFields }
}

function extractCanvasRefs(content: string): ObsidianCanvasRef[] {
  try {
    const parsed = JSON.parse(content) as { nodes?: Array<Record<string, unknown>> }
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
    return nodes.map((node) => {
      const targetPath = typeof node.file === 'string'
        ? String(node.file)
        : typeof node.path === 'string'
          ? String(node.path)
          : null
      const nodeId = typeof node.id === 'string' ? node.id : randomUUID()
      const nodeType = typeof node.type === 'string' ? node.type : 'unknown'
      return {
        canvasPath: '',
        nodeId,
        nodeType,
        targetPath,
        broken: false,
        metadata: node,
      }
    })
  } catch {
    return []
  }
}

function walkFiles(root: string, predicate?: (path: string) => boolean): string[] {
  if (!existsSync(root)) return []
  const results: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.obsidian' || entry.name === '.git') continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (predicate && !predicate(fullPath)) continue
      results.push(fullPath)
    }
  }
  visit(root)
  return results
}

function inferMimeType(targetPath: string): string | null {
  const ext = extname(targetPath).toLowerCase()
  if (!ext) return null
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return `image/${ext.slice(1) === 'svg' ? 'svg+xml' : ext.slice(1)}`
  if (['.md', '.markdown', '.txt'].includes(ext)) return 'text/plain'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.canvas') return 'application/json'
  return null
}

function resolveReference(baseDir: string, reference: string): string {
  const normalized = reference.replace(/^file:\/\//, '').split('#')[0]
  if (!normalized) return baseDir
  if (normalized.startsWith('/')) return resolve(normalized)
  return resolve(baseDir, normalized)
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/*?:"<>|]/g, '-').trim() || 'Imported Note'
}

function mapManagedMetadata(context: KnowledgeBaseContext, managedRoot: string, absolutePath: string) {
  const relativeManagedPath = normalizePath(relative(managedRoot, absolutePath))
  const vaultRelativePath = normalizePath(join(context.agentPrefix, relativeManagedPath))
  const segments = relativeManagedPath.split('/')
  const top = segments[0] as ManagedFolder | string
  const entityType = top === 'Notes'
    ? 'note'
    : top === 'People'
      ? 'person'
      : top === 'Projects'
        ? 'project'
        : top === 'Decisions'
          ? 'decision'
          : top === 'Episodes'
            ? 'episode'
            : top === 'Research'
              ? 'research'
              : top === 'Canvas'
                ? 'canvas'
                : top === 'Assets'
                  ? 'asset'
                  : top === 'Wiki'
                    ? 'wiki'
                    : null
  const wikiPageType = top === 'Wiki' ? segments[1] || 'root' : null
  return { relativeManagedPath, vaultRelativePath, entityType, wikiPageType }
}

function upsertManagedFile(db: Database.Database, record: Omit<ObsidianManagedFileRecord, 'id' | 'createdAt' | 'updatedAt'>) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO obsidian_managed_files (
      uuid, vault_relative_path, managed_relative_path, entity_type, wiki_page_type,
      file_ext, content_hash, last_vault_mtime, last_vault_size, last_db_revision_id,
      last_sync_direction, sync_status, conflict_state, source_origin, tombstoned,
      metadata_json, created_at, updated_at
    ) VALUES (
      @uuid, @vaultRelativePath, @managedRelativePath, @entityType, @wikiPageType,
      @fileExt, @contentHash, @lastVaultMtime, @lastVaultSize, @lastDbRevisionId,
      @lastSyncDirection, @syncStatus, @conflictState, @sourceOrigin, @tombstoned,
      @metadataJson, @createdAt, @updatedAt
    )
    ON CONFLICT(vault_relative_path) DO UPDATE SET
      uuid = excluded.uuid,
      managed_relative_path = excluded.managed_relative_path,
      entity_type = excluded.entity_type,
      wiki_page_type = excluded.wiki_page_type,
      file_ext = excluded.file_ext,
      content_hash = excluded.content_hash,
      last_vault_mtime = excluded.last_vault_mtime,
      last_vault_size = excluded.last_vault_size,
      last_db_revision_id = COALESCE(excluded.last_db_revision_id, obsidian_managed_files.last_db_revision_id),
      last_sync_direction = excluded.last_sync_direction,
      sync_status = excluded.sync_status,
      conflict_state = excluded.conflict_state,
      source_origin = excluded.source_origin,
      tombstoned = excluded.tombstoned,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run({
    ...record,
    tombstoned: record.tombstoned ? 1 : 0,
    metadataJson: JSON.stringify(record.metadata || {}),
    createdAt: now,
    updatedAt: now,
  })
}

function replaceAttachmentRefs(db: Database.Database, ownerPath: string, refs: ObsidianAttachmentRef[]) {
  const now = Date.now()
  db.prepare('DELETE FROM obsidian_attachment_index WHERE owner_path = ?').run(ownerPath)
  const insert = db.prepare(`
    INSERT INTO obsidian_attachment_index (owner_path, target_path, target_type, exists_flag, mime_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const ref of refs) {
    insert.run(ownerPath, ref.targetPath, ref.targetType, ref.exists ? 1 : 0, ref.mimeType, now, now)
  }
}

function replaceCanvasRefs(db: Database.Database, canvasPath: string, refs: ObsidianCanvasRef[]) {
  db.prepare('DELETE FROM obsidian_canvas_index WHERE canvas_path = ?').run(canvasPath)
  const insert = db.prepare(`
    INSERT INTO obsidian_canvas_index (canvas_path, node_id, node_type, target_path, broken, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const now = Date.now()
  for (const ref of refs) {
    insert.run(canvasPath, ref.nodeId, ref.nodeType, ref.targetPath, ref.broken ? 1 : 0, JSON.stringify(ref.metadata || {}), now)
  }
}

function upsertImportCandidate(db: Database.Database, candidate: Omit<ObsidianImportCandidate, 'id' | 'updatedAt'>) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO obsidian_import_candidates (
      vault_relative_path, title, file_uuid, content_hash, last_vault_mtime, imported, imported_managed_path, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vault_relative_path) DO UPDATE SET
      title = excluded.title,
      file_uuid = excluded.file_uuid,
      content_hash = excluded.content_hash,
      last_vault_mtime = excluded.last_vault_mtime,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    candidate.vaultRelativePath,
    candidate.title,
    candidate.fileUuid,
    candidate.contentHash,
    candidate.lastVaultMtime,
    candidate.imported ? 1 : 0,
    candidate.importedManagedPath,
    JSON.stringify(candidate.metadata || {}),
    now,
    now,
  )
}

function recordSyncEvent(
  db: Database.Database,
  eventType: string,
  options: { path?: string | null; direction?: string | null; status: string; detail?: string | null; metadata?: Record<string, unknown> },
) {
  db.prepare(`
    INSERT INTO obsidian_sync_events (event_type, path, direction, status, detail, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    options.path ?? null,
    options.direction ?? null,
    options.status,
    options.detail ?? null,
    JSON.stringify(options.metadata || {}),
    Date.now(),
  )
}

function updateCheckpoint(
  db: Database.Database,
  scope: string,
  values: {
    lastStartedAt?: number | null
    lastCompletedAt?: number | null
    lastStatus?: string | null
    lastError?: string | null
    lastScanCount?: number
    lastChangeCount?: number
  },
) {
  db.prepare(`
    INSERT INTO obsidian_sync_checkpoints (
      scope, last_started_at, last_completed_at, last_status, last_error, last_scan_count, last_change_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      last_started_at = COALESCE(excluded.last_started_at, obsidian_sync_checkpoints.last_started_at),
      last_completed_at = COALESCE(excluded.last_completed_at, obsidian_sync_checkpoints.last_completed_at),
      last_status = COALESCE(excluded.last_status, obsidian_sync_checkpoints.last_status),
      last_error = excluded.last_error,
      last_scan_count = COALESCE(excluded.last_scan_count, obsidian_sync_checkpoints.last_scan_count),
      last_change_count = COALESCE(excluded.last_change_count, obsidian_sync_checkpoints.last_change_count),
      updated_at = excluded.updated_at
  `).run(
    scope,
    values.lastStartedAt ?? null,
    values.lastCompletedAt ?? null,
    values.lastStatus ?? null,
    values.lastError ?? null,
    values.lastScanCount ?? 0,
    values.lastChangeCount ?? 0,
    Date.now(),
  )
}

function openDuplicateUuidConflict(
  db: Database.Database,
  uuid: string,
  currentPath: string,
  existingPath: string,
  entityType: string | null,
) {
  const now = Date.now()
  const summary = `Duplicate Obsidian UUID ${uuid} detected for ${currentPath} and ${existingPath}.`
  const exists = db.prepare(`
    SELECT id FROM obsidian_conflicts
    WHERE status = 'open' AND conflict_type = 'duplicate_uuid' AND uuid = ? AND vault_relative_path = ?
  `).get(uuid, currentPath) as { id: number } | undefined
  if (!exists) {
    db.prepare(`
      INSERT INTO obsidian_conflicts (
        vault_relative_path, uuid, entity_type, conflict_type, status, summary, db_snapshot, vault_snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, 'duplicate_uuid', 'open', ?, NULL, NULL, ?, ?)
    `).run(currentPath, uuid, entityType, summary, now, now)
  }
  db.prepare(`
    UPDATE obsidian_managed_files
    SET sync_status = 'conflict', conflict_state = 'open', updated_at = ?
    WHERE vault_relative_path IN (?, ?)
  `).run(now, currentPath, existingPath)
}

function extractAttachmentRefs(
  absolutePath: string,
  content: string,
  vaultPath: string,
): ObsidianAttachmentRef[] {
  const baseDir = dirname(absolutePath)
  const summary = extractMarkdownReferenceSummary(content)
  const candidates = [
    ...summary.embeds.map((target) => ({ target, targetType: 'embed' as const })),
    ...summary.markdownLinks.map((target) => ({ target, targetType: 'markdown' as const })),
  ]
  return candidates.map(({ target, targetType }) => {
    const resolvedPath = resolveReference(baseDir, target)
    const exists = existsSync(resolvedPath)
    return {
      ownerPath: normalizePath(relative(vaultPath, absolutePath)),
      targetPath: normalizePath(relative(vaultPath, resolvedPath)),
      targetType,
      exists,
      mimeType: inferMimeType(target),
    }
  })
}

function readManagedFileRow(db: Database.Database, vaultRelativePath: string) {
  return db.prepare(`
    SELECT
      id,
      uuid,
      vault_relative_path AS vaultRelativePath,
      managed_relative_path AS managedRelativePath,
      entity_type AS entityType,
      wiki_page_type AS wikiPageType,
      file_ext AS fileExt,
      content_hash AS contentHash,
      last_vault_mtime AS lastVaultMtime,
      last_vault_size AS lastVaultSize,
      last_db_revision_id AS lastDbRevisionId,
      last_sync_direction AS lastSyncDirection,
      sync_status AS syncStatus,
      conflict_state AS conflictState,
      source_origin AS sourceOrigin,
      tombstoned,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM obsidian_managed_files
    WHERE vault_relative_path = ?
  `).get(vaultRelativePath) as (Omit<ObsidianManagedFileRecord, 'tombstoned' | 'metadata'> & { tombstoned: number; metadataJson: string | null }) | undefined
}

function readLatestRevision(db: Database.Database, vaultRelativePath: string): ObsidianFileRevisionRecord | null {
  const row = db.prepare(`
    SELECT
      id,
      vault_relative_path AS vaultRelativePath,
      content_hash AS contentHash,
      content_text AS contentText,
      source,
      actor,
      metadata_json AS metadataJson,
      created_at AS createdAt
    FROM obsidian_file_revisions
    WHERE vault_relative_path = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(vaultRelativePath) as { id: number; vaultRelativePath: string; contentHash: string; contentText: string | null; source: string; actor: string | null; metadataJson: string | null; createdAt: number } | undefined
  if (!row) return null
  return {
    ...row,
    metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {},
  }
}

function getObsidianActiveNoteStatus(
  db: Database.Database,
  context: KnowledgeBaseContext,
  path: string,
): ObsidianActiveNoteStatus {
  const normalizedPath = normalizePath(path)
  const managedPrefix = normalizePath(`${context.agentPrefix}/`)
  const managed = normalizedPath.startsWith(managedPrefix)
  const row = managed ? readManagedFileRow(db, normalizedPath) : null
  const conflict = db.prepare(`
    SELECT id, summary, review_path AS reviewPath
    FROM obsidian_conflicts
    WHERE status = 'open' AND vault_relative_path = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(normalizedPath) as { id: number; summary: string; reviewPath: string | null } | undefined
  const importCandidate = db.prepare(`
    SELECT metadata_json AS metadataJson
    FROM obsidian_import_candidates
    WHERE vault_relative_path = ?
    LIMIT 1
  `).get(normalizedPath) as { metadataJson: string | null } | undefined

  let governance: KnowledgeBaseGovernanceSummary | null = null
  if (managed && normalizedPath.startsWith(normalizePath(`${context.agentPrefix}/Wiki/`))) {
    const kbPath = normalizedPath.slice(normalizePath(`${context.agentPrefix}/Wiki/`).length)
    const record = getEffectiveKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, kbPath)
    governance = summarizeKnowledgeBaseGovernance(record)
  }

  const metadata = row?.metadataJson ? JSON.parse(row.metadataJson) as Record<string, unknown> : {}
  const frontmatter = typeof metadata === 'object' && metadata && 'frontmatter' in metadata
    ? (metadata.frontmatter as Record<string, unknown>)
    : {}
  const recommendedActions: ObsidianActiveNoteStatus['recommendedActions'] = []
  if (managed) recommendedActions.push('sync_note')
  if (!managed) recommendedActions.push('import_note')
  if (conflict?.id) recommendedActions.push('resolve_conflict')
  recommendedActions.push('open_mission_control')

  return {
    path: normalizedPath,
    managed,
    importCandidate: Boolean(importCandidate),
    sourceOrigin: row ? (row.sourceOrigin as 'managed' | 'external_import') : 'external',
    managedPath: row?.managedRelativePath ?? null,
    syncStatus: row ? (row.syncStatus as SyncStatus) : null,
    conflictState: row ? (row.conflictState as ConflictStatus) : null,
    conflictId: conflict?.id ?? null,
    conflictSummary: conflict?.summary ?? null,
    reviewPath: conflict?.reviewPath ?? null,
    lastSyncedAt: row?.updatedAt ?? null,
    lastVaultModifiedAt: row?.lastVaultMtime ?? null,
    importedFrom: typeof frontmatter.imported_from === 'string' ? frontmatter.imported_from : null,
    governance,
    recommendedActions,
  }
}

function recordRevision(
  db: Database.Database,
  input: {
    vaultRelativePath: string
    contentHash: string
    contentText: string | null
    source: string
    actor?: string | null
    metadata?: Record<string, unknown>
  },
) {
  const info = db.prepare(`
    INSERT INTO obsidian_file_revisions (
      vault_relative_path, content_hash, content_text, source, actor, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.vaultRelativePath,
    input.contentHash,
    input.contentText,
    input.source,
    input.actor ?? null,
    JSON.stringify(input.metadata || {}),
    Date.now(),
  )
  return Number(info.lastInsertRowid)
}

function summarizeConflictPreview(dbSnapshot: string | null, vaultSnapshot: string | null) {
  if (dbSnapshot === null || vaultSnapshot === null) return 'Conflict recorded with incomplete snapshot data.'
  if (dbSnapshot === vaultSnapshot) return 'Conflict recorded, but both snapshots are currently identical.'
  const dbLines = dbSnapshot.split(/\r?\n/)
  const vaultLines = vaultSnapshot.split(/\r?\n/)
  let changed = 0
  const limit = Math.max(dbLines.length, vaultLines.length)
  for (let index = 0; index < limit; index += 1) {
    if ((dbLines[index] || '') !== (vaultLines[index] || '')) changed += 1
  }
  return `${changed} differing line${changed === 1 ? '' : 's'} between the canonical DB snapshot and the current vault file.`
}

function nextMergeReviewPath(vaultRelativePath: string) {
  const normalized = normalizePath(vaultRelativePath)
  const ext = extname(normalized) || '.md'
  const base = normalized.replace(new RegExp(`${ext.replace('.', '\\.')}$`), '')
  return `${base}.merge-review${ext === '.canvas' ? '.md' : ext}`
}

function hasOpenConflict(db: Database.Database, vaultRelativePath: string) {
  const row = db.prepare(`
    SELECT id FROM obsidian_conflicts
    WHERE status = 'open' AND vault_relative_path = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(vaultRelativePath) as { id: number } | undefined
  return row ? row.id : null
}

function parseManagedVaultPath(context: KnowledgeBaseContext, vaultRelativePath: string) {
  const { vaultPath, managedRoot } = getVaultPaths(context)
  if (!vaultPath || !managedRoot) {
    throw new Error('Obsidian vault is not configured')
  }
  const normalized = normalizePath(vaultRelativePath)
  const expectedPrefix = normalizePath(`${context.agentPrefix}/`)
  if (!normalized.startsWith(expectedPrefix)) {
    throw new Error('Path is outside the Hermes-managed vault root')
  }
  const managedRelativePath = normalizePath(normalized.slice(expectedPrefix.length))
  return {
    vaultPath,
    managedRoot,
    absolutePath: join(vaultPath, normalized),
    managedRelativePath,
  }
}

function writeManagedFileContent(absolutePath: string, content: string) {
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
}

function indexManagedFileContent(
  db: Database.Database,
  context: KnowledgeBaseContext,
  absolutePath: string,
  rawContent: string | Buffer,
  options?: {
    existing?: ReturnType<typeof readManagedFileRow>
    sourceOrigin?: 'managed' | 'external_import'
    lastSyncDirection?: SyncDirection
    syncStatus?: SyncStatus
    conflictState?: ConflictStatus
    lastDbRevisionId?: number | null
  },
) {
  const { vaultPath, managedRoot } = getVaultPaths(context)
  if (!vaultPath || !managedRoot) throw new Error('Obsidian vault is not configured')
  const { relativeManagedPath, vaultRelativePath, entityType, wikiPageType } = mapManagedMetadata(context, managedRoot, absolutePath)
  const info = statSync(absolutePath)
  const ext = extname(absolutePath).toLowerCase()
  const contentHash = computeHash(rawContent)
  let uuid: string | null = null
  let metadata: Record<string, unknown> = {}
  if (typeof rawContent === 'string' && ext === '.md') {
    const { frontmatter, orderedKeys } = parseFrontmatter(rawContent)
    uuid = typeof frontmatter.uuid === 'string' ? frontmatter.uuid : null
    const refs = extractMarkdownReferenceSummary(rawContent)
    metadata = {
      frontmatter,
      frontmatterKeyOrder: orderedKeys,
      wikiLinkCount: refs.wikiLinks.length,
      embedCount: refs.embeds.length,
      markdownLinkCount: refs.markdownLinks.length,
      tagCount: refs.tags.length,
      taskCount: refs.taskCount,
      calloutCount: refs.calloutCount,
      dataviewFields: refs.dataviewFields,
    }
    replaceAttachmentRefs(db, vaultRelativePath, extractAttachmentRefs(absolutePath, rawContent, vaultPath))
  } else if (typeof rawContent === 'string' && ext === '.canvas') {
    const refs = extractCanvasRefs(rawContent).map((ref) => {
      const targetPath = ref.targetPath ? normalizePath(ref.targetPath) : null
      const resolved = targetPath ? resolveReference(dirname(absolutePath), targetPath) : null
      return {
        ...ref,
        canvasPath: vaultRelativePath,
        targetPath,
        broken: Boolean(targetPath && resolved && !existsSync(resolved)),
      }
    })
    metadata = { nodeCount: refs.length }
    replaceCanvasRefs(db, vaultRelativePath, refs)
  }
  upsertManagedFile(db, {
    uuid,
    vaultRelativePath,
    managedRelativePath: normalizePath(relativeManagedPath),
    entityType,
    wikiPageType,
    fileExt: ext || null,
    contentHash,
    lastVaultMtime: info.mtimeMs,
    lastVaultSize: info.size,
    lastDbRevisionId: options?.lastDbRevisionId ?? options?.existing?.lastDbRevisionId ?? null,
    lastSyncDirection: options?.lastSyncDirection ?? 'vault_to_db',
    syncStatus: options?.syncStatus ?? 'synced',
    conflictState: options?.conflictState ?? 'none',
    sourceOrigin: options?.sourceOrigin ?? 'managed',
    tombstoned: false,
    metadata,
  })
  return { vaultRelativePath, entityType, wikiPageType, uuid, contentHash, metadata }
}

function recordContentConflict(
  db: Database.Database,
  context: KnowledgeBaseContext,
  path: string,
  editedContent: string,
  actor: string,
) {
  const { absolutePath } = parseManagedVaultPath(context, path)
  const vaultContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
  const summary = summarizeConflictPreview(editedContent, vaultContent)
  const existing = db.prepare(`
    SELECT id FROM obsidian_conflicts
    WHERE status = 'open' AND vault_relative_path = ? AND conflict_type = 'content_diverged'
    ORDER BY created_at DESC LIMIT 1
  `).get(path) as { id: number } | undefined
  const now = Date.now()
  if (existing) {
    db.prepare(`
      UPDATE obsidian_conflicts
      SET summary = ?, db_snapshot = ?, vault_snapshot = ?, updated_at = ?
      WHERE id = ?
    `).run(summary, editedContent, vaultContent, now, existing.id)
  } else {
    db.prepare(`
      INSERT INTO obsidian_conflicts (
        vault_relative_path, uuid, entity_type, conflict_type, status, summary, db_snapshot, vault_snapshot, created_at, updated_at
      ) VALUES (?, NULL, NULL, 'content_diverged', 'open', ?, ?, ?, ?, ?)
    `).run(path, summary, editedContent, vaultContent, now, now)
  }
  db.prepare(`
    UPDATE obsidian_managed_files
    SET sync_status = 'conflict', conflict_state = 'open', updated_at = ?
    WHERE vault_relative_path = ?
  `).run(now, path)
  recordSyncEvent(db, 'content_conflict', {
    path,
    direction: 'db_to_vault',
    status: 'warning',
    detail: `${actor} attempted to save stale content over a changed vault file`,
  })
}

export function syncObsidianVault(context: KnowledgeBaseContext): SyncSummary {
  const { vaultPath, managedRoot } = getVaultPaths(context)
  if (!vaultPath || !managedRoot || !existsSync(vaultPath) || !existsSync(managedRoot)) {
    return {
      configured: false,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFilesScanned: 0,
      importsIndexed: 0,
      conflictsOpened: 0,
      deletedFiles: 0,
      changedFiles: 0,
      scope: 'reconcile',
      checkpointStatus: 'error',
      error: 'Obsidian vault is not configured for this runtime profile.',
    }
  }

  const db = openHermesStateDb(context, true)
  const startedAt = Date.now()
  updateCheckpoint(db, 'obsidian-vault', { lastStartedAt: startedAt, lastStatus: 'running', lastError: null })
  try {
    const existingRows = new Map<string, any>(
      (db.prepare('SELECT vault_relative_path AS path, content_hash AS contentHash, last_sync_direction AS lastSyncDirection FROM obsidian_managed_files WHERE tombstoned = 0').all() as Array<any>)
        .map((row) => [row.path as string, row]),
    )
    const seen = new Set<string>()
    const uuidToPath = new Map<string, string>()
    let managedFilesScanned = 0
    let importsIndexed = 0
    let conflictsOpened = 0
    let deletedFiles = 0
    let changedFiles = 0

    db.prepare(`UPDATE obsidian_conflicts SET status = 'resolved', resolution = 'superseded_by_rescan', resolved_at = ?, updated_at = ? WHERE status = 'open' AND conflict_type = 'duplicate_uuid'`)
      .run(startedAt, startedAt)

    for (const absolutePath of walkFiles(managedRoot)) {
      const { relativeManagedPath, vaultRelativePath, entityType, wikiPageType } = mapManagedMetadata(context, managedRoot, absolutePath)
      const info = statSync(absolutePath)
      const ext = extname(absolutePath).toLowerCase()
      const seenKey = normalizePath(vaultRelativePath)
      seen.add(seenKey)
      managedFilesScanned += 1

      const isText = ['.md', '.canvas', '.txt', '.json'].includes(ext)
      const rawContent = isText ? readFileSync(absolutePath, 'utf8') : readFileSync(absolutePath)
      const contentHash = computeHash(rawContent)
      const existing = existingRows.get(seenKey)
      const latestRevision = readLatestRevision(db, seenKey)
      const revisionId = latestRevision?.contentHash === contentHash
        ? latestRevision.id
        : recordRevision(db, {
            vaultRelativePath: seenKey,
            contentHash,
            contentText: typeof rawContent === 'string' ? rawContent : null,
            source: 'vault_scan',
            actor: 'mission-control',
            metadata: { path: seenKey },
          })
      const syncStatus: SyncStatus = existing && existing.contentHash && existing.contentHash !== contentHash
        ? (existing.lastSyncDirection === 'db_to_vault' ? 'vault_modified' : 'synced')
        : 'synced'
      if (existing && existing.contentHash && existing.contentHash !== contentHash) {
        changedFiles += 1
      }

      let uuid: string | null = null
      let metadata: Record<string, unknown> = {}
      if (typeof rawContent === 'string' && ext === '.md') {
        const { frontmatter } = parseFrontmatter(rawContent)
        uuid = typeof frontmatter.uuid === 'string' ? frontmatter.uuid : null
        const refs = extractMarkdownReferenceSummary(rawContent)
        metadata = {
          frontmatter,
          wikiLinkCount: refs.wikiLinks.length,
          embedCount: refs.embeds.length,
          markdownLinkCount: refs.markdownLinks.length,
          tagCount: refs.tags.length,
          taskCount: refs.taskCount,
          calloutCount: refs.calloutCount,
          dataviewFields: refs.dataviewFields,
        }
        replaceAttachmentRefs(db, seenKey, extractAttachmentRefs(absolutePath, rawContent, vaultPath))
      } else if (typeof rawContent === 'string' && ext === '.canvas') {
        const refs = extractCanvasRefs(rawContent).map((ref) => {
          const targetPath = ref.targetPath ? normalizePath(ref.targetPath) : null
          const resolved = targetPath ? resolveReference(dirname(absolutePath), targetPath) : null
          return {
            ...ref,
            canvasPath: seenKey,
            targetPath,
            broken: Boolean(targetPath && resolved && !existsSync(resolved)),
          }
        })
        metadata = { nodeCount: refs.length }
        replaceCanvasRefs(db, seenKey, refs)
      }

      upsertManagedFile(db, {
        uuid,
        vaultRelativePath: seenKey,
        managedRelativePath: normalizePath(relativeManagedPath),
        entityType,
        wikiPageType,
        fileExt: ext || null,
        contentHash,
        lastVaultMtime: info.mtimeMs,
        lastVaultSize: info.size,
        lastDbRevisionId: revisionId,
        lastSyncDirection: 'vault_scan',
        syncStatus,
        conflictState: 'none',
        sourceOrigin: 'managed',
        tombstoned: false,
        metadata,
      })

      if (uuid) {
        const existingPath = uuidToPath.get(uuid)
        if (existingPath && existingPath !== seenKey) {
          openDuplicateUuidConflict(db, uuid, seenKey, existingPath, entityType)
          conflictsOpened += 1
        } else {
          uuidToPath.set(uuid, seenKey)
        }
      }
    }

    const unseenRows = db.prepare(`
      SELECT vault_relative_path AS path
      FROM obsidian_managed_files
      WHERE tombstoned = 0
    `).all() as Array<{ path: string }>
    for (const row of unseenRows) {
      if (seen.has(row.path)) continue
      deletedFiles += 1
      db.prepare(`
        UPDATE obsidian_managed_files
        SET tombstoned = 1, sync_status = 'deleted', updated_at = ?
        WHERE vault_relative_path = ?
      `).run(Date.now(), row.path)
    }

    const externalFiles = walkFiles(vaultPath, (absolutePath) => {
      const normalized = normalizePath(absolutePath)
      const managedPrefix = normalizePath(managedRoot)
      return !normalized.startsWith(managedPrefix) && ['.md', '.canvas'].includes(extname(absolutePath).toLowerCase())
    })
    for (const absolutePath of externalFiles) {
      const rel = normalizePath(relative(vaultPath, absolutePath))
      const content = readFileSync(absolutePath, 'utf8')
      const { frontmatter, body } = parseFrontmatter(content)
      upsertImportCandidate(db, {
        vaultRelativePath: rel,
        title: (typeof frontmatter.title === 'string' && frontmatter.title) || body.split(/\r?\n/, 1)[0]?.replace(/^#+\s*/, '') || absolutePath.split('/').pop() || rel,
        fileUuid: typeof frontmatter.uuid === 'string' ? frontmatter.uuid : null,
        contentHash: computeHash(content),
        lastVaultMtime: statSync(absolutePath).mtimeMs,
        imported: false,
        importedManagedPath: null,
        metadata: {
          origin: 'external',
          ext: extname(absolutePath).toLowerCase(),
          tagCount: extractMarkdownReferenceSummary(content).tags.length,
        },
      })
      importsIndexed += 1
    }

    updateCheckpoint(db, 'obsidian-vault', {
      lastCompletedAt: Date.now(),
      lastStatus: 'ok',
      lastError: null,
      lastScanCount: managedFilesScanned,
      lastChangeCount: changedFiles + deletedFiles + conflictsOpened,
    })
    recordSyncEvent(db, 'vault_scan', {
      status: 'ok',
      direction: 'vault_scan',
      detail: `Scanned ${managedFilesScanned} managed files and indexed ${importsIndexed} external candidates.`,
      metadata: { managedFilesScanned, importsIndexed, conflictsOpened, deletedFiles, changedFiles },
    })
    return {
      configured: true,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFilesScanned,
      importsIndexed,
      conflictsOpened,
      deletedFiles,
      changedFiles,
      scope: 'reconcile',
      checkpointStatus: 'ok',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Obsidian sync error'
    updateCheckpoint(db, 'obsidian-vault', {
      lastCompletedAt: Date.now(),
      lastStatus: 'error',
      lastError: message,
    })
    recordSyncEvent(db, 'vault_scan', { status: 'error', direction: 'vault_scan', detail: message })
    return {
      configured: true,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFilesScanned: 0,
      importsIndexed: 0,
      conflictsOpened: 0,
      deletedFiles: 0,
      changedFiles: 0,
      scope: 'reconcile',
      checkpointStatus: 'error',
      error: message,
    }
  } finally {
    db.close()
  }
}

export function syncObsidianNote(context: KnowledgeBaseContext, vaultRelativePath: string): SyncSummary {
  const { vaultPath, managedRoot } = getVaultPaths(context)
  const normalizedPath = normalizePath(vaultRelativePath)
  if (!vaultPath || !managedRoot || !existsSync(vaultPath) || !existsSync(managedRoot)) {
    return {
      configured: false,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFilesScanned: 0,
      importsIndexed: 0,
      conflictsOpened: 0,
      deletedFiles: 0,
      changedFiles: 0,
      scope: 'sync_note',
      path: normalizedPath,
      checkpointStatus: 'error',
      error: 'Obsidian vault is not configured for this runtime profile.',
    }
  }

  const db = openHermesStateDb(context, true)
  const startedAt = Date.now()
  updateCheckpoint(db, 'obsidian-vault', { lastStartedAt: startedAt, lastStatus: 'running', lastError: null })
  try {
    const absolutePath = join(vaultPath, normalizedPath)
    const existing = readManagedFileRow(db, normalizedPath)
    if (!existsSync(absolutePath)) {
      if (existing) {
        db.prepare(`
          UPDATE obsidian_managed_files
          SET tombstoned = 1, sync_status = 'deleted', updated_at = ?
          WHERE vault_relative_path = ?
        `).run(Date.now(), normalizedPath)
      }
      return {
        configured: true,
        runtimeProfileName: context.runtimeProfile.name,
        vaultPath,
        managedRoot,
        managedFilesScanned: 1,
        importsIndexed: 0,
        conflictsOpened: 0,
        deletedFiles: existing ? 1 : 0,
        changedFiles: existing ? 1 : 0,
        scope: 'sync_note',
        path: normalizedPath,
        checkpointStatus: 'ok',
      }
    }

    const ext = extname(absolutePath).toLowerCase()
    const rawContent = ['.md', '.canvas', '.txt', '.json'].includes(ext)
      ? readFileSync(absolutePath, 'utf8')
      : readFileSync(absolutePath)
    const currentHash = computeHash(rawContent)
    const openConflictId = hasOpenConflict(db, normalizedPath)
    const latestRevision = readLatestRevision(db, normalizedPath)
    let conflictsOpened = 0
    let changedFiles = existing?.contentHash && existing.contentHash !== currentHash ? 1 : 0

    if (!openConflictId) {
      const revisionId = latestRevision?.contentHash === currentHash
        ? latestRevision.id
        : recordRevision(db, {
            vaultRelativePath: normalizedPath,
            contentHash: currentHash,
            contentText: typeof rawContent === 'string' ? rawContent : null,
            source: 'vault_to_db',
            actor: 'obsidian-sync',
            metadata: { path: normalizedPath },
          })
      const { uuid, entityType } = indexManagedFileContent(db, context, absolutePath, rawContent, {
        existing,
        lastSyncDirection: 'vault_to_db',
        syncStatus: 'synced',
        conflictState: 'none',
        lastDbRevisionId: revisionId,
      })
      if (uuid) {
        const duplicate = db.prepare(`
          SELECT vault_relative_path AS path
          FROM obsidian_managed_files
          WHERE uuid = ? AND vault_relative_path != ? AND tombstoned = 0
          LIMIT 1
        `).get(uuid, normalizedPath) as { path: string } | undefined
        if (duplicate) {
          openDuplicateUuidConflict(db, uuid, normalizedPath, duplicate.path, entityType)
          conflictsOpened = 1
        }
      }
      recordSyncEvent(db, 'sync_note', {
        path: normalizedPath,
        direction: 'vault_to_db',
        status: 'ok',
        detail: `Reconciled ${normalizedPath}`,
      })
    } else {
      db.prepare(`
        UPDATE obsidian_managed_files
        SET sync_status = 'conflict', conflict_state = 'open', updated_at = ?
        WHERE vault_relative_path = ?
      `).run(Date.now(), normalizedPath)
      recordSyncEvent(db, 'sync_note', {
        path: normalizedPath,
        direction: 'vault_to_db',
        status: 'warning',
        detail: `Skipped automatic reconciliation for ${normalizedPath} because a conflict is already open.`,
      })
      changedFiles = 1
    }

    updateCheckpoint(db, 'obsidian-vault', {
      lastCompletedAt: Date.now(),
      lastStatus: 'ok',
      lastError: null,
      lastScanCount: 1,
      lastChangeCount: changedFiles + conflictsOpened,
    })
    return {
      configured: true,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFilesScanned: 1,
      importsIndexed: 0,
      conflictsOpened,
      deletedFiles: 0,
      changedFiles,
      scope: 'sync_note',
      path: normalizedPath,
      checkpointStatus: 'ok',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Obsidian sync error'
    updateCheckpoint(db, 'obsidian-vault', {
      lastCompletedAt: Date.now(),
      lastStatus: 'error',
      lastError: message,
    })
    recordSyncEvent(db, 'sync_note', { status: 'error', direction: 'vault_to_db', detail: message, path: normalizedPath })
    return {
      configured: true,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFilesScanned: 0,
      importsIndexed: 0,
      conflictsOpened: 0,
      deletedFiles: 0,
      changedFiles: 0,
      scope: 'sync_note',
      path: normalizedPath,
      checkpointStatus: 'error',
      error: message,
    }
  } finally {
    db.close()
  }
}

export function getObsidianStatus(context: KnowledgeBaseContext, options?: { refresh?: boolean; path?: string | null }): ObsidianStatusPayload {
  if (options?.refresh) {
    syncObsidianVault(context)
  }
  const { vaultPath, managedRoot } = getVaultPaths(context)
  if (!vaultPath || !managedRoot || !existsSync(vaultPath) || !existsSync(managedRoot)) {
    return {
      configured: false,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFolders: [...OBSIDIAN_MANAGED_FOLDERS],
      watcher: null,
      lastCheckpoint: null,
      pluginConnection: null,
      syncHealth: {
        managedFiles: 0,
        vaultModified: 0,
        pendingConflicts: 0,
        importCandidates: 0,
        attachmentRefs: 0,
        brokenAttachmentRefs: 0,
        canvasRefs: 0,
        brokenCanvasRefs: 0,
      },
      activeNote: options?.path ? {
        path: normalizePath(options.path),
        managed: false,
        importCandidate: false,
        sourceOrigin: 'external',
        managedPath: null,
        syncStatus: null,
        conflictState: null,
        conflictId: null,
        conflictSummary: null,
        reviewPath: null,
        lastSyncedAt: null,
        lastVaultModifiedAt: null,
        importedFrom: null,
        governance: null,
        recommendedActions: ['import_note', 'open_mission_control'],
      } : null,
      recentEvents: [],
    }
  }
  const db = openHermesStateDb(context)
  try {
    const watcherCheckpoint = db.prepare(`
      SELECT scope, last_started_at AS lastStartedAt, last_completed_at AS lastCompletedAt, last_status AS lastStatus,
        last_error AS lastError, last_scan_count AS lastScanCount, last_change_count AS lastChangeCount
      FROM obsidian_sync_checkpoints WHERE scope = 'obsidian-watcher'
    `).get() as any
    const checkpoint = db.prepare(`
      SELECT scope, last_started_at AS lastStartedAt, last_completed_at AS lastCompletedAt, last_status AS lastStatus,
        last_error AS lastError, last_scan_count AS lastScanCount, last_change_count AS lastChangeCount
      FROM obsidian_sync_checkpoints WHERE scope = 'obsidian-vault'
    `).get() as any
    const plugin = db.prepare(`
      SELECT id, client_id AS clientId, client_name AS clientName, client_version AS clientVersion, vault_name AS vaultName,
        status, last_seen_at AS lastSeenAt, connected_at AS connectedAt, disconnected_at AS disconnectedAt, metadata_json AS metadataJson
      FROM obsidian_plugin_connections
      ORDER BY last_seen_at DESC LIMIT 1
    `).get() as any
    const count = (query: string, ...params: any[]) => Number((db.prepare(query).get(...params) as any)?.count || 0)
    const recentEvents = db.prepare(`
      SELECT id, event_type AS eventType, path, direction, status, detail, created_at AS createdAt
      FROM obsidian_sync_events
      ORDER BY created_at DESC
      LIMIT 8
    `).all() as Array<{ id: number; eventType: string; path: string | null; direction: string | null; status: string; detail: string | null; createdAt: number }>
    return {
      configured: true,
      runtimeProfileName: context.runtimeProfile.name,
      vaultPath,
      managedRoot,
      managedFolders: [...OBSIDIAN_MANAGED_FOLDERS],
      watcher: watcherCheckpoint ? {
        status: watcherCheckpoint.lastStatus ?? null,
        lastStartedAt: watcherCheckpoint.lastStartedAt ?? null,
        lastCompletedAt: watcherCheckpoint.lastCompletedAt ?? null,
        lastError: watcherCheckpoint.lastError ?? null,
        lastScanCount: watcherCheckpoint.lastScanCount || 0,
        lastChangeCount: watcherCheckpoint.lastChangeCount || 0,
      } : null,
      lastCheckpoint: checkpoint ? {
        scope: checkpoint.scope,
        status: checkpoint.lastStatus ?? null,
        lastStartedAt: checkpoint.lastStartedAt ?? null,
        lastCompletedAt: checkpoint.lastCompletedAt ?? null,
        lastScanCount: checkpoint.lastScanCount || 0,
        lastChangeCount: checkpoint.lastChangeCount || 0,
        lastError: checkpoint.lastError ?? null,
      } : null,
      pluginConnection: plugin ? {
        id: plugin.id,
        clientId: plugin.clientId,
        clientName: plugin.clientName,
        clientVersion: plugin.clientVersion ?? null,
        vaultName: plugin.vaultName ?? null,
        status: plugin.status,
        lastSeenAt: plugin.lastSeenAt,
        connectedAt: plugin.connectedAt ?? null,
        disconnectedAt: plugin.disconnectedAt ?? null,
        metadata: plugin.metadataJson ? JSON.parse(plugin.metadataJson) : {},
      } : null,
      syncHealth: {
        managedFiles: count(`SELECT COUNT(*) AS count FROM obsidian_managed_files WHERE tombstoned = 0`),
        vaultModified: count(`SELECT COUNT(*) AS count FROM obsidian_managed_files WHERE sync_status = 'vault_modified' AND tombstoned = 0`),
        pendingConflicts: count(`SELECT COUNT(*) AS count FROM obsidian_conflicts WHERE status = 'open'`),
        importCandidates: count(`SELECT COUNT(*) AS count FROM obsidian_import_candidates WHERE imported = 0`),
        attachmentRefs: count(`SELECT COUNT(*) AS count FROM obsidian_attachment_index`),
        brokenAttachmentRefs: count(`SELECT COUNT(*) AS count FROM obsidian_attachment_index WHERE exists_flag = 0`),
        canvasRefs: count(`SELECT COUNT(*) AS count FROM obsidian_canvas_index`),
        brokenCanvasRefs: count(`SELECT COUNT(*) AS count FROM obsidian_canvas_index WHERE broken = 1`),
      },
      activeNote: options?.path ? getObsidianActiveNoteStatus(db, context, options.path) : null,
      recentEvents,
    }
  } finally {
    db.close()
  }
}

export function listObsidianConflicts(context: KnowledgeBaseContext, options?: { refresh?: boolean }) {
  if (options?.refresh) syncObsidianVault(context)
  const db = openHermesStateDb(context)
  try {
    return db.prepare(`
      SELECT
        id,
        vault_relative_path AS vaultRelativePath,
        uuid,
        entity_type AS entityType,
        conflict_type AS conflictType,
        status,
        summary,
        db_snapshot AS dbSnapshot,
        vault_snapshot AS vaultSnapshot,
        resolution,
        review_path AS reviewPath,
        created_at AS createdAt,
        updated_at AS updatedAt,
        resolved_at AS resolvedAt
      FROM obsidian_conflicts
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 100
    `).all() as ObsidianConflictRecord[]
  } finally {
    db.close()
  }
}

export function listObsidianImportCandidates(context: KnowledgeBaseContext, options?: { refresh?: boolean }) {
  if (options?.refresh) syncObsidianVault(context)
  const db = openHermesStateDb(context)
  try {
    return db.prepare(`
      SELECT
        id,
        vault_relative_path AS vaultRelativePath,
        title,
        file_uuid AS fileUuid,
        content_hash AS contentHash,
        last_vault_mtime AS lastVaultMtime,
        imported,
        imported_managed_path AS importedManagedPath,
        metadata_json AS metadataJson,
        updated_at AS updatedAt
      FROM obsidian_import_candidates
      ORDER BY imported ASC, updated_at DESC
      LIMIT 200
    `).all().map((row: any) => ({
      ...row,
      imported: Boolean(row.imported),
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {},
    })) as ObsidianImportCandidate[]
  } finally {
    db.close()
  }
}

export function updateObsidianPluginConnection(
  context: KnowledgeBaseContext,
  input: {
    clientId: string
    clientName: string
    clientVersion?: string | null
    vaultName?: string | null
    status: 'connected' | 'disconnected'
    metadata?: Record<string, unknown>
  },
) {
  const db = openHermesStateDb(context, true)
  try {
    const now = Date.now()
    db.prepare(`
      INSERT INTO obsidian_plugin_connections (
        client_id, client_name, client_version, vault_name, status, metadata_json, connected_at, disconnected_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        client_name = excluded.client_name,
        client_version = excluded.client_version,
        vault_name = excluded.vault_name,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        connected_at = CASE WHEN excluded.status = 'connected' THEN excluded.connected_at ELSE obsidian_plugin_connections.connected_at END,
        disconnected_at = CASE WHEN excluded.status = 'disconnected' THEN excluded.disconnected_at ELSE obsidian_plugin_connections.disconnected_at END,
        last_seen_at = excluded.last_seen_at
    `).run(
      input.clientId,
      input.clientName,
      input.clientVersion ?? null,
      input.vaultName ?? null,
      input.status,
      JSON.stringify(input.metadata || {}),
      input.status === 'connected' ? now : null,
      input.status === 'disconnected' ? now : null,
      now,
    )
    recordSyncEvent(db, 'plugin_connection', {
      status: input.status,
      detail: `${input.clientName} ${input.status}`,
      metadata: { clientId: input.clientId, clientVersion: input.clientVersion ?? null },
    })
  } finally {
    db.close()
  }
}

export function resolveObsidianConflict(
  context: KnowledgeBaseContext,
  conflictId: number,
  resolution: 'keep_db' | 'keep_vault' | 'merged',
  actor: string,
) {
  const db = openHermesStateDb(context, true)
  try {
    const conflict = db.prepare(`
      SELECT id, vault_relative_path AS vaultRelativePath, db_snapshot AS dbSnapshot, vault_snapshot AS vaultSnapshot
      FROM obsidian_conflicts
      WHERE id = ?
    `).get(conflictId) as { id: number; vaultRelativePath: string; dbSnapshot: string | null; vaultSnapshot: string | null } | undefined
    if (!conflict) throw new Error('Conflict not found')
    const now = Date.now()
    const { absolutePath } = parseManagedVaultPath(context, conflict.vaultRelativePath)
    let reviewPath: string | null = null
    let revisionId: number | null = null
    let appliedHash: string | null = null

    if (resolution === 'keep_db') {
      const appliedContent = conflict.dbSnapshot ?? ''
      writeManagedFileContent(absolutePath, appliedContent)
      appliedHash = computeHash(appliedContent)
      revisionId = recordRevision(db, {
        vaultRelativePath: conflict.vaultRelativePath,
        contentHash: appliedHash,
        contentText: appliedContent,
        source: 'conflict_keep_db',
        actor,
        metadata: { conflictId },
      })
      indexManagedFileContent(db, context, absolutePath, appliedContent, {
        lastSyncDirection: 'db_to_vault',
        syncStatus: 'synced',
        conflictState: 'resolved',
        lastDbRevisionId: revisionId,
      })
    } else if (resolution === 'keep_vault') {
      const appliedContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : (conflict.vaultSnapshot ?? '')
      appliedHash = computeHash(appliedContent)
      revisionId = recordRevision(db, {
        vaultRelativePath: conflict.vaultRelativePath,
        contentHash: appliedHash,
        contentText: appliedContent,
        source: 'conflict_keep_vault',
        actor,
        metadata: { conflictId },
      })
      indexManagedFileContent(db, context, absolutePath, appliedContent, {
        lastSyncDirection: 'vault_to_db',
        syncStatus: 'synced',
        conflictState: 'resolved',
        lastDbRevisionId: revisionId,
      })
    } else {
      reviewPath = nextMergeReviewPath(conflict.vaultRelativePath)
      const { absolutePath: reviewAbsolutePath } = parseManagedVaultPath(context, reviewPath)
      const mergeCandidate = [
        '---',
        `conflict_id: ${conflictId}`,
        `source_note: "${conflict.vaultRelativePath}"`,
        'review_status: "merge_review_required"',
        '---',
        '',
        '# Merge Review',
        '',
        '## Canonical DB Snapshot',
        '',
        conflict.dbSnapshot ?? '',
        '',
        '## Current Vault Snapshot',
        '',
        conflict.vaultSnapshot ?? '',
        '',
      ].join('\n')
      writeManagedFileContent(reviewAbsolutePath, mergeCandidate)
      const reviewHash = computeHash(mergeCandidate)
      const reviewRevisionId = recordRevision(db, {
        vaultRelativePath: reviewPath,
        contentHash: reviewHash,
        contentText: mergeCandidate,
        source: 'conflict_merge_candidate',
        actor,
        metadata: { conflictId, sourcePath: conflict.vaultRelativePath },
      })
      indexManagedFileContent(db, context, reviewAbsolutePath, mergeCandidate, {
        lastSyncDirection: 'db_to_vault',
        syncStatus: 'synced',
        conflictState: 'none',
        lastDbRevisionId: reviewRevisionId,
      })
      const retainedContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : (conflict.vaultSnapshot ?? '')
      appliedHash = computeHash(retainedContent)
      revisionId = recordRevision(db, {
        vaultRelativePath: conflict.vaultRelativePath,
        contentHash: appliedHash,
        contentText: retainedContent,
        source: 'conflict_merge_retained_vault',
        actor,
        metadata: { conflictId, reviewPath },
      })
      indexManagedFileContent(db, context, absolutePath, retainedContent, {
        lastSyncDirection: 'vault_to_db',
        syncStatus: 'synced',
        conflictState: 'resolved',
        lastDbRevisionId: revisionId,
      })
    }
    db.prepare(`
      UPDATE obsidian_conflicts
      SET status = 'resolved', resolution = ?, review_path = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(resolution, reviewPath, now, now, conflictId)
    recordSyncEvent(db, 'conflict_resolved', {
      path: conflict.vaultRelativePath,
      status: 'ok',
      detail: `${actor} resolved conflict via ${resolution}`,
      metadata: { conflictId, resolution, actor, reviewPath, revisionId, appliedHash },
    })
    return { reviewPath, revisionId }
  } finally {
    db.close()
  }
}

export function importObsidianCandidate(
  context: KnowledgeBaseContext,
  candidatePath: string,
  targetFolder: Extract<ManagedFolder, 'Notes' | 'Research'> = 'Notes',
) {
  const { vaultPath, managedRoot } = getVaultPaths(context)
  if (!vaultPath || !managedRoot) throw new Error('Obsidian vault is not configured')
  const sourcePath = join(vaultPath, normalizePath(candidatePath))
  if (!existsSync(sourcePath)) throw new Error('Import candidate file not found')
  const targetDir = join(managedRoot, targetFolder)
  mkdirSync(targetDir, { recursive: true })

  const extension = extname(sourcePath) || '.md'
  const baseName = sanitizeFileName(sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Imported Note')
  let targetPath = join(targetDir, `${baseName}${extension}`)
  let suffix = 1
  while (existsSync(targetPath)) {
    suffix += 1
    targetPath = join(targetDir, `${baseName}-${suffix}${extension}`)
  }

  if (extension.toLowerCase() === '.md') {
    const content = readFileSync(sourcePath, 'utf8')
    const parsed = parseFrontmatter(content)
    const nextFrontmatter = {
      ...parsed.frontmatter,
      uuid: typeof parsed.frontmatter.uuid === 'string' ? parsed.frontmatter.uuid : randomUUID(),
      imported_from: normalizePath(candidatePath),
      created_by: 'mission-control',
      governance_status: 'unreviewed',
    }
    writeFileSync(targetPath, serializeFrontmatter(nextFrontmatter, parsed.body, parsed.orderedKeys), 'utf8')
  } else {
    copyFileSync(sourcePath, targetPath)
  }

  const db = openHermesStateDb(context, true)
  try {
    const importedVaultPath = normalizePath(relative(vaultPath, targetPath))
    const importedContent = extension.toLowerCase() === '.md' ? readFileSync(targetPath, 'utf8') : null
    const importedHash = importedContent ? computeHash(importedContent) : computeHash(readFileSync(targetPath))
    const revisionId = recordRevision(db, {
      vaultRelativePath: importedVaultPath,
      contentHash: importedHash,
      contentText: importedContent,
      source: 'external_import',
      actor: 'mission-control',
      metadata: { importedFrom: normalizePath(candidatePath) },
    })
    if (importedContent) {
      indexManagedFileContent(db, context, targetPath, importedContent, {
        sourceOrigin: 'external_import',
        lastSyncDirection: 'import',
        syncStatus: 'synced',
        conflictState: 'none',
        lastDbRevisionId: revisionId,
      })
    }
    db.prepare(`
      UPDATE obsidian_import_candidates
      SET imported = 1, imported_managed_path = ?, updated_at = ?
      WHERE vault_relative_path = ?
    `).run(importedVaultPath, Date.now(), normalizePath(candidatePath))
    recordSyncEvent(db, 'import_candidate', {
      path: normalizePath(candidatePath),
      status: 'ok',
      direction: 'import',
      detail: `Imported into ${normalizePath(relative(vaultPath, targetPath))}`,
    })
  } finally {
    db.close()
  }

  return {
    importedManagedPath: normalizePath(relative(vaultPath, targetPath)),
    sync: syncObsidianVault(context),
  }
}

function mapRequestedPathToVaultRelative(
  context: KnowledgeBaseContext,
  path: string,
  scope: KnowledgeBaseScope,
): string | null {
  const normalized = normalizePath(path)
  if (scope === 'structured') return normalized
  const { managedRoot } = getVaultPaths(context)
  if (!managedRoot) return null
  return normalizePath(join(context.agentPrefix, 'Wiki', normalized))
}

export function checkObsidianWriteConflict(args: {
  context: KnowledgeBaseContext
  path: string
  content: string
  actor: string
  expectedContentHash?: string | null
}) {
  const vaultRelativePath = mapRequestedPathToVaultRelative(args.context, args.path, 'wiki')
  if (!vaultRelativePath || !args.expectedContentHash) {
    return { conflict: false as const, vaultRelativePath }
  }
  const { absolutePath } = parseManagedVaultPath(args.context, vaultRelativePath)
  if (!existsSync(absolutePath)) {
    return { conflict: false as const, vaultRelativePath }
  }
  const liveContent = readFileSync(absolutePath, 'utf8')
  const liveHash = computeHash(liveContent)
  if (liveHash === args.expectedContentHash) {
    return { conflict: false as const, vaultRelativePath }
  }
  const db = openHermesStateDb(args.context, true)
  try {
    recordContentConflict(db, args.context, vaultRelativePath, args.content, args.actor)
  } finally {
    db.close()
  }
  return { conflict: true as const, vaultRelativePath, liveHash }
}

export function recordKnowledgeBaseObsidianWrite(args: {
  context: KnowledgeBaseContext
  path: string
  content: string
  actor: string
}) {
  const vaultRelativePath = mapRequestedPathToVaultRelative(args.context, args.path, 'wiki')
  if (!vaultRelativePath) return null
  const { absolutePath } = parseManagedVaultPath(args.context, vaultRelativePath)
  const db = openHermesStateDb(args.context, true)
  try {
    const contentHash = computeHash(args.content)
    const revisionId = recordRevision(db, {
      vaultRelativePath,
      contentHash,
      contentText: args.content,
      source: 'db_to_vault',
      actor: args.actor,
      metadata: { path: args.path },
    })
    indexManagedFileContent(db, args.context, absolutePath, args.content, {
      lastSyncDirection: 'db_to_vault',
      syncStatus: 'synced',
      conflictState: 'none',
      lastDbRevisionId: revisionId,
    })
    recordSyncEvent(db, 'db_write', {
      path: vaultRelativePath,
      direction: 'db_to_vault',
      status: 'ok',
      detail: `${args.actor} updated ${vaultRelativePath}`,
    })
    return { vaultRelativePath, contentHash, revisionId }
  } finally {
    db.close()
  }
}

export function getObsidianContentMetadata(
  context: KnowledgeBaseContext,
  path: string,
  scope: KnowledgeBaseScope,
): ObsidianContentMetadata {
  const vaultRelativePath = mapRequestedPathToVaultRelative(context, path, scope)
  if (!vaultRelativePath) {
    return {
      vaultBacked: false,
      vaultRelativePath: null,
      managedRelativePath: null,
      syncStatus: null,
      conflictState: null,
      fileUuid: null,
      contentHash: null,
      lastDbRevisionId: null,
      sourceOrigin: 'external',
      attachmentRefs: [],
      canvasRefs: [],
    }
  }
  const db = openHermesStateDb(context)
  try {
    const row = readManagedFileRow(db, vaultRelativePath)
    if (!row) {
      return {
        vaultBacked: context.structuredVaultPath !== null,
        vaultRelativePath,
        managedRelativePath: null,
        syncStatus: null,
        conflictState: null,
        fileUuid: null,
        contentHash: null,
        lastDbRevisionId: null,
        sourceOrigin: 'external',
        attachmentRefs: [],
        canvasRefs: [],
      }
    }
    const attachmentRefs = db.prepare(`
      SELECT owner_path AS ownerPath, target_path AS targetPath, target_type AS targetType, exists_flag AS existsFlag, mime_type AS mimeType
      FROM obsidian_attachment_index WHERE owner_path = ? ORDER BY target_path ASC
    `).all(vaultRelativePath).map((attachment: any) => ({
      ownerPath: attachment.ownerPath,
      targetPath: attachment.targetPath,
      targetType: attachment.targetType,
      exists: Boolean(attachment.existsFlag),
      mimeType: attachment.mimeType ?? null,
    })) as ObsidianAttachmentRef[]
    const canvasRefs = db.prepare(`
      SELECT canvas_path AS canvasPath, node_id AS nodeId, node_type AS nodeType, target_path AS targetPath, broken, metadata_json AS metadataJson
      FROM obsidian_canvas_index WHERE canvas_path = ? ORDER BY node_id ASC
    `).all(vaultRelativePath).map((canvas: any) => ({
      canvasPath: canvas.canvasPath,
      nodeId: canvas.nodeId,
      nodeType: canvas.nodeType,
      targetPath: canvas.targetPath ?? null,
      broken: Boolean(canvas.broken),
      metadata: canvas.metadataJson ? JSON.parse(canvas.metadataJson) : {},
    })) as ObsidianCanvasRef[]

    return {
      vaultBacked: true,
      vaultRelativePath: row.vaultRelativePath,
      managedRelativePath: row.managedRelativePath,
      syncStatus: row.syncStatus as SyncStatus,
      conflictState: row.conflictState as ConflictStatus,
      fileUuid: row.uuid ?? null,
      contentHash: row.contentHash ?? null,
      lastDbRevisionId: row.lastDbRevisionId ?? null,
      sourceOrigin: row.sourceOrigin as 'managed' | 'external_import',
      attachmentRefs,
      canvasRefs,
    }
  } finally {
    db.close()
  }
}
