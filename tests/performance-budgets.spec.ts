import { expect, test, type Page } from '@playwright/test'
import { missionControlPerformanceBudgets } from '../src/lib/performance-budgets'

const TEST_API_KEY = process.env.API_KEY || 'test-api-key-e2e-12345'
const TEST_PASS = 'testpass1234!'
const TEST_USER = `perf-e2e-${Date.now()}`
const BUDGET_PANEL = 'logs'

declare global {
  interface Window {
    __mcLongTasks?: Array<{ durationMs: number; startedAt: number }>
    __mcNavigationSamples?: Array<{ to: string; durationMs: number; from: string; navigationId: number }>
  }
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/username/i).fill(TEST_USER)
  await page.getByLabel(/password/i).fill(TEST_PASS)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function waitForShellReady(page: Page, panel = 'overview') {
  const root = page.locator(`[data-mc-shell-ready="1"][data-mc-active-panel="${panel}"]`).first()
  const nav = page.locator('[data-mc-nav="ready"]').first()
  const button = page.locator(`[data-panel-id="${panel}"]`).first()
  await expect(page).toHaveURL(panel === 'overview' ? /\/$/ : new RegExp(`/${panel}$`))
  await expect(root).toBeVisible()
  await expect(nav).toBeVisible()
  await expect(button).toBeVisible()
}

async function clearPerfBuffers(page: Page) {
  await page.evaluate(() => {
    window.__mcLongTasks = []
    window.__mcNavigationSamples = []
    performance.clearMarks()
    performance.clearMeasures()
  })
}

async function measurePanelSwitch(page: Page, panel: string) {
  const targetPath = panel === 'overview' ? '/' : `/${panel}`
  const button = page.locator(`[data-panel-id="${panel}"]`).first()
  await expect(button).toBeVisible()
  await clearPerfBuffers(page)
  await button.click()
  await page.waitForFunction((path) => {
    return (window.__mcNavigationSamples || []).some((sample) => sample.to === path)
  }, targetPath)
  await waitForShellReady(page, panel)
  return await page.evaluate((path) => {
    const samples = (window.__mcNavigationSamples || [])
      .filter((sample) => sample.to === path)
      .sort((a, b) => b.navigationId - a.navigationId)
    return {
      sample: samples[0] ?? null,
      longTasks: window.__mcLongTasks || [],
    }
  }, targetPath)
}

test.describe('Mission Control performance budgets', () => {
  test.beforeAll(async ({ request }) => {
    const createRes = await request.post('/api/auth/users', {
      data: {
        username: TEST_USER,
        password: TEST_PASS,
        display_name: 'Performance Budget User',
        role: 'viewer',
      },
      headers: {
        'x-api-key': TEST_API_KEY,
      },
    })

    expect([201, 409]).toContain(createRes.status())
  })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('mc-harness-test-mode', '1')
      window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
      window.__mcLongTasks = []
      window.__mcNavigationSamples = []
      window.addEventListener('mc:long-task', ((event: Event) => {
        window.__mcLongTasks?.push((event as CustomEvent).detail)
      }) as EventListener)
      window.addEventListener('mc:navigation-metric', ((event: Event) => {
        window.__mcNavigationSamples?.push((event as CustomEvent).detail)
      }) as EventListener)
    })
  })

  test('keeps sessions reads within budget', async ({ page, request }) => {
    const sessionsStartedAt = Date.now()
    const sessionsRes = await request.get('/api/sessions', {
      headers: {
        'x-api-key': TEST_API_KEY,
      },
    })
    const sessionsElapsedMs = Date.now() - sessionsStartedAt

    expect(sessionsRes.status()).toBe(200)
    const sessionsBody = await sessionsRes.json()
    expect(sessionsBody.meta).toHaveProperty('indexedAt')
    expect(typeof sessionsBody.meta.stale).toBe('boolean')
    expect(sessionsElapsedMs).toBeLessThanOrEqual(missionControlPerformanceBudgets.sessionsColdReadMs)

    await login(page)
    await page.waitForFunction(() => performance.getEntriesByName('mc:sessions-fetch').length > 0)
    await page.waitForTimeout(1000)
    await page.evaluate(async () => {
      await fetch('/api/sessions')
    })
    await page.evaluate(() => {
      window.__mcLongTasks = []
    })

    const warmBrowserFetch = await page.evaluate(async () => {
      const startedAt = performance.now()
      const response = await fetch('/api/sessions')
      const body = await response.json()
      return {
        ok: response.ok,
        durationMs: performance.now() - startedAt,
        meta: body.meta,
      }
    })
    expect(warmBrowserFetch.ok).toBe(true)
    expect(warmBrowserFetch.meta).toHaveProperty('indexedAt')
    expect(warmBrowserFetch.durationMs).toBeLessThanOrEqual(missionControlPerformanceBudgets.overviewSessionsFetchMs)

    const longTasks = await page.evaluate(() => window.__mcLongTasks || [])
    for (const task of longTasks) {
      expect(task.durationMs).toBeLessThanOrEqual(missionControlPerformanceBudgets.longTaskMs)
    }
  })

  test('keeps lazy panel navigation within budget', async ({ page }) => {
    await login(page)
    await waitForShellReady(page)
    await page.waitForTimeout(200)

    const firstOpen = await measurePanelSwitch(page, BUDGET_PANEL)
    expect(firstOpen.sample).toMatchObject({
      to: '/logs',
    })
    expect(firstOpen.sample?.durationMs ?? Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(missionControlPerformanceBudgets.firstLazyPanelOpenMs)
    for (const task of firstOpen.longTasks) {
      expect(task.durationMs).toBeLessThanOrEqual(missionControlPerformanceBudgets.longTaskMs)
    }

    await measurePanelSwitch(page, 'overview')

    const cachedReopen = await measurePanelSwitch(page, BUDGET_PANEL)
    expect(cachedReopen.sample).toMatchObject({
      to: '/logs',
    })
    expect(cachedReopen.sample?.durationMs ?? Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(missionControlPerformanceBudgets.cachedPanelSwitchMs)
    for (const task of cachedReopen.longTasks) {
      expect(task.durationMs).toBeLessThanOrEqual(missionControlPerformanceBudgets.longTaskMs)
    }
  })
})
