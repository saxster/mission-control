import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pageSource = readFileSync(
  join(process.cwd(), 'src/app/[[...panel]]/page.tsx'),
  'utf8',
)

describe('Mission Control route lazy panel wiring', () => {
  it('loads non-eager panels through the panel registry', () => {
    expect(pageSource).toContain("from '@/app/panel-registry'")
    expect(pageSource).not.toContain("from '@/components/panels/log-viewer-panel'")
    expect(pageSource).not.toContain("from '@/components/panels/task-board-panel'")
    expect(pageSource).not.toContain("from '@/components/modals/project-manager-modal'")
  })
})
