import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getKnowledgeBaseMemory } from '@/lib/knowledge-base'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const runtimeProfileName = request.nextUrl.searchParams.get('runtimeProfileName')
  return NextResponse.json(getKnowledgeBaseMemory(runtimeProfileName))
}
