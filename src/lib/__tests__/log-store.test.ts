import { beforeEach, describe, expect, it } from 'vitest'
import { useMissionControl, type LogEntry } from '@/store'

function makeLog(id: string, timestamp: number): LogEntry {
  return {
    id,
    timestamp,
    level: 'info',
    source: 'gateway',
    message: `log-${id}`,
  }
}

function resetStore() {
  useMissionControl.setState(useMissionControl.getInitialState(), true)
}

describe('log store batching', () => {
  beforeEach(() => {
    resetStore()
  })

  it('replaces logs in one deduplicated batch and warms the viewer cache', () => {
    useMissionControl.getState().replaceLogs([
      makeLog('a', 300),
      makeLog('b', 200),
      makeLog('a', 100),
    ])

    const state = useMissionControl.getState()
    expect(state.logs.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(state.logViewerCache.hasLoadedInitialData).toBe(true)
    expect(typeof state.logViewerCache.lastLoadedAt).toBe('number')
  })

  it('prepends only new logs and preserves newest-first ordering', () => {
    useMissionControl.getState().replaceLogs([
      makeLog('existing-2', 200),
      makeLog('existing-1', 100),
    ])

    useMissionControl.getState().prependLogs([
      makeLog('new-2', 400),
      makeLog('existing-2', 200),
      makeLog('new-1', 300),
    ])

    const state = useMissionControl.getState()
    expect(state.logs.map((entry) => entry.id)).toEqual([
      'new-2',
      'existing-2',
      'new-1',
      'existing-1',
    ])
  })
})
