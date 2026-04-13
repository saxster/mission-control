function readBudget(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env[name] : undefined
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const missionControlPerformanceBudgets = {
  overviewSessionsFetchMs: readBudget('MC_SESSIONS_FETCH_BUDGET_MS', 120),
  sessionsColdReadMs: readBudget('MC_SESSIONS_COLD_READ_BUDGET_MS', 250),
  firstLazyPanelOpenMs: readBudget('MC_FIRST_LAZY_PANEL_OPEN_BUDGET_MS', 500),
  cachedPanelSwitchMs: readBudget('MC_CACHED_PANEL_SWITCH_BUDGET_MS', 150),
  longTaskMs: readBudget('MC_LONG_TASK_BUDGET_MS', 50),
}

