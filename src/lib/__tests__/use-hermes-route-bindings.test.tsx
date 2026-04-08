import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitHermesRouteBindingsUpdated,
  useHermesRouteBindings,
} from '@/lib/use-hermes-route-bindings'

type HookProbeProps = {
  label: string
  source?: string
  nextProfile?: string
}

function HookProbe({
  label,
  source = 'telegram',
  nextProfile = 'work',
}: HookProbeProps) {
  const { bindings, loaded, updateBinding } = useHermesRouteBindings()
  const currentProfile = bindings[source] || 'primary'

  return (
    <div data-testid={`${label}-probe`}>
      <div>{label}: {loaded ? currentProfile : 'loading'}</div>
      <button
        type="button"
        onClick={() => void updateBinding({ source, profile: nextProfile })}
      >
        set-{label}-{nextProfile}
      </button>
    </div>
  )
}

function EventProbe({ source = 'telegram' }: { source?: string }) {
  const { bindings, loaded } = useHermesRouteBindings()
  const currentProfile = bindings[source] || 'primary'

  useEffect(() => {
    if (loaded) {
      emitHermesRouteBindingsUpdated({ [source]: 'research' })
    }
  }, [loaded, source])

  return <div>event-probe: {loaded ? currentProfile : 'loading'}</div>
}

describe('useHermesRouteBindings', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    let settingsValue = '{}'
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/settings') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({
          settings: [
            {
              key: 'chat.hermes_source_bindings',
              value: settingsValue,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/api/settings') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'))
        settingsValue = String(body?.settings?.['chat.hermes_source_bindings'] || '{}')
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'Unexpected request' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('broadcasts saved bindings to other hook instances immediately', async () => {
    render(
      <>
        <HookProbe label="first" />
        <HookProbe label="second" />
      </>,
    )

    await waitFor(() => {
      expect(screen.getByText('first: primary')).toBeInTheDocument()
      expect(screen.getByText('second: primary')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'set-first-work' }))

    await waitFor(() => {
      expect(screen.getByText('first: work')).toBeInTheDocument()
      expect(screen.getByText('second: work')).toBeInTheDocument()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      method: 'PUT',
    }))
  })

  it('applies emitted Hermes binding updates without a refetch', async () => {
    render(<EventProbe />)

    await waitFor(() => {
      expect(screen.getByText('event-probe: research')).toBeInTheDocument()
    })

    const settingsGets = vi.mocked(global.fetch).mock.calls.filter(([input, init]) => {
      return String(input).endsWith('/api/settings') && (!init || !init.method || init.method === 'GET')
    })
    expect(settingsGets).toHaveLength(1)

    act(() => {
      emitHermesRouteBindingsUpdated({ telegram: 'automation' })
    })

    await waitFor(() => {
      expect(screen.getByText('event-probe: automation')).toBeInTheDocument()
    })

    const settingsGetsAfterBroadcast = vi.mocked(global.fetch).mock.calls.filter(([input, init]) => {
      return String(input).endsWith('/api/settings') && (!init || !init.method || init.method === 'GET')
    })
    expect(settingsGetsAfterBroadcast).toHaveLength(1)
  })
})
