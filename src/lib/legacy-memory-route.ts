import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const LEGACY_MEMORY_API_SUNSET = 'Wed, 01 Jul 2026 00:00:00 GMT'

type LegacyMemoryMetaOptions = {
  canonicalPath?: string
  canonicalBasePath?: string
}

type LegacyMemoryLogOptions = LegacyMemoryMetaOptions & {
  request: NextRequest
  user?: {
    username?: string | null
    role?: string | null
  } | null
  runtimeProfileName?: string | null
  action?: string | null
}

type LegacyMemoryResponseInit = {
  status?: number
  headers?: HeadersInit
}

export function getLegacyMemoryMeta(options: LegacyMemoryMetaOptions) {
  return {
    legacy: true as const,
    deprecated: true as const,
    ...(options.canonicalPath ? { canonicalPath: options.canonicalPath } : {}),
    ...(options.canonicalBasePath ? { canonicalBasePath: options.canonicalBasePath } : {}),
  }
}

export function decorateLegacyMemoryResponse<T extends NextResponse>(
  response: T,
  options: LegacyMemoryMetaOptions,
): T {
  response.headers.set('Deprecation', 'true')
  response.headers.set('Sunset', LEGACY_MEMORY_API_SUNSET)
  response.headers.set('X-Hermes-Legacy-Route', 'memory')

  const successor = options.canonicalPath ?? options.canonicalBasePath
  if (successor) {
    response.headers.set('Link', `<${successor}>; rel="successor-version"`)
  }

  return response
}

export function legacyMemoryJson(
  body: object,
  options: LegacyMemoryMetaOptions,
  init?: LegacyMemoryResponseInit,
) {
  return decorateLegacyMemoryResponse(
    NextResponse.json(
      {
        ...body,
        ...getLegacyMemoryMeta(options),
      },
      init,
    ),
    options,
  )
}

export function logLegacyMemoryRouteHit({
  request,
  user,
  runtimeProfileName,
  action,
  canonicalPath,
  canonicalBasePath,
}: LegacyMemoryLogOptions) {
  if (typeof logger.warn !== 'function') return

  logger.warn(
    {
      route: request.nextUrl.pathname,
      method: request.method,
      query: request.nextUrl.searchParams.toString() || undefined,
      canonicalPath,
      canonicalBasePath,
      runtimeProfileName: runtimeProfileName || undefined,
      action: action || undefined,
      username: user?.username || undefined,
      role: user?.role || undefined,
      deprecatedRoute: 'memory',
    },
    'Deprecated /api/memory route hit',
  )
}
