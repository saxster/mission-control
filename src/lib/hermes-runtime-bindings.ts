import { HERMES_PROFILE_OPTIONS } from './hermes-routing'

export const HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY = 'chat.hermes_runtime_profile_bindings'

const VALID_HERMES_PROFILE_VALUES = new Set<string>(HERMES_PROFILE_OPTIONS.map((option) => option.value))

function normalizePersonaKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeRuntimeProfileName(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || 'default'
}

export function parseHermesRuntimeProfileBindings(raw: string | null | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const profileKey = normalizePersonaKey(key)
        const runtimeProfileName = normalizeRuntimeProfileName(typeof value === 'string' ? value : '')
        if (!VALID_HERMES_PROFILE_VALUES.has(profileKey) || !runtimeProfileName) return []
        if (runtimeProfileName === 'default') return []
        return [[profileKey, runtimeProfileName]]
      }),
    )
  } catch {
    return {}
  }
}

export function stringifyHermesRuntimeProfileBindings(bindings: Record<string, string>): string {
  const entries = Object.entries(bindings)
    .flatMap(([profile, runtimeProfileName]) => {
      const profileKey = normalizePersonaKey(profile)
      const runtimeName = normalizeRuntimeProfileName(runtimeProfileName)
      if (!VALID_HERMES_PROFILE_VALUES.has(profileKey) || runtimeName === 'default') return []
      return [[profileKey, runtimeName] as const]
    })
    .sort(([a], [b]) => a.localeCompare(b))

  return JSON.stringify(Object.fromEntries(entries), null, 2)
}
