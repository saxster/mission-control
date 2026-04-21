import { describe, expect, it } from 'vitest'
import {
  buildHermesRoutingSummary,
  parseHermesRoutingBindings,
  resolveHermesBindingForSource,
  stringifyHermesRoutingBindings,
} from '@/lib/hermes-routing'

describe('buildHermesRoutingSummary', () => {
  it('summarizes shared Hermes routes across sessions, messaging, gateway, and automation', () => {
    const summary = buildHermesRoutingSummary({
      sessions: [
        { sessionId: '1', source: 'cli', model: null, title: null, messageCount: 3, toolCallCount: 0, inputTokens: 10, outputTokens: 20, firstMessageAt: null, lastMessageAt: null, isActive: false },
        { sessionId: '2', source: 'telegram', model: null, title: null, messageCount: 4, toolCallCount: 1, inputTokens: 30, outputTokens: 40, firstMessageAt: null, lastMessageAt: null, isActive: true },
      ],
      messagingPlatforms: [
        { name: 'Telegram', configured: true },
        { name: 'Discord', configured: true },
      ],
      gateway: {
        runtime_state: 'running',
        session_count: 2,
      },
      bindings: {
        telegram: 'personal',
        cron: 'automation',
      },
      taskSummary: {
        total: 3,
        enabled: 2,
        paused: 1,
        failing: 1,
        healthy: 1,
        scheduled: 2,
      },
    })

    expect(summary.mode).toBe('shared_home')
    expect(summary.routes[0]).toMatchObject({
      id: 'shared-profile',
      status: 'shared',
    })
    expect(summary.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'source-cli',
        label: 'CLI / local chat',
        status: 'configured',
        detail: '1 session observed',
      }),
      expect.objectContaining({
        id: 'source-telegram',
        label: 'Telegram inbox',
        status: 'active',
        activeCount: 1,
        profile: 'Personal Hermes profile',
      }),
      expect.objectContaining({
        id: 'platform-discord',
        label: 'Discord inbox',
        status: 'configured',
        detail: 'Configured in Hermes, waiting for the next inbound session.',
      }),
      expect.objectContaining({
        id: 'gateway-runtime',
        status: 'active',
        detail: '2 gateway sessions currently attached',
      }),
      expect.objectContaining({
        id: 'automation',
        status: 'active',
        profile: 'Automation Hermes profile',
        detail: '3 cron jobs · 1 failing · 1 paused',
      }),
    ]))
    expect(summary.bindingTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'telegram',
        profile: 'Personal Hermes profile',
      }),
      expect.objectContaining({
        key: 'cron',
        profile: 'Automation Hermes profile',
      }),
    ]))
    expect(summary.notes[0]).toContain('not split at runtime yet')
  })

  it('parses and serializes stored Hermes routing bindings safely', () => {
    const parsed = parseHermesRoutingBindings('{" Telegram ":"personal","cron":"automation","bad":123}')
    expect(parsed).toEqual({
      telegram: 'personal',
      cron: 'automation',
    })

    expect(stringifyHermesRoutingBindings(parsed)).toBe('{\n  "telegram": "personal",\n  "cron": "automation"\n}')
  })

  it('resolves a source to the stored Hermes profile binding', () => {
    expect(resolveHermesBindingForSource('telegram', { telegram: 'personal' })).toEqual({
      sourceKey: 'telegram',
      profile: 'personal',
      profileLabel: 'Personal Hermes profile',
      profileBadge: 'Personal',
    })

    expect(resolveHermesBindingForSource('cli', {})).toEqual({
      sourceKey: 'cli',
      profile: 'primary',
      profileLabel: 'Primary Hermes profile',
      profileBadge: 'Primary',
    })
  })
})
