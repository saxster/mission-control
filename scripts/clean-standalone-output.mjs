#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const standaloneDir = path.join(repoRoot, '.next', 'standalone')

try {
  fs.rmSync(standaloneDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[clean-standalone-output] failed to remove ${standaloneDir}: ${message}\n`)
  process.exit(1)
}
