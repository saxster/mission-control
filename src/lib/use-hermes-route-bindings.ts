'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  HERMES_ROUTING_BINDINGS_SETTING_KEY,
  parseHermesRoutingBindings,
  resolveHermesProfileValue,
  stringifyHermesRoutingBindings,
} from '@/lib/hermes-routing'

const HERMES_ROUTE_BINDINGS_UPDATED_EVENT = 'mission-control:hermes-route-bindings-updated'

type SettingsRow = {
  key?: string
  value?: string
}

function normalizeHermesBindings(bindings: Record<string, string>) {
  return parseHermesRoutingBindings(stringifyHermesRoutingBindings(bindings))
}

export function emitHermesRouteBindingsUpdated(bindings: Record<string, string>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(HERMES_ROUTE_BINDINGS_UPDATED_EVENT, {
    detail: {
      bindings: normalizeHermesBindings(bindings),
    },
  }))
}

export function useHermesRouteBindings() {
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  const refreshBindings = useCallback(async () => {
    const response = await fetch('/api/settings')
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to load Hermes routing settings')
    }

    const settings = Array.isArray(data?.settings) ? data.settings as SettingsRow[] : []
    const currentSetting = settings.find((setting) => setting?.key === HERMES_ROUTING_BINDINGS_SETTING_KEY)
    setBindings(parseHermesRoutingBindings(typeof currentSetting?.value === 'string' ? currentSetting.value : '{}'))
    setLoaded(true)
  }, [])

  useEffect(() => {
    refreshBindings().catch(() => {
      setLoaded(true)
    })
  }, [refreshBindings])

  useEffect(() => {
    const handleBindingsUpdated = (event: Event) => {
      const nextBindings = (event as CustomEvent<{ bindings?: Record<string, string> }>)?.detail?.bindings
      if (!nextBindings || typeof nextBindings !== 'object') return
      setBindings(normalizeHermesBindings(nextBindings))
      setLoaded(true)
    }

    window.addEventListener(HERMES_ROUTE_BINDINGS_UPDATED_EVENT, handleBindingsUpdated)
    return () => {
      window.removeEventListener(HERMES_ROUTE_BINDINGS_UPDATED_EVENT, handleBindingsUpdated)
    }
  }, [])

  const updateBinding = useCallback(async (payload: { source: string; profile: string }) => {
    const sourceKey = String(payload.source || '').trim().toLowerCase() || 'cli'
    const nextProfile = resolveHermesProfileValue(payload.profile)
    const nextBindings = {
      ...bindings,
      [sourceKey]: nextProfile,
    }

    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          [HERMES_ROUTING_BINDINGS_SETTING_KEY]: stringifyHermesRoutingBindings(nextBindings),
        },
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to save Hermes routing settings')
    }

    setBindings(nextBindings)
    emitHermesRouteBindingsUpdated(nextBindings)
    return nextBindings
  }, [bindings])

  return {
    bindings,
    loaded,
    refreshBindings,
    updateBinding,
  }
}
