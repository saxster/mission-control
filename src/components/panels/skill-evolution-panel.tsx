'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'

// ── Types ──────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

const STATUS_COLORS: Record<string, string> = {
  running: '#FFBB28',
  completed: '#00C49F',
  failed: '#FF8042',
  rejected: '#ff6b6b',
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatPct(value: number | null): string {
  if (value == null) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

// ── Component ──────────────────────────────────────────

export default function SkillEvolutionPanel() {
  const [runs, setRuns] = useState<EvolutionRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<EvolutionRun | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const fetchRuns = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (typeFilter !== 'all') params.set('target_type', typeFilter)

      const res = await fetch(`/api/evolution?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRuns(data.runs || [])
      setError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [typeFilter])

  useEffect(() => {
    fetchRuns()
    const interval = setInterval(fetchRuns, 30_000)
    return () => clearInterval(interval)
  }, [fetchRuns])

  // ── Summary stats ──────────────────────────────────

  const completedRuns = runs.filter(r => r.status === 'completed')
  const totalRuns = runs.length
  const successRate = totalRuns > 0
    ? ((completedRuns.length / totalRuns) * 100).toFixed(0)
    : '0'
  const avgImprovement = completedRuns.length > 0
    ? completedRuns.reduce((sum, r) => sum + (r.improvement_pct || 0), 0) / completedRuns.length
    : 0

  // ── Chart data: fitness over time ──────────────────

  const fitnessOverTime = completedRuns
    .filter(r => r.baseline_fitness != null && r.evolved_fitness != null)
    .sort((a, b) => a.created_at - b.created_at)
    .map(r => ({
      date: formatDate(r.created_at),
      baseline: r.baseline_fitness,
      evolved: r.evolved_fitness,
      name: r.target_name,
    }))

  // ── Chart data: improvement by target ──────────────

  const improvementByTarget: Record<string, { name: string; improvement: number; count: number }> = {}
  for (const run of completedRuns) {
    if (run.improvement_pct == null) continue
    const key = run.target_name
    if (!improvementByTarget[key]) {
      improvementByTarget[key] = { name: key, improvement: 0, count: 0 }
    }
    improvementByTarget[key].improvement += run.improvement_pct
    improvementByTarget[key].count += 1
  }
  const barData = Object.values(improvementByTarget).map(t => ({
    name: t.name.length > 20 ? t.name.slice(0, 20) + '...' : t.name,
    avgImprovement: t.count > 0 ? t.improvement / t.count : 0,
    runs: t.count,
  })).sort((a, b) => b.avgImprovement - a.avgImprovement).slice(0, 10)

  // ── Lineage drill-down ──────────────────────────────

  let lineageData: { iteration: number; score: number }[] = []
  if (selectedRun?.lineage) {
    try {
      const parsed = JSON.parse(selectedRun.lineage)
      if (Array.isArray(parsed)) {
        lineageData = parsed.map((score: number, i: number) => ({
          iteration: i + 1,
          score: typeof score === 'number' ? score : 0,
        }))
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Skill Evolution</h2>
        <div className="flex gap-2">
          {['all', 'skill', 'tool_desc', 'prompt', 'code'].map(type => (
            <Button
              key={type}
              variant={typeFilter === type ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter(type)}
            >
              {type === 'all' ? 'All' : type.replace('_', ' ')}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-red-500 text-sm">Error: {error}</div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Total Runs" value={totalRuns.toString()} />
        <SummaryCard label="Success Rate" value={`${successRate}%`} />
        <SummaryCard
          label="Avg Improvement"
          value={formatPct(avgImprovement)}
          positive={avgImprovement > 0}
        />
        <SummaryCard label="Running" value={runs.filter(r => r.status === 'running').length.toString()} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Fitness Over Time */}
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Fitness Over Time</h3>
          {fitnessOverTime.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={fitnessOverTime}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="baseline" stroke="#FF8042" name="Baseline" dot={false} />
                <Line type="monotone" dataKey="evolved" stroke="#00C49F" name="Evolved" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-gray-500 h-[250px] flex items-center justify-center">
              No completed runs yet
            </div>
          )}
        </div>

        {/* Improvement by Target */}
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Avg Improvement by Target</h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val) => typeof val === 'number' ? `${val.toFixed(1)}%` : String(val)} />
                <Bar dataKey="avgImprovement" fill="#0088FE" name="Avg Improvement %" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-gray-500 h-[250px] flex items-center justify-center">
              No improvement data yet
            </div>
          )}
        </div>
      </div>

      {/* Lineage Drill-down */}
      {selectedRun && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">
              Evolution Run #{selectedRun.id}: {selectedRun.target_name}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setSelectedRun(null)}>
              Close
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
            <div><span className="text-gray-500">Type:</span> {selectedRun.target_type}</div>
            <div><span className="text-gray-500">Status:</span>{' '}
              <span style={{ color: STATUS_COLORS[selectedRun.status] || '#888' }}>
                {selectedRun.status}
              </span>
            </div>
            <div><span className="text-gray-500">Baseline:</span> {selectedRun.baseline_fitness?.toFixed(3) ?? '--'}</div>
            <div><span className="text-gray-500">Evolved:</span> {selectedRun.evolved_fitness?.toFixed(3) ?? '--'}</div>
          </div>
          {lineageData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={lineageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="iteration" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#8884d8" name="Fitness" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-gray-500">No iteration data available</div>
          )}
        </div>
      )}

      {/* Runs Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-2 text-left">Target</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-right">Baseline</th>
              <th className="px-4 py-2 text-right">Evolved</th>
              <th className="px-4 py-2 text-right">Change</th>
              <th className="px-4 py-2 text-center">Status</th>
              <th className="px-4 py-2 text-right">Date</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No evolution runs yet. Run `python -m evolution.skills.evolve_skill --skill &lt;name&gt;` to start.
                </td>
              </tr>
            ) : (
              runs.map(run => (
                <tr
                  key={run.id}
                  className="border-t hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  onClick={() => setSelectedRun(run)}
                >
                  <td className="px-4 py-2 font-medium">{run.target_name}</td>
                  <td className="px-4 py-2 text-gray-500">{run.target_type}</td>
                  <td className="px-4 py-2 text-right">{run.baseline_fitness?.toFixed(3) ?? '--'}</td>
                  <td className="px-4 py-2 text-right">{run.evolved_fitness?.toFixed(3) ?? '--'}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={run.improvement_pct != null && run.improvement_pct > 0 ? 'text-green-600' : 'text-red-500'}>
                      {formatPct(run.improvement_pct)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: (STATUS_COLORS[run.status] || '#888') + '20',
                        color: STATUS_COLORS[run.status] || '#888',
                      }}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{formatDate(run.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

function SummaryCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${positive === true ? 'text-green-600' : positive === false ? 'text-red-500' : ''}`}>
        {value}
      </div>
    </div>
  )
}
