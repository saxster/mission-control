import { describe, expect, it } from 'vitest'
import { mergeHermesBootstrapData } from '@/lib/hermes-bootstrap'

describe('mergeHermesBootstrapData', () => {
  it('prefers status bootstrap data and preserves doctor summary details', () => {
    const merged = mergeHermesBootstrapData(
      {
        bootstrap: {
          ready: false,
          blocking_checks: [{ code: 'provider_not_configured', message: 'No provider configured.' }],
          recommended_next_steps: ['Run `hermes model`.'],
          issue_count: 1,
        },
        providers: {
          readiness: {
            configured: false,
            env_configured: false,
            config_configured: false,
            oauth: { nous: false, openai_codex: false },
          },
        },
        gateway: { runtime_state: 'stopped' },
        messaging: {
          platforms: [{ name: 'Telegram', configured: true }],
        },
      },
      {
        bootstrap: {
          ready: true,
          blocking_checks: [],
          recommended_next_steps: [],
          issue_count: 0,
        },
        summary: {
          ok: false,
          issues_count: 2,
          manual_issues_count: 1,
          remaining_issues_count: 3,
          fixed_count: 0,
        },
        issues: ['Issue A'],
        manual_issues: ['Manual issue'],
      },
    )

    expect(merged.bootstrap?.blocking_checks[0]?.code).toBe('provider_not_configured')
    expect(merged.providerReadiness?.configured).toBe(false)
    expect(merged.gateway?.runtime_state).toBe('stopped')
    expect(merged.messagingPlatforms).toHaveLength(1)
    expect(merged.doctor?.summary?.remaining_issues_count).toBe(3)
    expect(merged.doctor?.manualIssues).toEqual(['Manual issue'])
  })
})
