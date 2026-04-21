#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = process.cwd()
const nextRoot = path.join(repoRoot, '.next')
const configPath = path.join(repoRoot, 'scripts', 'performance-budgets.json')

function parseArgs(argv) {
  const args = {
    check: false,
    writeReport: null,
    baseline: null,
    route: '/[[...panel]]/page',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') args.check = true
    else if (arg === '--write-report') args.writeReport = argv[i + 1] || null, i += 1
    else if (arg === '--baseline') args.baseline = argv[i + 1] || null, i += 1
    else if (arg === '--route') args.route = argv[i + 1] || args.route, i += 1
  }

  return args
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function loadClientReferenceManifest(filePath, routeKey) {
  const sandbox = { globalThis: {} }
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), sandbox)
  return sandbox.globalThis.__RSC_MANIFEST?.[routeKey]
}

function bytesFor(nextDir, relativePath) {
  const absolutePath = path.join(nextDir, relativePath)
  return fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : 0
}

function summarizeFiles(nextDir, files) {
  const uniqueFiles = [...new Set(files)]
  const detailedFiles = uniqueFiles
    .map((file) => ({ file, bytes: bytesFor(nextDir, file) }))
    .sort((left, right) => right.bytes - left.bytes)
  const totalBytes = detailedFiles.reduce((sum, entry) => sum + entry.bytes, 0)
  return { totalBytes, files: detailedFiles }
}

function percentageReduction(fromBytes, toBytes) {
  if (!Number.isFinite(fromBytes) || fromBytes <= 0) return null
  return 1 - (toBytes / fromBytes)
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function buildReport(routeKey) {
  const routeDir = path.join(nextRoot, 'server', 'app', '[[...panel]]', 'page')
  const buildManifest = readJson(path.join(routeDir, 'build-manifest.json'))
  const reactLoadableManifest = readJson(path.join(routeDir, 'react-loadable-manifest.json'))
  const clientReferenceManifest = loadClientReferenceManifest(
    path.join(nextRoot, 'server', 'app', '[[...panel]]', 'page_client-reference-manifest.js'),
    routeKey,
  )

  if (!clientReferenceManifest) {
    throw new Error(`Could not resolve client reference manifest for route ${routeKey}`)
  }

  const routeEntryKey = '[project]/src/app/[[...panel]]/page'
  const layoutEntryKey = '[project]/src/app/layout'
  const routeEntryFiles = (clientReferenceManifest.entryJSFiles?.[routeEntryKey] || []).map((file) => file.replace('/_next/', ''))
  const layoutEntryFiles = (clientReferenceManifest.entryJSFiles?.[layoutEntryKey] || []).map((file) => file.replace('/_next/', ''))
  const rootMainFiles = [
    ...(buildManifest.polyfillFiles || []),
    ...(buildManifest.rootMainFiles || []),
  ]
  const initialFiles = [...new Set([...rootMainFiles, ...layoutEntryFiles, ...routeEntryFiles])]
  const lazyFiles = [...new Set(Object.values(reactLoadableManifest).flatMap((entry) => entry.files || []))]

  return {
    generatedAt: new Date().toISOString(),
    route: routeKey,
    initial: summarizeFiles(nextRoot, initialFiles),
    lazy: summarizeFiles(nextRoot, lazyFiles),
    leakedLazyFiles: lazyFiles.filter((file) => initialFiles.includes(file)),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const budgets = readJson(configPath).missionControlOverview
  const report = buildReport(args.route)

  let baselineInitialBytes = budgets.baselineInitialJsBytes
  if (args.baseline) {
    const baseline = readJson(path.resolve(repoRoot, args.baseline))
    baselineInitialBytes = baseline?.initial?.totalBytes ?? baselineInitialBytes
  }

  const reductionRatio = baselineInitialBytes == null
    ? null
    : percentageReduction(baselineInitialBytes, report.initial.totalBytes)

  const enrichedReport = {
    ...report,
    budgets: {
      ...budgets,
      baselineInitialJsBytes: baselineInitialBytes,
      reductionRatio,
    },
  }

  if (args.writeReport) {
    const reportPath = path.resolve(repoRoot, args.writeReport)
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, `${JSON.stringify(enrichedReport, null, 2)}\n`, 'utf8')
  }

  console.log(`Mission Control overview initial JS: ${formatBytes(report.initial.totalBytes)}`)
  console.log(`Mission Control lazy panel JS: ${formatBytes(report.lazy.totalBytes)}`)
  if (reductionRatio == null) {
    console.log('Baseline comparison: unavailable (no baselineInitialJsBytes configured)')
  } else {
    if (budgets.baselineCommit) {
      console.log(`Baseline source: commit ${budgets.baselineCommit}`)
    }
    console.log(`Reduction vs baseline: ${(reductionRatio * 100).toFixed(1)}%`)
  }
  if (report.leakedLazyFiles.length > 0) {
    console.log(`Lazy chunk leaks detected: ${report.leakedLazyFiles.join(', ')}`)
  }

  if (!args.check) return

  const failures = []

  if (report.initial.totalBytes > budgets.maxInitialJsBytes) {
    failures.push(`Initial overview JS ${report.initial.totalBytes} exceeds budget ${budgets.maxInitialJsBytes}`)
  }
  if (report.lazy.totalBytes < budgets.minLazyJsBytes) {
    failures.push(`Lazy panel JS ${report.lazy.totalBytes} is below minimum split threshold ${budgets.minLazyJsBytes}`)
  }
  if (report.leakedLazyFiles.length > 0) {
    failures.push(`Lazy files leaked into initial bundle: ${report.leakedLazyFiles.join(', ')}`)
  }
  if (baselineInitialBytes != null && reductionRatio != null && reductionRatio < budgets.minReductionRatioVsBaseline) {
    failures.push(`Initial overview JS reduction ${(reductionRatio * 100).toFixed(1)}% is below required ${(budgets.minReductionRatioVsBaseline * 100).toFixed(1)}%`)
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`ERROR: ${failure}`)
    }
    process.exitCode = 1
  }
}

main()
