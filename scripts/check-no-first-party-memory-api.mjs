#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SEARCH_TOKEN = '/api/memory'
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'])
const SCAN_ROOTS = ['src', 'scripts']
const IGNORE_EXACT = new Set([
  'scripts/check-no-first-party-memory-api.mjs',
  'src/lib/legacy-memory-route.ts',
  'src/app/api/index/route.ts',
])
const IGNORE_PREFIXES = ['src/app/api/memory/']

function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath))
      continue
    }

    if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function shouldIgnore(relativePath) {
  if (IGNORE_EXACT.has(relativePath)) return true
  if (relativePath.includes('/__tests__/')) return true
  if (relativePath.endsWith('.spec.ts') || relativePath.endsWith('.spec.tsx')) return true
  return IGNORE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
}

function findViolations(relativePath, source) {
  const lines = source.split(/\r?\n/)
  const matches = []

  lines.forEach((line, index) => {
    if (line.includes(SEARCH_TOKEN)) {
      matches.push({ lineNumber: index + 1, text: line.trim() })
    }
  })

  return matches.map((match) => ({
    file: relativePath,
    ...match,
  }))
}

const repoRoot = process.cwd()
const violations = []

for (const scanRoot of SCAN_ROOTS) {
  const absoluteRoot = path.join(repoRoot, scanRoot)
  for (const absolutePath of collectFiles(absoluteRoot)) {
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/')
    if (shouldIgnore(relativePath)) continue

    const source = readFileSync(absolutePath, 'utf8')
    if (!source.includes(SEARCH_TOKEN)) continue

    violations.push(...findViolations(relativePath, source))
  }
}

if (violations.length > 0) {
  console.error('Disallowed first-party references to deprecated /api/memory/* endpoints were found:\n')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.lineNumber} ${violation.text}`)
  }
  console.error('\nUse /api/knowledge-base/* for first-party runtime and automation code. Compatibility docs/tests/routes are intentionally excluded from this guard.')
  process.exit(1)
}

console.log('No disallowed first-party /api/memory/* references found.')
