import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getEffectiveEnvValue } from '@/lib/runtime-env'
import { logger } from '@/lib/logger'

async function getGatewayBaseUrl(): Promise<string> {
  const host = await getEffectiveEnvValue('API_SERVER_HOST')
  const portRaw = await getEffectiveEnvValue('API_SERVER_PORT')
  const gatewayHost = host || '127.0.0.1'
  const gatewayPort = Number.parseInt(portRaw || '8642', 10)
  return `http://${gatewayHost}:${Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : 8642}`
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const apiKey = await getEffectiveEnvValue('API_SERVER_KEY')
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

/**
 * GET /api/media/bundles
 * Proxies to the Hermes gateway: GET /v1/media/bundles
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const baseUrl = await getGatewayBaseUrl()
    const headers = await getAuthHeaders()

    const response = await fetch(`${baseUrl}/v1/media/bundles`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })

    const payload = await response.json().catch(() => ({ error: 'Invalid response from gateway' }))

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status })
    }

    return NextResponse.json(payload)
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/media/bundles error')
    return NextResponse.json({ error: error?.message || 'Failed to list bundles' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
