import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const baseUrl = process.env.MC_QA_BASE_URL || 'http://127.0.0.1:3000'
const storageStatePath = process.env.MC_PLAYWRIGHT_STORAGE_STATE || path.join(repoRoot, 'output', 'playwright', 'mission-control-auth-state.json')
const outputDir = path.join(repoRoot, 'output', 'playwright')
const ONBOARDING_SESSION_DISMISSED_KEY = 'mc-onboarding-dismissed'
const reportPath = path.join(outputDir, 'hermes-qa-report.json')

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function recordCheck(report, name, details = {}) {
  report.checks.push({
    name,
    ...details,
  })
}

async function assertTextIncludes(locator, expectedSnippets, report, name) {
  const rawText = await locator.textContent().catch(() => '')
  const text = normalizeText(rawText)
  const missing = expectedSnippets.filter((snippet) => !text.includes(snippet))
  if (missing.length > 0) {
    recordCheck(report, name, { ok: false, missing, textPreview: text.slice(0, 500) })
    throw new Error(`${name} missing expected text: ${missing.join(', ')}`)
  }
  recordCheck(report, name, { ok: true, expectedSnippets })
}

async function dismissCommonOverlays(page) {
  for (const label of ['Skip', 'Skip setup', 'Dismiss', 'Close', 'Got it']) {
    const button = page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first()
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {})
      await page.waitForTimeout(400)
    }
  }

  const onboardingTitle = page.getByText('Welcome to Mission Control').first()
  if (await onboardingTitle.isVisible().catch(() => false)) {
    for (const label of ['Skip setup', 'Get started']) {
      const button = page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first()
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true }).catch(() => {})
        await onboardingTitle.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(600)
      }
    }
  }
}

async function captureFailure(page, name) {
  mkdirSync(outputDir, { recursive: true })
  const screenshotPath = path.join(outputDir, `${name}-failure.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
  const bodyText = await page.locator('body').textContent().catch(() => '')
  console.error(`QA failure on ${name}`)
  console.error(`URL: ${page.url()}`)
  console.error(`Title: ${await page.title().catch(() => '')}`)
  console.error(`Body preview: ${(bodyText || '').replace(/\s+/g, ' ').slice(0, 400)}`)
  console.error(`Screenshot: ${screenshotPath}`)
}

async function captureOverview(page, report) {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await dismissCommonOverlays(page)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  const hermesCard = page.getByRole('heading', { name: 'Hermes Ready Right Now' }).first()
  try {
    await hermesCard.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    await captureFailure(page, 'hermes-overview')
    throw error
  }
  await page.screenshot({ path: path.join(outputDir, 'hermes-overview-page.png'), fullPage: true })
  const cardPanel = hermesCard.locator('xpath=ancestor::div[contains(@class,"panel")][1]')
  const screenshotPath = path.join(outputDir, 'hermes-dashboard-card.png')
  await cardPanel.screenshot({ path: screenshotPath })
  report.screenshots.push(screenshotPath)
  await page.getByText('CLI unavailable').first().waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByText('Open task board').first().waitFor({ state: 'visible', timeout: 10_000 })
  recordCheck(report, 'overview-card', {
    ok: true,
    expectedSnippets: ['CLI unavailable', 'Open task board'],
  })
}

async function captureTasks(page, report) {
  await page.goto(`${baseUrl}/tasks`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  const hermesSectionButton = page.getByRole('button', { name: /Hermes Scheduled Tasks/i }).first()
  try {
    await hermesSectionButton.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    await captureFailure(page, 'hermes-tasks')
    throw error
  }
  await hermesSectionButton.click().catch(() => {})
  await page.waitForTimeout(1200)

  const section = page.locator('text=Hermes Scheduled Tasks').first().locator('xpath=ancestor::*[contains(@class,"border")][1]')
  const screenshotPath = path.join(outputDir, 'hermes-task-ledger.png')
  await section.screenshot({ path: screenshotPath })
  report.screenshots.push(screenshotPath)
  const sectionText = normalizeText(await section.textContent().catch(() => ''))
  const hasJobs = /(Failing|Scheduled|Paused)/.test(sectionText)
  recordCheck(report, 'task-ledger', { ok: hasJobs, textPreview: sectionText.slice(0, 500) })
  if (!hasJobs) {
    throw new Error('task-ledger missing expected Hermes job status labels')
  }
}

async function openSettingsFromOverview(page) {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await dismissCommonOverlays(page)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  const openSettingsButton = page.getByRole('button', { name: 'Open Settings' }).first()
  try {
    await openSettingsButton.waitFor({ state: 'visible', timeout: 15_000 })
    await openSettingsButton.click()
    await page.waitForURL(/\/settings$/, { timeout: 15_000 }).catch(() => {})
  } catch (error) {
    await captureFailure(page, 'hermes-open-settings')
    throw error
  }
}

async function captureSettings(page, report) {
  await openSettingsFromOverview(page)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  const hermesSummary = page.getByText('Hermes Agent', { exact: true }).first()
  try {
    await hermesSummary.waitFor({ state: 'visible', timeout: 20_000 })
  } catch (error) {
    await captureFailure(page, 'hermes-settings')
    throw error
  }

  await hermesSummary.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(1200)

  const summarySection = hermesSummary.locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
  const pageScreenshot = path.join(outputDir, 'hermes-settings-page.png')
  const summaryScreenshot = path.join(outputDir, 'hermes-settings-hermes-summary.png')
  await page.screenshot({ path: pageScreenshot, fullPage: true })
  await summarySection.screenshot({ path: summaryScreenshot })
  report.screenshots.push(pageScreenshot, summaryScreenshot)
  await page.getByText('Hermes home state is present, but this station cannot run the Hermes CLI yet.').first().waitFor({ state: 'visible', timeout: 10_000 })
  recordCheck(report, 'settings-hermes-summary', {
    ok: true,
    expectedSnippets: ['Hermes home state is present, but this station cannot run the Hermes CLI yet.'],
  })
}

async function captureRuntimeModal(page, report) {
  await openSettingsFromOverview(page)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  const hermesSummary = page.getByText('Hermes Agent', { exact: true }).first()
  try {
    await hermesSummary.waitFor({ state: 'visible', timeout: 20_000 })
  } catch (error) {
    await captureFailure(page, 'hermes-runtime-modal-settings')
    throw error
  }

  await hermesSummary.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(1200)

  const configureHermesButton = page.getByRole('button', { name: 'Configure Hermes' }).first()
  try {
    await configureHermesButton.waitFor({ state: 'visible', timeout: 15_000 })
    await configureHermesButton.click()
  } catch (error) {
    await captureFailure(page, 'hermes-runtime-modal-open')
    throw error
  }

  const modalHeading = page.getByRole('heading', { name: 'Set Up Hermes' }).first()
  try {
    await modalHeading.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    await captureFailure(page, 'hermes-runtime-modal')
    throw error
  }

  const modal = modalHeading.locator('xpath=ancestor::*[contains(@class,"rounded-xl")][1]')
  const warningBlock = modal.getByText('cannot run the Hermes CLI yet').first()
  await warningBlock.waitFor({ state: 'visible', timeout: 10_000 })
  await modal.getByText('bootstrap, doctor, and runnable Hermes commands').first().waitFor({ state: 'visible', timeout: 10_000 })
  await warningBlock.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(300)
  const screenshotPath = path.join(outputDir, 'hermes-runtime-setup-modal.png')
  const warningScreenshotPath = path.join(outputDir, 'hermes-runtime-setup-warning.png')
  await modal.screenshot({ path: screenshotPath })
  const warningCard = warningBlock.locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
  await warningCard.screenshot({ path: warningScreenshotPath })
  report.screenshots.push(screenshotPath, warningScreenshotPath)
  recordCheck(report, 'runtime-setup-modal', {
    ok: true,
    expectedSnippets: ['cannot run the Hermes CLI yet', 'bootstrap, doctor, and runnable Hermes commands'],
  })
}

async function main() {
  if (!existsSync(storageStatePath)) {
    throw new Error(`Storage state not found at ${storageStatePath}. Run create-playwright-auth-state first.`)
  }

  mkdirSync(outputDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    screenshots: [],
    checks: [],
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1.5,
  })

  const page = await context.newPage()
  await page.addInitScript((dismissedKey) => {
    window.sessionStorage.setItem(dismissedKey, '1')
  }, ONBOARDING_SESSION_DISMISSED_KEY)
  try {
    await captureOverview(page, report)
    await captureTasks(page, report)
    await captureSettings(page, report)
    await captureRuntimeModal(page, report)
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log('Saved QA screenshots:')
    console.log(path.join(outputDir, 'hermes-dashboard-card.png'))
    console.log(path.join(outputDir, 'hermes-task-ledger.png'))
    console.log(path.join(outputDir, 'hermes-settings-hermes-summary.png'))
    console.log(path.join(outputDir, 'hermes-runtime-setup-modal.png'))
    console.log(path.join(outputDir, 'hermes-runtime-setup-warning.png'))
    console.log('Saved QA report:')
    console.log(reportPath)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
