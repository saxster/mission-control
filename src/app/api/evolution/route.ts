import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'

interface EvolutionRun {
  id: number
  target_type: string
  target_name: string
  baseline_fitness: number | null
  evolved_fitness: number | null
  improvement_pct: number | null
  iterations: number | null
  optimizer_model: string | null
  eval_model: string | null
  status: string
  config: string | null
  lineage: string | null
  created_at: number
  completed_at: number | null
}

/**
 * GET /api/evolution - List evolution runs with optional filters
 *
 * Query params:
 *   target_type: 'skill' | 'tool_desc' | 'prompt' | 'code'
 *   target_name: filter by target name
 *   status: 'running' | 'completed' | 'failed' | 'rejected'
 *   limit: max rows (default 50)
 *   offset: pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const url = new URL(request.url)
  const targetType = url.searchParams.get('target_type')
  const targetName = url.searchParams.get('target_name')
  const status = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0')

  const clauses: string[] = []
  const params: (string | number)[] = []

  if (targetType) {
    clauses.push('target_type = ?')
    params.push(targetType)
  }
  if (targetName) {
    clauses.push('target_name = ?')
    params.push(targetName)
  }
  if (status) {
    clauses.push('status = ?')
    params.push(status)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  params.push(limit, offset)

  try {
    const runs = db
      .prepare(`SELECT * FROM evolution_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params) as EvolutionRun[]

    const total = (db
      .prepare(`SELECT COUNT(*) as count FROM evolution_runs ${where}`)
      .get(...params.slice(0, -2)) as { count: number })?.count ?? 0

    return NextResponse.json({ runs, total })
  } catch {
    return NextResponse.json({ runs: [], total: 0 })
  }
}

/**
 * POST /api/evolution - Create a new evolution run record
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const db = getDatabase()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { target_type, target_name, iterations, optimizer_model, eval_model, config } = body as {
    target_type?: string
    target_name?: string
    iterations?: number
    optimizer_model?: string
    eval_model?: string
    config?: Record<string, unknown>
  }

  if (!target_type || !target_name) {
    return NextResponse.json({ error: 'target_type and target_name are required' }, { status: 400 })
  }

  const validTypes = ['skill', 'tool_desc', 'prompt', 'code']
  if (!validTypes.includes(target_type)) {
    return NextResponse.json({ error: `target_type must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  try {
    const result = db.prepare(`
      INSERT INTO evolution_runs (target_type, target_name, iterations, optimizer_model, eval_model, config, status)
      VALUES (?, ?, ?, ?, ?, ?, 'running')
    `).run(
      target_type,
      target_name,
      iterations ?? null,
      optimizer_model ?? null,
      eval_model ?? null,
      config ? JSON.stringify(config) : null
    )

    const run = db
      .prepare('SELECT * FROM evolution_runs WHERE id = ?')
      .get(result.lastInsertRowid) as EvolutionRun

    return NextResponse.json({ run }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create evolution run'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
