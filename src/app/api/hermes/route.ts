import { NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getHermesCommandContext, loadHermesBootstrapData, resolveHermesBinary } from '@/lib/hermes-bootstrap'
import {
  buildHermesRoutingSummary,
  HERMES_ROUTING_BINDINGS_SETTING_KEY,
  parseHermesRoutingBindings,
  resolveHermesProfileLabel,
} from '@/lib/hermes-routing'
import {
  buildHermesRuntimeBindingTargets,
  discoverHermesRuntimeProfiles,
  HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY,
  isHermesRuntimeSplitActive,
  listHermesRuntimeProfilesForPersonas,
  parseHermesRuntimeProfileBindings,
  resolveHermesRuntimeProfileByName,
  resolveHermesRuntimeBindingForSource,
} from '@/lib/hermes-runtime-profiles'
import { hasHermesCliBinary, isHermesInstalled, isHermesGatewayRunning, scanHermesSessions } from '@/lib/hermes-sessions'
import { getHermesTasks } from '@/lib/hermes-tasks'
import { getHermesMemory } from '@/lib/hermes-memory'
import { logger } from '@/lib/logger'

const hermesCommandContext = getHermesCommandContext()

function getHermesActionContext(runtimeProfileName?: string | null) {
  const runtimeProfiles = discoverHermesRuntimeProfiles()
  const selectedRuntimeProfile = resolveHermesRuntimeProfileByName(runtimeProfileName, runtimeProfiles)
  return {
    runtimeProfiles,
    selectedRuntimeProfile,
    commandContext: {
      ...hermesCommandContext,
      hermesHome: selectedRuntimeProfile.hermesHome,
    },
    hookDir: join(selectedRuntimeProfile.hermesHome, 'hooks', 'mission-control'),
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const forceTaskRefresh = request.nextUrl.searchParams.get('refresh') === 'tasks'
    const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
    const installed = isHermesInstalled()
    const cliAvailable = hasHermesCliBinary()
    const actionContext = getHermesActionContext(runtimeProfileName)
    const hookInstalled = existsSync(join(actionContext.hookDir, 'HOOK.yaml'))
    const storedBindingsStmt = getDatabase().prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
    const routingBindings = parseHermesRoutingBindings(
      (storedBindingsStmt.get(HERMES_ROUTING_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
    )
    const runtimeProfileBindings = parseHermesRuntimeProfileBindings(
      (storedBindingsStmt.get(HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
    )
    const runtimeProfiles = actionContext.runtimeProfiles
    const selectedRuntimeProfile = actionContext.selectedRuntimeProfile
    const sessionRuntimeProfiles = listHermesRuntimeProfilesForPersonas(
      ['primary', 'personal', 'work', 'automation', 'research'],
      runtimeProfileBindings,
      runtimeProfiles,
    )
    const scopedRuntimeProfiles = runtimeProfileName ? [selectedRuntimeProfile] : sessionRuntimeProfiles
    const gatewayRunning = installed
      ? scopedRuntimeProfiles.some((profile) => isHermesGatewayRunning(profile.hermesHome))
      : false
    const hermesSessions = installed ? scanHermesSessions(50, scopedRuntimeProfiles) : []
    const activeSessions = hermesSessions.filter(s => s.isActive).length

    const cronRuntimeBinding = resolveHermesRuntimeBindingForSource('cron', routingBindings, runtimeProfileBindings, runtimeProfiles)
    const selectedTaskProfile = runtimeProfileName
      ? selectedRuntimeProfile
      : {
          name: cronRuntimeBinding.runtimeProfileName,
          label: cronRuntimeBinding.runtimeProfileLabel,
          description: '',
          hermesHome: cronRuntimeBinding.runtimeProfileHome,
          envPath: cronRuntimeBinding.runtimeProfileEnvPath,
          isDefault: cronRuntimeBinding.runtimeProfileName === 'default',
          exists: cronRuntimeBinding.runtimeProfileExists,
        }
    const taskData = installed ? getHermesTasks(forceTaskRefresh, [selectedTaskProfile]) : {
      cronJobs: [],
      summary: { total: 0, enabled: 0, paused: 0, failing: 0, healthy: 0, scheduled: 0 },
    }
    const cronJobCount = taskData.cronJobs.length
    const memoryEntries = installed ? getHermesMemory(selectedRuntimeProfile.hermesHome).agentMemoryEntries : 0
    const bootstrapData = installed && cliAvailable ? await loadHermesBootstrapData(actionContext.commandContext) : {
      bootstrap: null,
      providerReadiness: null,
      gateway: null,
      messagingPlatforms: [],
      doctor: null,
    }
    const routingSummary = buildHermesRoutingSummary({
      sessions: hermesSessions,
      bindings: routingBindings,
      messagingPlatforms: bootstrapData.messagingPlatforms.map((platform) => ({
        name: typeof platform?.name === 'string' ? platform.name : undefined,
        configured: platform?.configured === true,
      })),
      gateway: bootstrapData.gateway || undefined,
      taskSummary: taskData.summary,
    })
    const runtimeBindingTargets = buildHermesRuntimeBindingTargets(runtimeProfileBindings, runtimeProfiles)

    return NextResponse.json({
      installed,
      cliAvailable,
      gatewayRunning,
      hookInstalled,
      activeSessions,
      cronJobCount,
      memoryEntries,
      hookDir: actionContext.hookDir,
      selectedRuntimeProfile: {
        name: selectedRuntimeProfile.name,
        label: selectedRuntimeProfile.label,
        description: selectedRuntimeProfile.description,
        hermesHome: selectedRuntimeProfile.hermesHome,
        exists: selectedRuntimeProfile.exists,
      },
      bootstrap: bootstrapData.bootstrap,
      providerReadiness: bootstrapData.providerReadiness,
      gateway: bootstrapData.gateway,
      messagingPlatforms: bootstrapData.messagingPlatforms,
      doctor: bootstrapData.doctor,
      routingBindings,
      routingSummary,
      runtimeProfileBindings,
      runtimeProfiles,
      runtimeBindingTargets,
      runtimeSplitActive: isHermesRuntimeSplitActive(runtimeProfileBindings),
      taskSummary: taskData.summary,
      taskHighlights: taskData.cronJobs
        .filter(job => job.lastStatus === 'error' || (job.enabled && job.state !== 'paused'))
        .slice(0, 3)
        .map(job => ({
          id: job.id,
          name: job.name,
          state: job.state,
          enabled: job.enabled,
          schedule: job.schedule,
          nextRunAt: job.nextRunAt,
          lastRunAt: job.lastRunAt,
          lastStatus: job.lastStatus,
          lastError: job.lastError,
          runtimeProfileName: job.runtimeProfileName || selectedTaskProfile.name,
          runtimeProfileLabel: job.runtimeProfileLabel || selectedTaskProfile.label,
        })),
    })
  } catch (err) {
    logger.error({ err }, 'Hermes status check failed')
    return NextResponse.json({ error: 'Failed to check hermes status' }, { status: 500 })
  }
}

function stripAnsiAndControl(input: string): string {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

function extractDeviceAuth(output: string): { cleanOutput: string; deviceUrl: string | null; userCode: string | null } {
  const cleanOutput = stripAnsiAndControl(output).replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const deviceUrl = cleanOutput.match(/https?:\/\/[^\s)]+/i)?.[0] || null
  const userCode =
    cleanOutput.match(/(?:code|user code|device code)\s*[:=]\s*([A-Z0-9-]{4,})/i)?.[1]
    || cleanOutput.match(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/)?.[0]
    || null
  return { cleanOutput, deviceUrl, userCode }
}

function isValidHermesProfileName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value)
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action } = body
    const actionContext = getHermesActionContext(typeof body?.runtimeProfileName === 'string' ? body.runtimeProfileName : null)
    const HERMES_HOME = actionContext.selectedRuntimeProfile.hermesHome
    const HOOK_DIR = actionContext.hookDir
    const commandContext = actionContext.commandContext
    const storedBindingsStmt = getDatabase().prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
    const runtimeProfileBindings = parseHermesRuntimeProfileBindings(
      (storedBindingsStmt.get(HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
    )

    if (action === 'install-hook') {
      if (!isHermesInstalled()) {
        return NextResponse.json({ error: 'Hermes is not installed (~/.hermes/ not found)' }, { status: 400 })
      }

      mkdirSync(HOOK_DIR, { recursive: true })

      // Write HOOK.yaml
      writeFileSync(join(HOOK_DIR, 'HOOK.yaml'), HOOK_YAML, 'utf8')

      // Write handler.py
      writeFileSync(join(HOOK_DIR, 'handler.py'), HANDLER_PY, 'utf8')

      logger.info({ runtimeProfileName: actionContext.selectedRuntimeProfile.name }, 'Installed Mission Control hook for Hermes Agent')
      return NextResponse.json({
        success: true,
        message: 'Hook installed',
        hookDir: HOOK_DIR,
        runtimeProfileName: actionContext.selectedRuntimeProfile.name,
      })
    }

    if (action === 'uninstall-hook') {
      if (existsSync(HOOK_DIR)) {
        rmSync(HOOK_DIR, { recursive: true, force: true })
      }

      logger.info({ runtimeProfileName: actionContext.selectedRuntimeProfile.name }, 'Uninstalled Mission Control hook for Hermes Agent')
      return NextResponse.json({
        success: true,
        message: 'Hook uninstalled',
        runtimeProfileName: actionContext.selectedRuntimeProfile.name,
      })
    }

    if (action === 'set-env') {
      const { key, value } = body
      if (!key || typeof key !== 'string' || !value || typeof value !== 'string') {
        return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
      }
      // Only allow known env var keys
      const ALLOWED_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'NOUS_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']
      if (!ALLOWED_KEYS.includes(key)) {
        return NextResponse.json({ error: `Key must be one of: ${ALLOWED_KEYS.join(', ')}` }, { status: 400 })
      }

      mkdirSync(HERMES_HOME, { recursive: true })
      const envPath = join(HERMES_HOME, '.env')
      let envContent = ''
      try { envContent = require('node:fs').readFileSync(envPath, 'utf8') } catch { /* new file */ }

      // Replace existing key or append
      const regex = new RegExp(`^${key}=.*$`, 'm')
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`)
      } else {
        envContent = envContent.trimEnd() + `\n${key}=${value}\n`
      }

      writeFileSync(envPath, envContent, 'utf8')
      logger.info({ key, runtimeProfileName: actionContext.selectedRuntimeProfile.name }, 'Hermes env var set via setup wizard')
      return NextResponse.json({ success: true, runtimeProfileName: actionContext.selectedRuntimeProfile.name })
    }

    if (action === 'set-soul') {
      const { content } = body
      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'content is required' }, { status: 400 })
      }

      mkdirSync(HERMES_HOME, { recursive: true })
      const soulPath = join(HERMES_HOME, 'SOUL.md')
      writeFileSync(soulPath, content, 'utf8')
      logger.info({ runtimeProfileName: actionContext.selectedRuntimeProfile.name }, 'Hermes SOUL.md updated via setup wizard')
      return NextResponse.json({ success: true, runtimeProfileName: actionContext.selectedRuntimeProfile.name })
    }

    if (action === 'run-oauth-model') {
      const { model, provider, authMethod } = body
      const bin = resolveHermesBinary(commandContext)
      const HOME_DIR = commandContext.homeDir
      const baseEnv = {
        ...process.env,
        HOME: HOME_DIR,
        HERMES_HOME: HERMES_HOME,
        PATH: `${commandContext.pathPrefix}:${process.env.PATH || ''}`,
      }

      try {
        const { runCommand } = await import('@/lib/command')

        const requestedProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : 'openai-codex'
        const providerForOAuth = requestedProvider === 'openai' ? 'openai-codex' : requestedProvider
        const requestedAuthMethod = typeof authMethod === 'string' ? authMethod.trim().toLowerCase() : 'device_code'
        if (requestedAuthMethod !== 'device_code') {
          return NextResponse.json({ success: false, error: `Unsupported OAuth auth method: ${requestedAuthMethod}` }, { status: 400 })
        }

        // Ensure provider/model are preselected before invoking device-code auth.
        await runCommand(bin, ['config', 'set', 'model.provider', providerForOAuth], {
          timeoutMs: 15_000,
          env: {
            ...baseEnv,
            HERMES_NONINTERACTIVE: '1',
            CI: '1',
          },
        })

        if (typeof model === 'string' && model.trim()) {
          await runCommand(bin, ['config', 'set', 'model.default', model.trim()], {
            timeoutMs: 15_000,
            env: {
              ...baseEnv,
              HERMES_NONINTERACTIVE: '1',
              CI: '1',
            },
          })
        }

        // Run OAuth/device-code flow inside a PTY so interactive prompts/device codes are emitted.
        const nodePty = await import('node-pty')
        const ptySpawn = nodePty.spawn || (nodePty as any).default?.spawn
        if (!ptySpawn) throw new Error('node-pty spawn unavailable')

        const oauthResult: { code: number; output: string } = await new Promise((resolve) => {
          let output = ''
          let done = false

          const pty = ptySpawn(bin, ['model'], {
            name: 'xterm-256color',
            cols: 120,
            rows: 30,
            cwd: HOME_DIR || process.cwd(),
            env: {
              ...baseEnv,
              TERM: 'xterm-256color',
            } as Record<string, string>,
          })

          const autoInputDelays = [250, 900, 1800]
          autoInputDelays.forEach((delayMs) => {
            setTimeout(() => {
              if (done) return
              try { pty.write('\r') } catch { /* ignore */ }
            }, delayMs)
          })

          const timeout = setTimeout(() => {
            if (done) return
            done = true
            try { pty.kill() } catch { /* ignore */ }
            resolve({ code: 124, output: output.trim() })
          }, 300_000)

          pty.onData((data: string) => {
            output += data
            if (output.length > 50_000) output = output.slice(-50_000)
          })

          pty.onExit(({ exitCode }: { exitCode: number }) => {
            if (done) return
            done = true
            clearTimeout(timeout)
            resolve({ code: exitCode ?? 1, output: output.trim() })
          })
        })

        const parsed = extractDeviceAuth(oauthResult.output)
        const success = oauthResult.code === 0

        return NextResponse.json({
          success,
          output: parsed.cleanOutput || (success ? 'Authentication complete.' : ''),
          code: oauthResult.code,
          deviceUrl: parsed.deviceUrl,
          userCode: parsed.userCode,
        })
      } catch (err: any) {
        const parsed = extractDeviceAuth((err?.stdout || '') + '\n' + (err?.stderr || ''))
        return NextResponse.json({
          success: false,
          error: err?.message || 'OAuth command failed',
          output: parsed.cleanOutput,
          deviceUrl: parsed.deviceUrl,
          userCode: parsed.userCode,
        })
      }
    }

    if (action === 'run-command') {
      const { command } = body
      if (!command || typeof command !== 'string') {
        return NextResponse.json({ error: 'command is required' }, { status: 400 })
      }

      // Only allow hermes commands for security
      const trimmed = command.trim()
      if (!trimmed.startsWith('hermes')) {
        return NextResponse.json({ error: 'Only hermes commands are allowed' }, { status: 400 })
      }

      // Parse command into binary + args
      const parts = trimmed.split(/\s+/)
      const bin = resolveHermesBinary(commandContext)
      const args = parts.slice(1)

      // Add --non-interactive flags for commands that might prompt
      const env = {
        ...process.env,
        HOME: commandContext.homeDir,
        HERMES_HOME: HERMES_HOME,
        HERMES_NONINTERACTIVE: '1',
        CI: '1',
        PATH: `${commandContext.pathPrefix}:${process.env.PATH || ''}`,
      }

      try {
        const { runCommand } = await import('@/lib/command')
        const result = await runCommand(bin, args, {
          timeoutMs: 30_000,
          env,
        })
        return NextResponse.json({
          success: result.code === 0,
          output: (result.stdout + '\n' + result.stderr).trim(),
          code: result.code,
        })
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: err?.message || 'Command failed',
          output: (err?.stdout || '') + '\n' + (err?.stderr || ''),
        })
      }
    }

    if (action === 'create-profile') {
      if (!hasHermesCliBinary()) {
        return NextResponse.json({ error: 'Hermes CLI is required to create runtime profiles.' }, { status: 400 })
      }

      const profileName = typeof body?.profileName === 'string' ? body.profileName.trim().toLowerCase() : ''
      const cloneMode = body?.cloneMode === 'clone' ? 'clone' : 'blank'
      const cloneFromProfileName = typeof body?.cloneFromProfileName === 'string' ? body.cloneFromProfileName.trim().toLowerCase() : 'default'

      if (!profileName) {
        return NextResponse.json({ error: 'profileName is required' }, { status: 400 })
      }
      if (profileName === 'default') {
        return NextResponse.json({ error: 'The default Hermes profile already exists.' }, { status: 400 })
      }
      if (!isValidHermesProfileName(profileName)) {
        return NextResponse.json({ error: 'Profile names must use lowercase letters, numbers, or dashes.' }, { status: 400 })
      }
      if (actionContext.runtimeProfiles.some((profile) => profile.name === profileName && profile.exists)) {
        return NextResponse.json({ error: `Hermes runtime profile "${profileName}" already exists.` }, { status: 400 })
      }
      if (cloneMode === 'clone' && !actionContext.runtimeProfiles.some((profile) => profile.name === cloneFromProfileName && profile.exists)) {
        return NextResponse.json({ error: `Clone source profile "${cloneFromProfileName}" was not found.` }, { status: 400 })
      }

      const profileCommandContext = {
        ...hermesCommandContext,
        hermesHome: hermesCommandContext.hermesHome,
      }
      const bin = resolveHermesBinary(profileCommandContext)
      const args = ['profile', 'create', profileName, '--no-alias']
      if (cloneMode === 'clone') {
        args.push('--clone', '--clone-from', cloneFromProfileName || 'default')
      }

      try {
        const { runCommand } = await import('@/lib/command')
        const result = await runCommand(bin, args, {
          timeoutMs: 30_000,
          env: {
            ...process.env,
            HOME: profileCommandContext.homeDir,
            HERMES_HOME: profileCommandContext.hermesHome,
            HERMES_NONINTERACTIVE: '1',
            CI: '1',
            PATH: `${profileCommandContext.pathPrefix}:${process.env.PATH || ''}`,
          },
        })
        if (result.code !== 0) {
          return NextResponse.json({
            success: false,
            error: `Hermes could not create runtime profile "${profileName}".`,
            output: (result.stdout + '\n' + result.stderr).trim(),
          }, { status: 400 })
        }
        const refreshed = getHermesActionContext(profileName)
        return NextResponse.json({
          success: true,
          profileName,
          runtimeProfiles: refreshed.runtimeProfiles,
          selectedRuntimeProfile: {
            name: refreshed.selectedRuntimeProfile.name,
            label: refreshed.selectedRuntimeProfile.label,
            description: refreshed.selectedRuntimeProfile.description,
            hermesHome: refreshed.selectedRuntimeProfile.hermesHome,
            exists: refreshed.selectedRuntimeProfile.exists,
          },
          output: (result.stdout + '\n' + result.stderr).trim(),
        })
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: err?.message || 'Profile creation failed',
          output: ((err?.stdout || '') + '\n' + (err?.stderr || '')).trim(),
        }, { status: 500 })
      }
    }

    if (action === 'delete-profile') {
      if (!hasHermesCliBinary()) {
        return NextResponse.json({ error: 'Hermes CLI is required to delete runtime profiles.' }, { status: 400 })
      }

      const profileName = typeof body?.profileName === 'string' ? body.profileName.trim().toLowerCase() : ''
      if (!profileName) {
        return NextResponse.json({ error: 'profileName is required' }, { status: 400 })
      }
      if (profileName === 'default') {
        return NextResponse.json({ error: 'The default Hermes profile cannot be deleted.' }, { status: 400 })
      }
      if (!isValidHermesProfileName(profileName)) {
        return NextResponse.json({ error: 'Profile names must use lowercase letters, numbers, or dashes.' }, { status: 400 })
      }
      if (!actionContext.runtimeProfiles.some((profile) => profile.name === profileName && profile.exists)) {
        return NextResponse.json({ error: `Hermes runtime profile "${profileName}" does not exist.` }, { status: 404 })
      }
      const boundPersonas = Object.entries(runtimeProfileBindings)
        .filter(([, runtimeProfileName]) => String(runtimeProfileName || '').trim().toLowerCase() === profileName)
        .map(([persona]) => resolveHermesProfileLabel(persona))
      if (boundPersonas.length > 0) {
        return NextResponse.json({
          error: `Hermes runtime profile "${profileName}" is still bound to ${boundPersonas.join(', ')}.`,
        }, { status: 400 })
      }

      const profileCommandContext = {
        ...hermesCommandContext,
        hermesHome: hermesCommandContext.hermesHome,
      }
      const bin = resolveHermesBinary(profileCommandContext)

      try {
        const { runCommand } = await import('@/lib/command')
        const result = await runCommand(bin, ['profile', 'delete', profileName, '--yes'], {
          timeoutMs: 30_000,
          env: {
            ...process.env,
            HOME: profileCommandContext.homeDir,
            HERMES_HOME: profileCommandContext.hermesHome,
            HERMES_NONINTERACTIVE: '1',
            CI: '1',
            PATH: `${profileCommandContext.pathPrefix}:${process.env.PATH || ''}`,
          },
        })
        if (result.code !== 0) {
          return NextResponse.json({
            success: false,
            error: `Hermes could not delete runtime profile "${profileName}".`,
            output: (result.stdout + '\n' + result.stderr).trim(),
          }, { status: 400 })
        }
        const refreshed = getHermesActionContext('default')
        return NextResponse.json({
          success: true,
          profileName,
          runtimeProfiles: refreshed.runtimeProfiles,
          selectedRuntimeProfile: {
            name: refreshed.selectedRuntimeProfile.name,
            label: refreshed.selectedRuntimeProfile.label,
            description: refreshed.selectedRuntimeProfile.description,
            hermesHome: refreshed.selectedRuntimeProfile.hermesHome,
            exists: refreshed.selectedRuntimeProfile.exists,
          },
          output: (result.stdout + '\n' + result.stderr).trim(),
        })
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: err?.message || 'Profile deletion failed',
          output: ((err?.stdout || '') + '\n' + (err?.stderr || '')).trim(),
        }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'Hermes hook management failed')
    return NextResponse.json({ error: err.message || 'Hook operation failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Hook file contents
// ---------------------------------------------------------------------------

const HOOK_YAML = `name: mission-control
description: Reports agent telemetry to Mission Control
version: "1.0"
events:
  - agent:start
  - agent:end
  - session:start
`

const HANDLER_PY = `"""
Mission Control hook for Hermes Agent.
Reports session telemetry to the MC /api/sessions endpoint.

Configuration (via ~/.hermes/.env or environment):
  MC_URL      - Mission Control base URL (default: http://localhost:3000)
  MC_API_KEY  - API key for authentication (optional)
"""

import os
import logging
from datetime import datetime, timezone

logger = logging.getLogger("hooks.mission-control")

MC_URL = os.environ.get("MC_URL", "http://localhost:3000")
MC_API_KEY = os.environ.get("MC_API_KEY", "")


def _headers():
    h = {"Content-Type": "application/json"}
    if MC_API_KEY:
        h["X-Api-Key"] = MC_API_KEY
    return h


async def handle(event_name: str, payload: dict) -> None:
    """
    Called by the Hermes hook registry on matching events.
    Fire-and-forget with a short timeout — never blocks the agent.
    """
    try:
        import httpx
    except ImportError:
        logger.debug("httpx not available, skipping MC telemetry")
        return

    try:
        if event_name == "agent:start":
            await _report_agent_start(payload)
        elif event_name == "agent:end":
            await _report_agent_end(payload)
        elif event_name == "session:start":
            await _report_session_start(payload)
    except Exception as exc:
        logger.debug("MC hook error (%s): %s", event_name, exc)


async def _report_agent_start(payload: dict) -> None:
    import httpx

    data = {
        "name": payload.get("agent_name", "hermes"),
        "role": "Hermes Agent",
        "status": "active",
        "source": "hermes-hook",
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/agents", json=data, headers=_headers())


async def _report_agent_end(payload: dict) -> None:
    import httpx

    data = {
        "name": payload.get("agent_name", "hermes"),
        "status": "idle",
        "source": "hermes-hook",
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/agents", json=data, headers=_headers())


async def _report_session_start(payload: dict) -> None:
    import httpx

    data = {
        "event": "session:start",
        "session_id": payload.get("session_id", ""),
        "source": payload.get("source", "cli"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{MC_URL}/api/hermes/events", json=data, headers=_headers())
`

export const dynamic = 'force-dynamic'
