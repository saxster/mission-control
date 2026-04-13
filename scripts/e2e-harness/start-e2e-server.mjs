#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

async function findAvailablePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to resolve dynamic port')))
        return
      }
      const { port } = address
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

function resolveStandaloneServerPath(repoRoot) {
  const standaloneDir = path.join(repoRoot, '.next', 'standalone')
  const directServerPath = path.join(standaloneDir, 'server.js')
  if (fs.existsSync(directServerPath)) {
    return directServerPath
  }

  const nestedServerPath = path.join(
    standaloneDir,
    repoRoot.replace(/^[/\\]+/, ''),
    'server.js',
  )
  if (fs.existsSync(nestedServerPath)) {
    return nestedServerPath
  }

  return null
}

function prepareStandaloneAssets(repoRoot, standaloneServerPath) {
  if (!standaloneServerPath) return

  const standaloneDir = path.dirname(standaloneServerPath)
  const standaloneNextDir = path.join(standaloneDir, '.next')
  const standaloneStaticDir = path.join(standaloneNextDir, 'static')
  const sourceStaticDir = path.join(repoRoot, '.next', 'static')
  const sourcePublicDir = path.join(repoRoot, 'public')
  const standalonePublicDir = path.join(standaloneDir, 'public')

  fs.mkdirSync(standaloneNextDir, { recursive: true })

  if (fs.existsSync(sourceStaticDir)) {
    fs.rmSync(standaloneStaticDir, { recursive: true, force: true })
    fs.cpSync(sourceStaticDir, standaloneStaticDir, { recursive: true })
  }

  if (fs.existsSync(sourcePublicDir)) {
    fs.rmSync(standalonePublicDir, { recursive: true, force: true })
    fs.cpSync(sourcePublicDir, standalonePublicDir, { recursive: true })
  }
}

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))
const mode = modeArg ? modeArg.split('=')[1] : 'local'
if (mode !== 'local' && mode !== 'gateway') {
  process.stderr.write(`Invalid mode: ${mode}\n`)
  process.exit(1)
}

const repoRoot = process.cwd()
const fixtureSource = path.join(repoRoot, 'tests', 'fixtures', 'runtime-home')
const hermesFixtureSource = path.join(repoRoot, 'tests', 'fixtures', 'hermes-home')
const runtimeRoot = path.join(repoRoot, '.tmp', 'e2e-harness', mode)
const dataDir = path.join(runtimeRoot, 'data')
const mockBinDir = path.join(repoRoot, 'scripts', 'e2e-harness', 'bin')
const skillsRoot = path.join(runtimeRoot, 'skills')

fs.rmSync(runtimeRoot, { recursive: true, force: true })
fs.mkdirSync(runtimeRoot, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
fs.cpSync(fixtureSource, runtimeRoot, { recursive: true })
if (fs.existsSync(hermesFixtureSource)) {
  fs.cpSync(hermesFixtureSource, runtimeRoot, { recursive: true })
}

const gatewayHost = '127.0.0.1'
const gatewayPort = String(await findAvailablePort(gatewayHost))

const baseEnv = {
  ...process.env,
  API_KEY: process.env.API_KEY || 'test-api-key-e2e-12345',
  AUTH_USER: process.env.AUTH_USER || 'admin',
  AUTH_PASS: process.env.AUTH_PASS || 'admin',
  MISSION_CONTROL_TEST_MODE: process.env.MISSION_CONTROL_TEST_MODE || '1',
  MC_DISABLE_RATE_LIMIT: '1',
  MISSION_CONTROL_DATA_DIR: dataDir,
  MISSION_CONTROL_DB_PATH: path.join(dataDir, 'mission-control.db'),
  MISSION_CONTROL_HOME_DIR: runtimeRoot,
  OPENCLAW_STATE_DIR: runtimeRoot,
  OPENCLAW_CONFIG_PATH: path.join(runtimeRoot, 'openclaw.json'),
  OPENCLAW_GATEWAY_HOST: gatewayHost,
  OPENCLAW_GATEWAY_PORT: gatewayPort,
  OPENCLAW_BIN: path.join(mockBinDir, 'openclaw'),
  CLAWDBOT_BIN: path.join(mockBinDir, 'clawdbot'),
  MC_SKILLS_USER_AGENTS_DIR: path.join(skillsRoot, 'user-agents'),
  MC_SKILLS_USER_CODEX_DIR: path.join(skillsRoot, 'user-codex'),
  MC_SKILLS_PROJECT_AGENTS_DIR: path.join(skillsRoot, 'project-agents'),
  MC_SKILLS_PROJECT_CODEX_DIR: path.join(skillsRoot, 'project-codex'),
  MC_SKILLS_OPENCLAW_DIR: path.join(skillsRoot, 'openclaw'),
  PATH: `${mockBinDir}:${process.env.PATH || ''}`,
  E2E_GATEWAY_EXPECTED: mode === 'gateway' ? '1' : '0',
  HOSTNAME: '127.0.0.1',
  PORT: '3005',
}

const children = []
let app = null

if (mode === 'gateway') {
  const gw = spawn('node', ['scripts/e2e-harness/mock-gateway.mjs'], {
    cwd: repoRoot,
    env: baseEnv,
    stdio: 'inherit',
  })
  gw.on('error', (err) => {
    process.stderr.write(`[mission-control-e2e] mock gateway failed to start: ${String(err)}\n`)
    shutdown('SIGTERM')
    process.exit(1)
  })
  gw.on('exit', (code, signal) => {
    const exitCode = code ?? (signal ? 1 : 0)
    if (exitCode !== 0) {
      process.stderr.write(`[mission-control-e2e] mock gateway exited unexpectedly (code=${exitCode}, signal=${signal ?? 'none'})\n`)
      shutdown('SIGTERM')
      process.exit(exitCode)
    }
  })
  children.push(gw)
}

const disableStandalone = process.env.MC_E2E_DISABLE_STANDALONE === '1'
const standaloneServerPath = disableStandalone ? null : resolveStandaloneServerPath(repoRoot)
if (standaloneServerPath) {
  prepareStandaloneAssets(repoRoot, standaloneServerPath)
}
app = standaloneServerPath
  ? spawn('pnpm', ['start:standalone'], {
      cwd: repoRoot,
      env: baseEnv,
      stdio: 'inherit',
    })
  : spawn('pnpm', ['start'], {
      cwd: repoRoot,
      env: baseEnv,
      stdio: 'inherit',
    })
children.push(app)

function shutdown(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill(signal)
      } catch {
        // noop
      }
    }
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
  process.exit(130)
})
process.on('SIGTERM', () => {
  shutdown('SIGTERM')
  process.exit(143)
})

app.on('exit', (code) => {
  shutdown('SIGTERM')
  process.exit(code ?? 0)
})
