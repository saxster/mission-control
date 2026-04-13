import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const redirectSource = readFileSync(
  join(process.cwd(), 'src/app/memory/page.tsx'),
  'utf8',
)

describe('legacy memory route redirect', () => {
  it('redirects old memory routes to knowledge-base', () => {
    expect(redirectSource).toContain("redirect('/knowledge-base')")
  })
})
