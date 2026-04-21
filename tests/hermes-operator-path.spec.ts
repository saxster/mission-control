import { expect, test, type Page, type APIRequestContext } from '@playwright/test'

const TEST_USER = process.env.AUTH_USER || 'testadmin'
const TEST_PASS = process.env.AUTH_PASS || 'testpass1234!'
const ONBOARDING_SESSION_DISMISSED_KEY = 'mc-onboarding-dismissed'

async function signInAsSeedAdmin(page: Page, request: APIRequestContext) {
  const loginRes = await request.post('/api/auth/login', {
    data: { username: TEST_USER, password: TEST_PASS },
    headers: { 'x-forwarded-for': '10.77.77.77' },
  })

  expect(loginRes.status()).toBe(200)
  const setCookie = loginRes.headers()['set-cookie'] || ''
  const match = setCookie.match(/(?:__Host-)?mc-session=([^;]+)/)
  expect(match).toBeTruthy()

  const baseUrl = test.info().project.use.baseURL || 'http://127.0.0.1:3005'
  await page.context().addCookies([
    {
      name: match?.[0].startsWith('__Host-') ? '__Host-mc-session' : 'mc-session',
      value: match?.[1] || '',
      path: '/',
      domain: new URL(baseUrl).hostname,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

  await page.addInitScript((dismissedKey) => {
    window.sessionStorage.setItem(dismissedKey, '1')
  }, ONBOARDING_SESSION_DISMISSED_KEY)
}

test.describe('Hermes Operator Path', () => {
  test('exposes Hermes fixture state through the task ledger, settings summary, chat workspace, and setup modal', async ({ page, request }) => {
    await signInAsSeedAdmin(page, request)

    const hermesRes = await request.get('/api/hermes')
    expect(hermesRes.status()).toBe(200)
    const hermesBody = await hermesRes.json()
    expect(hermesBody.installed).toBe(true)
    expect(hermesBody.cliAvailable).toBe(false)
    expect(hermesBody.cronJobCount).toBe(3)
    expect(hermesBody.taskSummary?.failing).toBe(1)
    expect(hermesBody.taskSummary?.paused).toBe(1)

    const scopedHermesRes = await request.get('/api/hermes?runtimeProfileName=researcher')
    expect(scopedHermesRes.status()).toBe(200)
    const scopedHermesBody = await scopedHermesRes.json()
    expect(scopedHermesBody.selectedRuntimeProfile?.name).toBe('researcher')
    expect(String(scopedHermesBody.selectedRuntimeProfile?.hermesHome || '')).toContain('/.hermes/profiles/researcher')

    const sessionsRes = await request.get('/api/sessions')
    expect(sessionsRes.status()).toBe(200)
    const sessionsBody = await sessionsRes.json()
    const hermesSession = Array.isArray(sessionsBody?.sessions)
      ? sessionsBody.sessions.find((session: { kind?: string; id?: string }) => session?.kind === 'hermes' && session?.id === 'fixture-hermes-cli-session')
      : null
    expect(hermesSession).toBeTruthy()
    expect(hermesSession?.profile).toBe('primary')

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' })
    const hermesSectionButton = page.getByRole('button', { name: /Hermes Scheduled Tasks/i }).first()
    await expect(hermesSectionButton).toBeVisible()
    await hermesSectionButton.click()
    await expect(page.getByText('Pre-market brief')).toBeVisible()
    await expect(page.getByText('RSS scan')).toBeVisible()
    await expect(page.getByText('Weekly reset')).toBeVisible()
    await expect(page.getByText('Provider auth missing for feed summarizer')).toBeVisible()
    await expect(page.getByText('Paused').first()).toBeVisible()
    await expect(page.getByText('Failing').first()).toBeVisible()
    await expect(page.getByText('Scheduled').first()).toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).first().click()
    await expect(page).toHaveURL(/\/settings$/)

    const hermesSummary = page.getByText('Hermes Agent', { exact: true }).first()
    await expect(hermesSummary).toBeVisible()
    await expect(page.getByText('Hermes home state is present, but this station cannot run the Hermes CLI yet.').first()).toBeVisible()
    await expect(page.getByText('Routing summary').first()).toBeVisible()
    await expect(page.getByText('Primary Hermes profile').first()).toBeVisible()
    await expect(page.getByText('Scheduled automation').first()).toBeVisible()
    await expect(page.getByText('Gateway / API runtime').first()).toBeVisible()
    const automationProfileSelect = page.getByLabel('Scheduled automation profile')
    await expect(automationProfileSelect).toBeVisible()
    await automationProfileSelect.selectOption('automation')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Saved 1 setting').first()).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel('Scheduled automation profile')).toHaveValue('automation')

    await page.goto('/tasks', { waitUntil: 'domcontentloaded' })
    const hermesSection = page.getByRole('button', { name: /Hermes Scheduled Tasks/i }).first()
    await hermesSection.click()
    await expect(page.getByText('Automation').first()).toBeVisible()
    await expect(page.getByText('Profile: Automation Hermes profile').first()).toBeVisible()

    await page.goto('/chat', { waitUntil: 'domcontentloaded' })
    const hermesConversation = page.getByRole('button', { name: /Primary Hermes profile • Fixture planning run/i }).first()
    await expect(hermesConversation).toBeVisible()
    await hermesConversation.click()

    const routeProfileSelect = page.getByLabel('Hermes profile for CLI / local chat')
    await expect(routeProfileSelect).toBeVisible()
    await expect(routeProfileSelect).toHaveValue('primary')
    const saveSettingsResponse = page.waitForResponse((response) =>
      response.url().includes('/api/settings') && response.request().method() === 'PUT'
    )
    await routeProfileSelect.selectOption('research')
    expect((await saveSettingsResponse).status()).toBe(200)
    await expect(routeProfileSelect).toHaveValue('research')
    await expect(page.getByText('Research').first()).toBeVisible()
    await expect(page.getByPlaceholder(/Send prompt to Research Hermes via CLI \/ local chat/i)).toBeVisible()

    await expect.poll(async () => {
      const updatedSessionsRes = await request.get('/api/sessions')
      if (updatedSessionsRes.status() !== 200) return null
      const updatedSessionsBody = await updatedSessionsRes.json()
      const updatedHermesSession = Array.isArray(updatedSessionsBody?.sessions)
        ? updatedSessionsBody.sessions.find((session: { kind?: string; id?: string }) => session?.kind === 'hermes' && session?.id === 'fixture-hermes-cli-session')
        : null
      return updatedHermesSession?.profile || null
    }).toBe('research')

    await page.reload({ waitUntil: 'domcontentloaded' })
    const updatedHermesConversation = page.getByRole('button', { name: /Fixture planning run/i }).first()
    await expect(updatedHermesConversation).toBeVisible()
    await updatedHermesConversation.click()
    await expect(page.getByLabel('Hermes profile for CLI / local chat')).toHaveValue('research')
    await expect(page.getByPlaceholder(/Send prompt to Research Hermes via CLI \/ local chat/i)).toBeVisible()

    const inboundEventRes = await request.post('/api/hermes/events', {
      data: {
        event: 'session:start',
        session_id: 'inbound-telegram-1',
        source: 'telegram',
        timestamp: '2026-04-07T12:00:00.000Z',
      },
    })
    expect(inboundEventRes.status()).toBe(201)

    await page.goto('/activity', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Started Primary session from Telegram inbox').first()).toBeVisible()
    const inboundRouteProfileSelect = page.getByLabel('Hermes route profile for Telegram inbox').first()
    await expect(inboundRouteProfileSelect).toHaveValue('primary')
    const inboundSaveResponse = page.waitForResponse((response) =>
      response.url().includes('/api/settings') && response.request().method() === 'PUT'
    )
    await inboundRouteProfileSelect.selectOption('work')
    expect((await inboundSaveResponse).status()).toBe(200)
    await expect(inboundRouteProfileSelect).toHaveValue('work')

    const settingsRes = await request.get('/api/settings')
    expect(settingsRes.status()).toBe(200)
    const settingsBody = await settingsRes.json()
    const hermesBindingsSetting = Array.isArray(settingsBody?.settings)
      ? settingsBody.settings.find((setting: { key?: string; value?: string }) => setting?.key === 'chat.hermes_source_bindings')
      : null
    expect(String(hermesBindingsSetting?.value || '')).toContain('"telegram": "work"')

    await page.goto('/overview', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Hermes Ready Right Now').first()).toBeVisible()
    await expect(page.getByText('Route bindings').first()).toBeVisible()
    const dashboardRouteProfileSelect = page.getByLabel('Hermes route profile for Scheduled automation').first()
    await expect(dashboardRouteProfileSelect).toBeVisible()
    const dashboardSaveResponse = page.waitForResponse((response) =>
      response.url().includes('/api/settings') && response.request().method() === 'PUT'
    )
    await dashboardRouteProfileSelect.selectOption('research')
    expect((await dashboardSaveResponse).status()).toBe(200)
    await expect(dashboardRouteProfileSelect).toHaveValue('research')
    await expect(page.getByText('Current binding: Research Hermes profile').first()).toBeVisible()

    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Manage runtime profiles').first()).toBeVisible()
    await expect(page.getByText('Default home').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create profile' }).first()).toBeDisabled()
    const configureHermesButton = page.getByRole('button', { name: 'Configure Hermes' }).first()
    await expect(configureHermesButton).toBeVisible()
    await configureHermesButton.click()

    await expect(page.getByRole('heading', { name: 'Set Up Hermes' })).toBeVisible()
    const runtimeProfileSelect = page.getByLabel('Hermes runtime profile', { exact: true })
    await expect(runtimeProfileSelect).toBeVisible()
    await expect(runtimeProfileSelect).toHaveValue('default')
    await runtimeProfileSelect.selectOption('researcher')
    await expect(page.getByText(/Current home: .*\/\.hermes\/profiles\/researcher/i).first()).toBeVisible()
    await expect(page.getByText(/profiles\/researcher\/hooks\/mission-control/i).first()).toBeVisible()
    await expect(page.getByText('cannot run the Hermes CLI yet').first()).toBeVisible()
    await expect(page.getByText('bootstrap, doctor, and runnable Hermes commands').first()).toBeVisible()

    const finalSettingsRes = await request.get('/api/settings')
    expect(finalSettingsRes.status()).toBe(200)
    const finalSettingsBody = await finalSettingsRes.json()
    const finalHermesBindingsSetting = Array.isArray(finalSettingsBody?.settings)
      ? finalSettingsBody.settings.find((setting: { key?: string; value?: string }) => setting?.key === 'chat.hermes_source_bindings')
      : null
    expect(String(finalHermesBindingsSetting?.value || '')).toContain('"cron": "research"')
  })
})
