'use client'

export interface MissionControlHarnessDetail {
  pathname: string
  activeTab: string
  bootComplete: boolean
  showOnboarding: boolean
}

interface MissionControlHarnessAttributesInput {
  activePanel: string
  bootComplete: boolean
  showOnboarding: boolean
}

const HARNESS_READY_EVENT = 'mc:harness-ready'

export function isMissionControlHarnessTestMode(): boolean {
  if (process.env.NEXT_PUBLIC_MISSION_CONTROL_TEST_MODE === '1') return true
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem('mc-harness-test-mode') === '1'
  } catch {
    return false
  }
}

export function missionControlHarnessReadyEventName(): string {
  return HARNESS_READY_EVENT
}

export function getMissionControlHarnessAttributes(
  input: MissionControlHarnessAttributesInput
): Record<string, string> {
  if (!isMissionControlHarnessTestMode()) return {}
  return {
    'data-mc-shell-ready': input.bootComplete && !input.showOnboarding ? '1' : '0',
    'data-mc-active-panel': input.activePanel,
  }
}

export function emitMissionControlHarnessReady(detail: MissionControlHarnessDetail): void {
  if (!isMissionControlHarnessTestMode()) return
  if (typeof window === 'undefined') return
  if (!detail.bootComplete || detail.showOnboarding) return
  window.dispatchEvent(new CustomEvent(HARNESS_READY_EVENT, { detail }))
}
