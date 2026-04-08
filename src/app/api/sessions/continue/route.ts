import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, db_helpers } from '@/lib/db'
import { HERMES_ROUTING_BINDINGS_SETTING_KEY, parseHermesRoutingBindings, resolveHermesBindingForSource, resolveHermesSourceLabel } from '@/lib/hermes-routing'
import {
  HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY,
  parseHermesRuntimeProfileBindings,
  resolveHermesRuntimeBindingForSource,
  resolveHermesRuntimeProfileForPersona,
} from '@/lib/hermes-runtime-profiles'
import { scanHermesSessions } from '@/lib/hermes-sessions'
import { logger } from '@/lib/logger'
import { runCommand } from '@/lib/command'
import { getEffectiveEnvValue } from '@/lib/runtime-env'

type ContinueKind = 'claude-code' | 'codex-cli' | 'hermes'

function sanitizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function continueHermesSession(
  sessionId: string,
  prompt: string,
  hermesEnvPath: string,
): Promise<{ reply: string; returnedSessionId: string }> {
  const [host, portRaw, apiKey] = await Promise.all([
    getEffectiveEnvValue('API_SERVER_HOST', { envFilePath: hermesEnvPath }),
    getEffectiveEnvValue('API_SERVER_PORT', { envFilePath: hermesEnvPath }),
    getEffectiveEnvValue('API_SERVER_KEY', { envFilePath: hermesEnvPath }),
  ])

  const gatewayHost = host || '127.0.0.1'
  const gatewayPort = Number.parseInt(portRaw || '8642', 10)
  const baseUrl = `http://${gatewayHost}:${Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : 8642}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Hermes-Session-Id': sessionId,
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: 'hermes-agent',
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => '')
    return { error: { message: text || 'Hermes gateway returned an invalid response.' } }
  })

  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Hermes gateway request failed with status ${response.status}`
    throw new Error(message)
  }

  const reply = typeof payload?.choices?.[0]?.message?.content === 'string'
    ? payload.choices[0].message.content.trim()
    : ''
  const returnedSessionId = response.headers.get('X-Hermes-Session-Id')?.trim() || sessionId

  return {
    reply: reply || 'Session continued, but no text response was returned.',
    returnedSessionId,
  }
}

/**
 * POST /api/sessions/continue
 * Body: { kind: 'claude-code'|'codex-cli'|'hermes', id: string, prompt: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const kind = body?.kind as ContinueKind
    const sessionId = typeof body?.id === 'string' ? body.id.trim() : ''
    const prompt = sanitizePrompt(body?.prompt)

    if (!sessionId || !/^[a-zA-Z0-9._:-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }
    if (kind !== 'claude-code' && kind !== 'codex-cli' && kind !== 'hermes') {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (!prompt || prompt.length > 6000) {
      return NextResponse.json({ error: 'prompt is required (max 6000 chars)' }, { status: 400 })
    }

    let reply = ''
    let profile: string | null = null
    let profileLabel: string | null = null
    let source: string | null = null
    let sourceLabel: string | null = null
    let resolvedSessionId = sessionId

    if (kind === 'claude-code') {
      const result = await runCommand('claude', ['--print', '--resume', sessionId, prompt], {
        timeoutMs: 180000,
      })
      reply = (result.stdout || '').trim() || (result.stderr || '').trim()
    } else if (kind === 'codex-cli') {
      const outputPath = path.join('/tmp', `mc-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
      try {
        await runCommand('codex', ['exec', 'resume', sessionId, prompt, '--skip-git-repo-check', '-o', outputPath], {
          timeoutMs: 180000,
        })
      } finally {
        // Read after run attempt either way for best-effort output
      }

      try {
        reply = (await fs.readFile(outputPath, 'utf-8')).trim()
      } catch {
        reply = ''
      }

      try {
        await fs.unlink(outputPath)
      } catch {
        // ignore
      }
    } else {
      const db = getDatabase()
      const settingsStmt = db.prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
      const bindings = parseHermesRoutingBindings(
        (settingsStmt.get(HERMES_ROUTING_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
      )
      const runtimeBindings = parseHermesRuntimeProfileBindings(
        (settingsStmt.get(HERMES_RUNTIME_PROFILE_BINDINGS_SETTING_KEY) as { value?: string } | undefined)?.value,
      )
      const session = scanHermesSessions(200).find((entry) => entry.sessionId === sessionId)
      const runtimeBinding = session
        ? resolveHermesRuntimeBindingForSource(session.source || 'cli', bindings, runtimeBindings)
        : (() => {
            const fallbackBinding = resolveHermesBindingForSource('cli', bindings)
            const runtimeProfile = resolveHermesRuntimeProfileForPersona(fallbackBinding.profile, runtimeBindings)
            return {
              ...fallbackBinding,
              sourceLabel: resolveHermesSourceLabel(fallbackBinding.sourceKey),
              runtimeProfileName: runtimeProfile.name,
              runtimeProfileLabel: runtimeProfile.label,
              runtimeProfileHome: runtimeProfile.hermesHome,
              runtimeProfileEnvPath: runtimeProfile.envPath,
              runtimeProfileExists: runtimeProfile.exists,
            }
          })()
      const result = await continueHermesSession(sessionId, prompt, runtimeBinding.runtimeProfileEnvPath)
      reply = result.reply
      resolvedSessionId = result.returnedSessionId
      source = runtimeBinding.sourceKey
      sourceLabel = runtimeBinding.sourceLabel
      profile = runtimeBinding.profile
      profileLabel = runtimeBinding.profileLabel

      db_helpers.logActivity(
        'hermes_session_continued',
        'agent',
        0,
        auth.user.username || 'operator',
        `Continued ${runtimeBinding.profileBadge} Hermes session from ${sourceLabel}`,
        {
          session_id: resolvedSessionId,
          source,
          sourceLabel,
          profile,
          profileLabel,
          runtimeProfileName: runtimeBinding.runtimeProfileName,
          runtimeProfileLabel: runtimeBinding.runtimeProfileLabel,
          kind,
        },
        auth.user.workspace_id ?? 1,
      )
    }

    if (!reply) {
      reply = 'Session continued, but no text response was returned.'
    }

    return NextResponse.json({
      ok: true,
      reply,
      sessionId: resolvedSessionId,
      profile,
      profileLabel,
      source,
      sourceLabel,
    })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/sessions/continue error')
    return NextResponse.json({ error: error?.message || 'Failed to continue session' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
