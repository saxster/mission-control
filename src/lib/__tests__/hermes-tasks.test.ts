import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hermesTaskTestState = vi.hoisted(() => ({
  homeDir: '',
}))

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return hermesTaskTestState.homeDir
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

describe('getHermesTasks', () => {
  let tempHomeDir = ''

  beforeEach(() => {
    tempHomeDir = mkdtempSync(path.join(os.tmpdir(), 'mc-hermes-tasks-'))
    hermesTaskTestState.homeDir = tempHomeDir
    vi.resetModules()
  })

  afterEach(() => {
    hermesTaskTestState.homeDir = ''
    rmSync(tempHomeDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('parses object-wrapped Hermes jobs and exposes lifecycle summary data', async () => {
    const cronDir = path.join(tempHomeDir, '.hermes', 'cron')
    mkdirSync(path.join(cronDir, 'output', 'job-error'), { recursive: true })
    mkdirSync(path.join(cronDir, 'output', 'job-silent'), { recursive: true })

    writeFileSync(path.join(cronDir, 'jobs.json'), JSON.stringify({
      jobs: [
        {
          id: 'job-error',
          name: 'Morning brief',
          prompt: 'Generate the morning brief',
          skills: ['daily-market-briefing'],
          schedule_display: '30 3 * * 1-5',
          enabled: true,
          state: 'scheduled',
          next_run_at: '2026-04-07T03:30:00+05:30',
          last_status: 'error',
          last_error: 'provider missing',
          repeat: { completed: 4 },
          created_at: '2026-04-03T09:14:13.980696+05:30',
        },
        {
          id: 'job-silent',
          name: 'Digest',
          prompt: '[SILENT] Scan feeds',
          skill: 'india-news-aggregator',
          schedule: { display: '0 */4 * * *' },
          enabled: true,
          state: 'scheduled',
          last_status: 'success',
          repeat: { completed: 2 },
          created_at: '2026-04-04T21:30:00.000000+05:30',
        },
      ],
    }, null, 2), 'utf-8')

    writeFileSync(
      path.join(cronDir, 'output', 'job-error', '2026-04-06_17-31-05.md'),
      '# Cron Job: Morning brief\n\n## Response\n\nThe provider is still missing.\n',
      'utf-8',
    )
    writeFileSync(
      path.join(cronDir, 'output', 'job-silent', '2026-04-06_20-32-09.md'),
      '# Cron Job: Digest\n\n## Response\n\n[SILENT]\n',
      'utf-8',
    )

    const { getHermesTasks } = await import('@/lib/hermes-tasks')
    const result = getHermesTasks(true)

    expect(result.summary).toEqual({
      total: 2,
      enabled: 2,
      paused: 0,
      failing: 1,
      healthy: 1,
      scheduled: 2,
    })

    expect(result.cronJobs[0]).toMatchObject({
      id: 'job-error',
      name: 'Morning brief',
      schedule: '30 3 * * 1-5',
      lastStatus: 'error',
      lastError: 'provider missing',
      completedRuns: 4,
      skills: ['daily-market-briefing'],
    })
    expect(result.cronJobs[0]?.lastOutput).toContain('The provider is still missing.')
    expect(result.cronJobs[0]?.lastOutputKind).toBe('response')
    expect(result.cronJobs[0]?.lastRunAt).toBe('2026-04-06T17:31:05')

    expect(result.cronJobs[1]).toMatchObject({
      id: 'job-silent',
      schedule: '0 */4 * * *',
      lastStatus: 'success',
      completedRuns: 2,
      skills: ['india-news-aggregator'],
      lastOutput: '[SILENT]',
      lastOutputKind: 'silent',
    })
    expect(result.cronJobs[1]?.lastRunAt).toBe('2026-04-06T20:32:09')
  })

  it('reads cron jobs from an explicitly selected Hermes runtime profile home', async () => {
    const cronDir = path.join(tempHomeDir, '.hermes', 'profiles', 'researcher', 'cron')
    mkdirSync(path.join(cronDir, 'output', 'job-research'), { recursive: true })

    writeFileSync(path.join(cronDir, 'jobs.json'), JSON.stringify({
      jobs: [
        {
          id: 'job-research',
          name: 'Research scan',
          prompt: 'Deep scan earnings calls',
          schedule_display: '0 6 * * 1-5',
          enabled: true,
          state: 'scheduled',
          last_status: 'success',
        },
      ],
    }, null, 2), 'utf-8')

    writeFileSync(
      path.join(cronDir, 'output', 'job-research', '2026-04-07_06-00-00.md'),
      '# Cron Job: Research scan\n\n## Response\n\nResearch profile completed.\n',
      'utf-8',
    )

    const { getHermesTasks } = await import('@/lib/hermes-tasks')
    const result = getHermesTasks(true, [{
      name: 'researcher',
      label: 'researcher',
      description: '',
      hermesHome: path.join(tempHomeDir, '.hermes', 'profiles', 'researcher'),
      envPath: path.join(tempHomeDir, '.hermes', 'profiles', 'researcher', '.env'),
      isDefault: false,
      exists: true,
    }])

    expect(result.summary.total).toBe(1)
    expect(result.cronJobs[0]).toMatchObject({
      id: 'job-research',
      runtimeProfileName: 'researcher',
      runtimeProfileLabel: 'researcher',
      lastOutput: 'Research profile completed.',
    })
  })
})
