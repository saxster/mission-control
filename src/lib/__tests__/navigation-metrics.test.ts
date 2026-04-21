import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('navigation metrics', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'))
    performance.clearMarks()
    performance.clearMeasures()
  })

  it('records a completed navigation sample and emits a window event', async () => {
    const {
      completeNavigationTiming,
      navigationMetricEventName,
      resetNavigationMetrics,
      startNavigationTiming,
    } = await import('@/lib/navigation-metrics')
    resetNavigationMetrics()
    const metricEvents: Array<{ durationMs: number }> = []
    const eventName = navigationMetricEventName()
    window.addEventListener(eventName, ((event: Event) => {
      metricEvents.push((event as CustomEvent).detail)
    }) as EventListener)

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(84)

    startNavigationTiming('/', '/skills')
    const sample = completeNavigationTiming('/skills')

    expect(sample).toMatchObject({
      from: '/',
      to: '/skills',
      durationMs: 74,
    })
    expect(metricEvents).toHaveLength(1)
    expect(metricEvents[0]).toMatchObject({
      from: '/',
      to: '/skills',
      durationMs: 74,
      startedAt: 10,
      completedAt: 84,
      navigationId: 1,
    })
  })

  it('computes the latest, average, and p95 latency across recent samples', async () => {
    const {
      completeNavigationTiming,
      getNavigationMetrics,
      resetNavigationMetrics,
      startNavigationTiming,
    } = await import('@/lib/navigation-metrics')
    resetNavigationMetrics()
    const nowSpy = vi.spyOn(performance, 'now')
    const samples = [
      { path: '/skills', start: 0, end: 50 },
      { path: '/activity', start: 100, end: 175 },
      { path: '/tasks', start: 200, end: 300 },
      { path: '/chat', start: 400, end: 525 },
      { path: '/settings', start: 700, end: 850 },
    ]

    for (const sample of samples) {
      nowSpy.mockReturnValueOnce(sample.start).mockReturnValueOnce(sample.end)
      startNavigationTiming('/', sample.path)
      completeNavigationTiming(sample.path)
    }

    expect(getNavigationMetrics()).toMatchObject({
      count: 5,
      latestMs: 150,
      avgMs: 100,
      p95Ms: 150,
    })
  })

  it('ignores same-route navigations', async () => {
    const {
      getNavigationMetrics,
      resetNavigationMetrics,
      startNavigationTiming,
    } = await import('@/lib/navigation-metrics')
    resetNavigationMetrics()

    startNavigationTiming('/activity', '/activity')

    expect(getNavigationMetrics()).toMatchObject({
      count: 0,
      latestMs: null,
      avgMs: null,
      p95Ms: null,
    })
  })

  it('completes only the most recent pending navigation when transitions are replaced', async () => {
    const {
      completeNavigationTiming,
      getNavigationMetrics,
      resetNavigationMetrics,
      startNavigationTiming,
    } = await import('@/lib/navigation-metrics')
    resetNavigationMetrics()

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(15)
      .mockReturnValueOnce(60)

    startNavigationTiming('/', '/activity')
    startNavigationTiming('/', '/skills')

    expect(completeNavigationTiming('/activity')).toBeNull()
    expect(completeNavigationTiming('/skills')).toMatchObject({
      from: '/',
      to: '/skills',
      durationMs: 45,
      navigationId: 2,
    })
    expect(getNavigationMetrics().count).toBe(1)
  })

  it('does not double-complete the same navigation sample', async () => {
    const {
      completeNavigationTiming,
      getNavigationMetrics,
      resetNavigationMetrics,
      startNavigationTiming,
    } = await import('@/lib/navigation-metrics')
    resetNavigationMetrics()

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(95)

    startNavigationTiming('/', '/chat')

    expect(completeNavigationTiming('/chat')).toMatchObject({
      to: '/chat',
      durationMs: 75,
    })
    expect(completeNavigationTiming('/chat')).toBeNull()
    expect(getNavigationMetrics().count).toBe(1)
  })
})
