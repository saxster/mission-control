import type { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'

type Role = 'viewer' | 'operator' | 'admin'

export function authenticateObsidianRequest(request: NextRequest, role: Role) {
  const authHeader = request.headers.get('authorization') || ''
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  const expectedToken = process.env.OBSIDIAN_PLUGIN_TOKEN?.trim()

  if (bearerMatch && expectedToken && bearerMatch[1] === expectedToken) {
    return {
      user: {
        username: 'obsidian-plugin',
        role,
      },
      via: 'token' as const,
    }
  }

  const auth = requireRole(request, role)
  if ('error' in auth) return auth
  return {
    user: auth.user,
    via: 'session' as const,
  }
}
