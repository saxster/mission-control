import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  HERMES_PROFILE_OPTIONS,
  resolveHermesBindingForSource,
  resolveHermesProfileBadgeLabel,
  resolveHermesProfileLabel,
  resolveHermesProfileValue,
  resolveHermesSourceLabel,
} from './hermes-routing'
import { getHermesCommandContext } from './hermes-bootstrap'
export { HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY, parseHermesRuntimeProfileBindings, stringifyHermesRuntimeProfileBindings } from './hermes-runtime-bindings'

export interface HermesRuntimeProfile {
  name: string
  label: string
  description: string
  hermesHome: string
  envPath: string
  isDefault: boolean
  exists: boolean
}

export interface ResolvedHermesRuntimeBinding {
  sourceKey: string
  sourceLabel: string
  profile: string
  profileLabel: string
  profileBadge: string
  runtimeProfileName: string
  runtimeProfileLabel: string
  runtimeProfileHome: string
  runtimeProfileEnvPath: string
  runtimeProfileExists: boolean
}

function normalizeRuntimeProfileName(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || 'default'
}

function getHermesDefaultHome(): string {
  return getHermesCommandContext().hermesHome
}

function getHermesProfilePath(name: string): string {
  const normalized = normalizeRuntimeProfileName(name)
  const defaultHome = getHermesDefaultHome()
  if (normalized === 'default') return defaultHome
  return join(defaultHome, 'profiles', normalized)
}

function createRuntimeProfile(name: string, exists = existsSync(getHermesProfilePath(name))): HermesRuntimeProfile {
  const normalized = normalizeRuntimeProfileName(name)
  const hermesHome = getHermesProfilePath(normalized)
  const isDefault = normalized === 'default'
  return {
    name: normalized,
    label: normalized,
    description: isDefault ? `Default Hermes home (${hermesHome})` : `Named Hermes profile (${hermesHome})`,
    hermesHome,
    envPath: join(hermesHome, '.env'),
    isDefault,
    exists,
  }
}

export function discoverHermesRuntimeProfiles(): HermesRuntimeProfile[] {
  const profiles = new Map<string, HermesRuntimeProfile>()
  const defaultProfile = createRuntimeProfile('default')
  profiles.set(defaultProfile.name, defaultProfile)

  const profilesRoot = join(defaultProfile.hermesHome, 'profiles')
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const profile = createRuntimeProfile(entry.name, true)
      profiles.set(profile.name, profile)
    }
  }

  return Array.from(profiles.values()).sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function resolveHermesRuntimeProfileForPersona(
  profile: string | null | undefined,
  runtimeBindings: Record<string, string> = {},
  runtimeProfiles: HermesRuntimeProfile[] = discoverHermesRuntimeProfiles(),
): HermesRuntimeProfile {
  const profileKey = resolveHermesProfileValue(profile)
  const runtimeProfileName = normalizeRuntimeProfileName(runtimeBindings[profileKey])
  return runtimeProfiles.find((runtimeProfile) => runtimeProfile.name === runtimeProfileName)
    || createRuntimeProfile(runtimeProfileName)
}

export function resolveHermesRuntimeProfileByName(
  runtimeProfileName: string | null | undefined,
  runtimeProfiles: HermesRuntimeProfile[] = discoverHermesRuntimeProfiles(),
): HermesRuntimeProfile {
  const normalized = normalizeRuntimeProfileName(runtimeProfileName)
  return runtimeProfiles.find((runtimeProfile) => runtimeProfile.name === normalized)
    || createRuntimeProfile(normalized)
}

export function resolveHermesRuntimeBindingForSource(
  source: string | null | undefined,
  sourceBindings: Record<string, string> = {},
  runtimeBindings: Record<string, string> = {},
  runtimeProfiles: HermesRuntimeProfile[] = discoverHermesRuntimeProfiles(),
): ResolvedHermesRuntimeBinding {
  const binding = resolveHermesBindingForSource(source, sourceBindings)
  const runtimeProfile = resolveHermesRuntimeProfileForPersona(binding.profile, runtimeBindings, runtimeProfiles)
  return {
    ...binding,
    sourceLabel: resolveHermesSourceLabel(binding.sourceKey),
    runtimeProfileName: runtimeProfile.name,
    runtimeProfileLabel: runtimeProfile.label,
    runtimeProfileHome: runtimeProfile.hermesHome,
    runtimeProfileEnvPath: runtimeProfile.envPath,
    runtimeProfileExists: runtimeProfile.exists,
  }
}

export function listHermesRuntimeProfilesForPersonas(
  personas: Iterable<string>,
  runtimeBindings: Record<string, string> = {},
  runtimeProfiles: HermesRuntimeProfile[] = discoverHermesRuntimeProfiles(),
): HermesRuntimeProfile[] {
  const seen = new Set<string>()
  const resolved: HermesRuntimeProfile[] = []
  for (const persona of personas) {
    const profile = resolveHermesRuntimeProfileForPersona(persona, runtimeBindings, runtimeProfiles)
    if (seen.has(profile.name)) continue
    seen.add(profile.name)
    resolved.push(profile)
  }
  if (resolved.length === 0) {
    resolved.push(resolveHermesRuntimeProfileForPersona('primary', runtimeBindings, runtimeProfiles))
  }
  return resolved
}

export function buildHermesRuntimeBindingTargets(
  runtimeBindings: Record<string, string> = {},
  runtimeProfiles: HermesRuntimeProfile[] = discoverHermesRuntimeProfiles(),
): Array<{
  profile: string
  profileLabel: string
  profileBadge: string
  runtimeProfileName: string
  runtimeProfileLabel: string
  runtimeProfileHome: string
  runtimeProfileExists: boolean
}> {
  return HERMES_PROFILE_OPTIONS.map((option) => {
    const runtimeProfile = resolveHermesRuntimeProfileForPersona(option.value, runtimeBindings, runtimeProfiles)
    return {
      profile: option.value,
      profileLabel: resolveHermesProfileLabel(option.value),
      profileBadge: resolveHermesProfileBadgeLabel(option.value),
      runtimeProfileName: runtimeProfile.name,
      runtimeProfileLabel: runtimeProfile.label,
      runtimeProfileHome: runtimeProfile.hermesHome,
      runtimeProfileExists: runtimeProfile.exists,
    }
  })
}

export function isHermesRuntimeSplitActive(runtimeBindings: Record<string, string> = {}): boolean {
  return Object.values(runtimeBindings).some((value) => normalizeRuntimeProfileName(value) !== 'default')
}
