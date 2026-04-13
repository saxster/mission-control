'use client'

import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('Performance')
const LONG_TASK_EVENT = 'mc:long-task'
let observerInitialized = false

export function initMissionControlPerformanceObserver() {
  if (observerInitialized || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {}
  }

  const supportedTypes = typeof PerformanceObserver.supportedEntryTypes === 'object'
    ? PerformanceObserver.supportedEntryTypes
    : []
  if (!supportedTypes.includes('longtask')) {
    return () => {}
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const detail = {
        name: entry.name,
        durationMs: Math.round(entry.duration),
        startedAt: Math.round(entry.startTime),
      }
      window.dispatchEvent(new CustomEvent(LONG_TASK_EVENT, { detail }))
      log.warn(`Long task detected: ${detail.durationMs}ms`)
    }
  })

  observer.observe({ entryTypes: ['longtask'] })
  observerInitialized = true

  return () => {
    observer.disconnect()
    observerInitialized = false
  }
}

export async function measureAsync<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (typeof performance === 'undefined') {
    return run()
  }

  const startMark = `${name}:start`
  const endMark = `${name}:end`
  performance.mark(startMark)
  try {
    return await run()
  } finally {
    performance.mark(endMark)
    performance.measure(name, startMark, endMark)
    performance.clearMarks(startMark)
    performance.clearMarks(endMark)
  }
}

export function longTaskEventName() {
  return LONG_TASK_EVENT
}
