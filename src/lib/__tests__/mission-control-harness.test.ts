import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emitMissionControlHarnessReady,
  getMissionControlHarnessAttributes,
  missionControlHarnessReadyEventName,
} from '@/lib/mission-control-harness'

const ORIGINAL_TEST_MODE = process.env.NEXT_PUBLIC_MISSION_CONTROL_TEST_MODE

afterEach(() => {
  if (ORIGINAL_TEST_MODE === undefined) {
    delete process.env.NEXT_PUBLIC_MISSION_CONTROL_TEST_MODE
  } else {
    process.env.NEXT_PUBLIC_MISSION_CONTROL_TEST_MODE = ORIGINAL_TEST_MODE
  }
  vi.restoreAllMocks()
})

describe('mission-control harness', () => {
  it('returns shell attributes in test mode', () => {
    process.env.NEXT_PUBLIC_MISSION_CONTROL_TEST_MODE = '1'

    expect(getMissionControlHarnessAttributes({
      activePanel: 'overview',
      bootComplete: false,
      showOnboarding: false,
    })).toEqual({
      'data-mc-shell-ready': '0',
      'data-mc-active-panel': 'overview',
    })

    expect(getMissionControlHarnessAttributes({
      activePanel: 'logs',
      bootComplete: true,
      showOnboarding: false,
    })).toEqual({
      'data-mc-shell-ready': '1',
      'data-mc-active-panel': 'logs',
    })
  })

  it('emits a harness-ready event only when the shell is interactive', () => {
    process.env.NEXT_PUBLIC_MISSION_CONTROL_TEST_MODE = '1'
    const details: Array<{ pathname: string; activeTab: string }> = []
    const eventName = missionControlHarnessReadyEventName()

    window.addEventListener(eventName, ((event: Event) => {
      details.push((event as CustomEvent).detail)
    }) as EventListener)

    emitMissionControlHarnessReady({
      pathname: '/',
      activeTab: 'overview',
      bootComplete: false,
      showOnboarding: false,
    })
    emitMissionControlHarnessReady({
      pathname: '/logs',
      activeTab: 'logs',
      bootComplete: true,
      showOnboarding: true,
    })
    emitMissionControlHarnessReady({
      pathname: '/logs',
      activeTab: 'logs',
      bootComplete: true,
      showOnboarding: false,
    })

    expect(details).toEqual([
      {
        pathname: '/logs',
        activeTab: 'logs',
        bootComplete: true,
        showOnboarding: false,
      },
    ])
  })
})
