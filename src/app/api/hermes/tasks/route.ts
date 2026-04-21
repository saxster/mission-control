import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { HERMES_ROUTING_BINDINGS_SETTING_KEY, parseHermesRoutingBindings, resolveHermesBindingForSource } from '@/lib/hermes-routing'
import {
  HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY,
  parseHermesRuntimeProfileBindings,
  resolveHermesRuntimeBindingForSource,
} from '@/lib/hermes-runtime-profiles'
import { getHermesTasks } from '@/lib/hermes-tasks'

/**
 * GET /api/hermes/tasks — Returns Hermes cron jobs
 * Read-only bridge: MC reads from ~/.hermes/cron/
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const force = request.nextUrl.searchParams.get('force') === 'true'
  const settingsStmt = getDatabase().prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
  const bindings = parseHermesRoutingBindings(
    (settingsStmt.get(HERMES_ROUTING_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
  )
  const runtimeBindings = parseHermesRuntimeProfileBindings(
    (settingsStmt.get(HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
  )
  const runtimeBinding = resolveHermesRuntimeBindingForSource('cron', bindings, runtimeBindings)
  const result = getHermesTasks(force, [{
    name: runtimeBinding.runtimeProfileName,
    label: runtimeBinding.runtimeProfileLabel,
    description: '',
    hermesHome: runtimeBinding.runtimeProfileHome,
    envPath: runtimeBinding.runtimeProfileEnvPath,
    isDefault: runtimeBinding.runtimeProfileName === 'default',
    exists: runtimeBinding.runtimeProfileExists,
  }])

  const cronJobs = result.cronJobs.map((job) => {
    const binding = resolveHermesBindingForSource('cron', bindings)
    return {
      ...job,
      profile: binding.profile,
      profileLabel: binding.profileLabel,
      profileBadge: binding.profileBadge,
      runtimeProfileName: job.runtimeProfileName || runtimeBinding.runtimeProfileName,
      runtimeProfileLabel: job.runtimeProfileLabel || runtimeBinding.runtimeProfileLabel,
    }
  })

  return NextResponse.json({
    ...result,
    cronJobs,
  })
}
