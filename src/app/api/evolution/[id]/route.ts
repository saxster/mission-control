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
 * GET /api/evolution/[id] - Get a single evolution run with full detail
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const db = getDatabase()

  try {
    const run = db
      .prepare('SELECT * FROM evolution_runs WHERE id = ?')
      .get(parseInt(id)) as EvolutionRun | undefined

    if (!run) {
      return NextResponse.json({ error: 'Evolution run not found' }, { status: 404 })
    }

    return NextResponse.json({ run })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch evolution run'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PATCH /api/evolution/[id] - Update an evolution run (status, fitness scores, lineage)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const { id } = await params
  const db = getDatabase()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const existing = db
    .prepare('SELECT * FROM evolution_runs WHERE id = ?')
    .get(parseInt(id)) as EvolutionRun | undefined

  if (!existing) {
    return NextResponse.json({ error: 'Evolution run not found' }, { status: 404 })
  }

  const allowed = [
    'baseline_fitness', 'evolved_fitness', 'improvement_pct',
    'iterations', 'status', 'lineage', 'completed_at'
  ]
  const sets: string[] = []
  const values: (string | number | null)[] = []

  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = ?`)
      const value = body[key]
      if (key === 'lineage' && typeof value === 'object') {
        values.push(JSON.stringify(value))
      } else {
        values.push(value as string | number | null)
      }
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Auto-set completed_at when status changes to a terminal state
  const newStatus = body.status as string | undefined
  const isTerminal = newStatus === 'completed' || newStatus === 'failed' || newStatus === 'rejected'
  if (isTerminal && !('completed_at' in body)) {
    sets.push('completed_at = (unixepoch())')
  }

  values.push(parseInt(id))

  try {
    db.prepare(`UPDATE evolution_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    const updated = db
      .prepare('SELECT * FROM evolution_runs WHERE id = ?')
      .get(parseInt(id)) as EvolutionRun

    return NextResponse.json({ run: updated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update evolution run'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
