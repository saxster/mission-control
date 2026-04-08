'use client'

import { useEffect, useRef, useState } from 'react'
import {
  HERMES_PROFILE_OPTIONS,
  resolveHermesProfileValue,
  resolveHermesSourceLabel,
} from '@/lib/hermes-routing'

export function HermesRouteBindingControl({
  source,
  sourceLabel,
  profile,
  onChange,
  compact = false,
}: {
  source: string
  sourceLabel?: string | null
  profile: string
  onChange: (payload: { source: string; profile: string }) => Promise<void>
  compact?: boolean
}) {
  const normalizedProfile = resolveHermesProfileValue(profile)
  const [draft, setDraft] = useState(normalizedProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const savedResetRef = useRef<number | null>(null)

  useEffect(() => {
    setDraft(normalizedProfile)
    setBusy(false)
    setError(null)
    setSaved(false)
  }, [normalizedProfile, source])

  useEffect(() => {
    return () => {
      if (savedResetRef.current) {
        window.clearTimeout(savedResetRef.current)
      }
    }
  }, [])

  const label = sourceLabel || resolveHermesSourceLabel(source)

  const handleChange = async (nextProfile: string) => {
    const resolvedProfile = resolveHermesProfileValue(nextProfile)
    const previousProfile = draft
    setDraft(resolvedProfile)
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await onChange({ source, profile: resolvedProfile })
      setSaved(true)
      if (savedResetRef.current) {
        window.clearTimeout(savedResetRef.current)
      }
      savedResetRef.current = window.setTimeout(() => {
        setSaved(false)
        savedResetRef.current = null
      }, 2000)
    } catch (err) {
      setDraft(previousProfile)
      setError(err instanceof Error ? err.message : 'Failed to update Hermes routing')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-md border border-emerald-500/15 bg-emerald-500/5 ${compact ? 'mt-1.5 px-2 py-1.5' : 'mt-2 px-2.5 py-2'}`}>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
        <span className="font-medium text-emerald-300">Current route profile</span>
        <span className="text-muted-foreground/60">{label}</span>
        <select
          aria-label={`Hermes route profile for ${label}`}
          value={draft}
          disabled={busy}
          onChange={(event) => void handleChange(event.target.value)}
          className={`${compact ? 'h-6 text-[10px]' : 'h-7 text-xs'} rounded border border-border/60 bg-background px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60`}
        >
          {HERMES_PROFILE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {busy && <span className="text-muted-foreground/60">Saving...</span>}
        {!busy && saved && <span className="text-emerald-300/90">Saved</span>}
      </div>
      {error && (
        <p className={`${compact ? 'mt-1 text-[10px]' : 'mt-1 text-xs'} text-amber-300`}>
          {error}
        </p>
      )}
    </div>
  )
}
