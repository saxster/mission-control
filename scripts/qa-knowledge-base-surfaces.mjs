import { spawnSync } from 'node:child_process'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const args = ['exec', 'vitest', 'run', 'src/lib/__tests__/knowledge-base-qa-harness.test.ts']

const result = spawnSync(command, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log(path.join(repoRoot, 'output', 'playwright', 'knowledge-base-qa-report.json'))
