#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const fixtureRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname))
const hermesHome = path.join(fixtureRoot, '.hermes')
const dbPath = path.join(hermesHome, 'state.db')

fs.mkdirSync(hermesHome, { recursive: true })
fs.rmSync(dbPath, { force: true })

const db = new Database(dbPath)

db.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT,
    user_id TEXT,
    model TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    message_count INTEGER,
    tool_call_count INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    title TEXT
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp INTEGER NOT NULL
  );
`)

const sessionId = 'fixture-hermes-cli-session'
const startedAt = 1_742_990_400
const assistantAt = startedAt + 42

const insertSession = db.prepare(`
  INSERT INTO sessions (
    id, source, user_id, model, started_at, ended_at,
    message_count, tool_call_count, input_tokens, output_tokens, title
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertMessage = db.prepare(`
  INSERT INTO messages (
    session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`)

insertSession.run(
  sessionId,
  'cli',
  'fixture-user',
  'gpt-5',
  startedAt,
  null,
  2,
  0,
  1280,
  640,
  'Fixture planning run',
)

insertMessage.run(
  sessionId,
  'user',
  'Draft tomorrow morning market priorities.',
  null,
  null,
  null,
  startedAt,
)

insertMessage.run(
  sessionId,
  'assistant',
  'I can help organize that into a concise morning brief.',
  null,
  null,
  null,
  assistantAt,
)

db.close()
console.log(`Generated fixture Hermes state DB at ${dbPath}`)
