import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''
const spawnSyncMock = vi.fn()

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
    dataDir: '/tmp/test-data',
  },
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  default: {
    spawnSync: spawnSyncMock,
  },
  spawnSync: spawnSyncMock,
}))

describe('isHermesGatewayRunning', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({ status: 1, stdout: Buffer.from('') })
    tempHome = mkdtempSync(join(tmpdir(), 'mc-hermes-test-'))
    mkdirSync(join(tempHome, '.hermes'), { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (tempHome) rmSync(tempHome, { recursive: true, force: true })
  })

  it('returns true when gateway.pid is JSON with a live pid field', async () => {
    writeFileSync(join(tempHome, '.hermes', 'gateway.pid'), '{"pid":2522,"kind":"hermes-gateway"}', 'utf8')

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => undefined) as any)
    const { isHermesGatewayRunning } = await import('@/lib/hermes-sessions')

    expect(isHermesGatewayRunning()).toBe(true)
    expect(killSpy).toHaveBeenCalledWith(2522, 0)
  })

  it('returns false when gateway.pid has no valid pid', async () => {
    writeFileSync(join(tempHome, '.hermes', 'gateway.pid'), '{"kind":"hermes-gateway"}', 'utf8')

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => undefined) as any)
    const { isHermesGatewayRunning } = await import('@/lib/hermes-sessions')

    expect(isHermesGatewayRunning()).toBe(false)
    expect(killSpy).not.toHaveBeenCalled()
  })

  it('treats Hermes home state as installed even when the CLI is unavailable', async () => {
    mkdirSync(join(tempHome, '.hermes', 'cron'), { recursive: true })
    writeFileSync(join(tempHome, '.hermes', 'cron', 'jobs.json'), '{"jobs":[]}', 'utf8')

    const { isHermesInstalled } = await import('@/lib/hermes-sessions')

    expect(isHermesInstalled()).toBe(true)
  })

  it('still reports not installed when neither CLI nor Hermes home state exists', async () => {
    rmSync(join(tempHome, '.hermes'), { recursive: true, force: true })

    const { isHermesInstalled } = await import('@/lib/hermes-sessions')

    expect(isHermesInstalled()).toBe(false)
  })
})
