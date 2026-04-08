import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60
const SCRYPT_COST = 65536
const SCRYPT_MAXMEM = 128 * SCRYPT_COST * 8 * 2
const PASSWORD_SALT_LENGTH = 16
const PASSWORD_KEY_LENGTH = 32

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:3000',
    output: '',
    dbPath: process.env.MISSION_CONTROL_DB_PATH || '',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base-url' && argv[i + 1]) {
      args.baseUrl = argv[i + 1]
      i += 1
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[i + 1]
      i += 1
    } else if (arg === '--db-path' && argv[i + 1]) {
      args.dbPath = argv[i + 1]
      i += 1
    } else if (arg === '--help') {
      console.log('Usage: node scripts/create-playwright-auth-state.mjs [--base-url <url>] [--output <file>] [--db-path <file>]')
      process.exit(0)
    }
  }

  return args
}

function resolvePaths(args) {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const defaultDataDir = process.env.MISSION_CONTROL_DATA_DIR || path.join(repoRoot, '.data')
  const dbPath = args.dbPath || path.join(defaultDataDir, 'mission-control.db')
  const outputPath = args.output || path.join(repoRoot, 'output', 'playwright', 'mission-control-auth-state.json')
  return { repoRoot, dbPath, outputPath }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function getDefaultWorkspace(db) {
  const row = db.prepare(`
    SELECT id, tenant_id
    FROM workspaces
    ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get()
  return {
    workspaceId: row?.id || 1,
    tenantId: row?.tenant_id || 1,
  }
}

function getApprovedUser(db) {
  return db.prepare(`
    SELECT id, username, role, workspace_id
    FROM users
    WHERE COALESCE(is_approved, 1) = 1
    ORDER BY
      CASE role
        WHEN 'admin' THEN 0
        WHEN 'operator' THEN 1
        ELSE 2
      END,
      id ASC
    LIMIT 1
  `).get()
}

function hashPassword(password) {
  const salt = randomBytes(PASSWORD_SALT_LENGTH).toString('hex')
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH, { N: SCRYPT_COST, maxmem: SCRYPT_MAXMEM }).toString('hex')
  return `${salt}:${hash}`
}

function ensureQaUser(db) {
  const existing = getApprovedUser(db)
  if (existing) return { user: existing, seeded: false }

  const defaultWorkspace = getDefaultWorkspace(db)
  const now = Math.floor(Date.now() / 1000)
  const password = randomBytes(24).toString('hex')
  const result = db.prepare(`
    INSERT INTO users (
      username,
      display_name,
      password_hash,
      role,
      provider,
      email,
      avatar_url,
      is_approved,
      approved_by,
      approved_at,
      workspace_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'playwright-dev',
    'Playwright Dev',
    hashPassword(password),
    'admin',
    'local',
    null,
    null,
    1,
    'playwright-dev-helper',
    now,
    defaultWorkspace.workspaceId,
    now,
    now,
  )

  return {
    user: {
      id: Number(result.lastInsertRowid),
      username: 'playwright-dev',
      role: 'admin',
      workspace_id: defaultWorkspace.workspaceId,
    },
    seeded: true,
  }
}

function createSession(db, user) {
  const defaultWorkspace = getDefaultWorkspace(db)
  const workspaceId = user.workspace_id || defaultWorkspace.workspaceId
  const tenantRow = db.prepare('SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1').get(workspaceId)
  const tenantId = tenantRow?.tenant_id || defaultWorkspace.tenantId
  const token = randomBytes(32).toString('hex')
  const tokenHash = sha256(token)
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION_SECONDS

  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    tokenHash,
    user.id,
    expiresAt,
    '127.0.0.1',
    'playwright-dev-helper',
    workspaceId,
    tenantId,
  )

  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id)
  db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(now)

  return { token, expiresAt }
}

function getCookieName(isSecure) {
  return isSecure ? '__Host-mc-session' : 'mc-session'
}

function buildStorageState(baseUrl, token, expiresAt) {
  const url = new URL(baseUrl)
  const secure = url.protocol === 'https:'
  return {
    cookies: [
      {
        name: getCookieName(secure),
        value: token,
        domain: url.hostname,
        path: '/',
        expires: expiresAt,
        httpOnly: true,
        secure,
        sameSite: 'Strict',
      },
    ],
    origins: [],
  }
}

function main() {
  const args = parseArgs(process.argv)
  const { dbPath, outputPath } = resolvePaths(args)

  if (!existsSync(dbPath)) {
    throw new Error(`Mission Control database not found at ${dbPath}`)
  }

  const db = new Database(dbPath)
  try {
    const { user, seeded } = ensureQaUser(db)

    const { token, expiresAt } = createSession(db, user)
    const state = buildStorageState(args.baseUrl, token, expiresAt)

    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(state, null, 2) + '\n', 'utf8')

    console.log(`Created Playwright auth state for ${user.username} (${user.role})`)
    if (seeded) {
      console.log('Seeded local QA admin user: playwright-dev')
    }
    console.log(outputPath)
  } finally {
    db.close()
  }
}

main()
