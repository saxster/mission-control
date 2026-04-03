import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/cron/anomalies - List recent cron output anomalies
 *
 * Query params:
 *   job_id: filter by job ID
 *   severity: 'warning' | 'critical'
 *   limit: max rows (default 50)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const url = new URL(request.url)
  const jobId = url.searchParams.get('job_id')
  const severity = url.searchParams.get('severity')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)

  // Anomalies are stored as alert_rules evaluations or in a dedicated table
  // For now, we read from the notifications table where source_type = 'cron_anomaly'
  try {
    const clauses: string[] = ["source_type = 'cron_anomaly'"]
    const params: (string | number)[] = []

    if (jobId) {
      clauses.push("JSON_EXTRACT(metadata, '$.job_id') = ?")
      params.push(jobId)
    }
    if (severity) {
      clauses.push("JSON_EXTRACT(metadata, '$.max_severity') = ?")
      params.push(severity)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(limit)

    const anomalies = db
      .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Record<string, unknown>[]

    return NextResponse.json({ anomalies })
  } catch {
    // Table might not exist yet — return empty
    return NextResponse.json({ anomalies: [] })
  }
}

/**
 * POST /api/cron/anomalies - Receive anomaly report from hermes-agent
 *
 * Body: { job_id, job_name, anomalies: [...], max_severity, timestamp }
 */
export async function POST(request: NextRequest) {
  // Accept from API key auth (hermes-agent) or operator role
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { job_id, job_name, anomalies, max_severity, timestamp } = body as {
    job_id?: string
    job_name?: string
    anomalies?: unknown[]
    max_severity?: string
    timestamp?: string
  }

  if (!job_id || !anomalies || !Array.isArray(anomalies)) {
    return NextResponse.json({ error: 'job_id and anomalies[] are required' }, { status: 400 })
  }

  const anomalySummary = (anomalies as { field: string; z_score: number }[])
    .map(a => `${a.field} (z=${a.z_score?.toFixed(1)})`)
    .join(', ')

  try {
    // Store as notification for dashboard visibility
    db.prepare(`
      INSERT INTO notifications (recipient, type, title, message, source_type, metadata)
      VALUES ('system', 'alert', ?, ?, 'cron_anomaly', ?)
    `).run(
      `Cron Anomaly: ${job_name || job_id}`,
      `${max_severity?.toUpperCase() || 'WARNING'}: ${anomalySummary}`,
      JSON.stringify({ job_id, job_name, anomalies, max_severity, timestamp })
    )

    return NextResponse.json({ received: true, anomaly_count: anomalies.length }, { status: 201 })
  } catch (err: unknown) {
    // notifications table might not exist — that's OK
    const message = err instanceof Error ? err.message : 'Failed to store anomaly'
    return NextResponse.json({ received: false, error: message }, { status: 500 })
  }
}
