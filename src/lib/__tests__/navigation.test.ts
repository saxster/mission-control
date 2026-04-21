import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFETCH_PANELS, panelHref } from '@/lib/navigation'

describe('navigation defaults', () => {
  it('keeps the logs panel out of the default prefetch list', () => {
    expect(DEFAULT_PREFETCH_PANELS).not.toContain('logs')
  })

  it('maps overview to the root href', () => {
    expect(panelHref('overview')).toBe('/')
    expect(panelHref('logs')).toBe('/logs')
  })
})
