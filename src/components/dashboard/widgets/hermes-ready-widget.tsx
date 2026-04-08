'use client'

import { Button } from '@/components/ui/button'
import { HermesRouteBindingControl } from '@/components/hermes/hermes-route-binding-control'
import { resolveHermesProfileLabel } from '@/lib/hermes-routing'
import { useHermesRouteBindings } from '@/lib/use-hermes-route-bindings'
import { SignalPill, type DashboardData } from '../widget-primitives'

function toneForReadyState(ready: boolean): 'success' | 'warning' {
  return ready ? 'success' : 'warning'
}

function formatHighlightTime(timestamp: string | null | undefined): string {
  if (!timestamp) return 'n/a'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp
  return parsed.toLocaleString()
}

export function HermesReadyWidget({ data }: { data: DashboardData }) {
  const { hermesStatus, hermesStatusUpdatedAt, navigateToPanel, refreshHermesStatus } = data
  const { bindings: hermesBindings, updateBinding: updateHermesBinding } = useHermesRouteBindings()

  if (!hermesStatus) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h3 className="text-sm font-semibold">Hermes Ready Right Now</h3>
        </div>
        <div className="panel-body space-y-3">
          <p className="text-xs text-muted-foreground">Waiting for local Hermes readiness data.</p>
          <Button variant="outline" size="sm" onClick={() => navigateToPanel('settings')}>
            Open Settings
          </Button>
        </div>
      </div>
    )
  }

  if (!hermesStatus.installed) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h3 className="text-sm font-semibold">Hermes Ready Right Now</h3>
        </div>
        <div className="panel-body space-y-3">
          <p className="text-xs text-muted-foreground">Hermes is not installed on this station yet.</p>
          <Button variant="outline" size="sm" onClick={() => navigateToPanel('settings')}>
            Open Setup
          </Button>
        </div>
      </div>
    )
  }

  const cliAvailable = hermesStatus.cliAvailable !== false
  const configuredChannels = (hermesStatus.messagingPlatforms || []).filter((platform) => platform?.configured)
  const blockers = hermesStatus.bootstrap?.blocking_checks || []
  const nextSteps = hermesStatus.bootstrap?.recommended_next_steps || []
  const doctorIssues = hermesStatus.doctor?.issues || []
  const doctorManualIssues = hermesStatus.doctor?.manualIssues || []
  const oauthReady = Boolean(
    hermesStatus.providerReadiness?.oauth?.nous || hermesStatus.providerReadiness?.oauth?.openai_codex,
  )
  const bootstrapReady = hermesStatus.bootstrap?.ready === true
  const gatewayRunning = hermesStatus.gatewayRunning || hermesStatus.gateway?.runtime_state === 'running'
  const doctorHealthy = hermesStatus.doctor?.summary?.ok === true
  const taskSummary = hermesStatus.taskSummary
  const taskHighlights = hermesStatus.taskHighlights || []
  const routingTargets = (hermesStatus.routingSummary?.bindingTargets || []).slice(0, 3)
  const freshnessLabel = hermesStatusUpdatedAt ? new Date(hermesStatusUpdatedAt).toLocaleTimeString() : 'Just now'
  const bootstrapLabel = cliAvailable
    ? (bootstrapReady ? 'Ready' : `${blockers.length || hermesStatus.bootstrap?.issue_count || 0} blockers`)
    : 'CLI unavailable'
  const doctorLabel = cliAvailable
    ? (doctorHealthy ? 'Healthy' : `${hermesStatus.doctor?.summary?.remaining_issues_count ?? 0} open`)
    : 'CLI unavailable'

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3 className="text-sm font-semibold">Hermes Ready Right Now</h3>
          <p className="text-2xs text-muted-foreground mt-0.5">Bootstrap blockers, runtime state, and channel coverage in one place.</p>
        </div>
        <button
          type="button"
          onClick={refreshHermesStatus}
          className="text-2xs text-blue-300 hover:text-blue-200"
        >
          Refresh
        </button>
      </div>
      <div className="panel-body space-y-3">
        <div className="text-2xs text-muted-foreground">
          Last updated {freshnessLabel}
        </div>
        {!cliAvailable && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
            <div className="text-2xs font-medium text-blue-300">Hermes state detected, but the CLI is unavailable</div>
            <div className="mt-1 text-2xs text-muted-foreground">
              Mission Control can still read cron, memory, and session state from <code>~/.hermes</code>, but bootstrap and doctor checks need a runnable <code>hermes</code> binary on this station.
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <SignalPill
            label="Bootstrap"
            value={bootstrapLabel}
            tone={cliAvailable ? toneForReadyState(bootstrapReady) : 'info'}
          />
          <SignalPill
            label="Gateway"
            value={gatewayRunning ? 'Running' : hermesStatus.gateway?.runtime_state || 'Offline'}
            tone={gatewayRunning ? 'success' : 'warning'}
          />
          <SignalPill
            label="Channels"
            value={configuredChannels.length > 0 ? `${configuredChannels.length} configured` : 'None configured'}
            tone={configuredChannels.length > 0 ? 'success' : 'info'}
          />
          <SignalPill
            label="Doctor"
            value={doctorLabel}
            tone={cliAvailable ? (doctorHealthy ? 'success' : 'warning') : 'info'}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-2xs">
          <div className="rounded-lg border border-border/40 bg-secondary/20 px-2.5 py-2">
            <div className="text-muted-foreground">Provider</div>
            <div className="mt-1 text-foreground font-medium">
              {hermesStatus.providerReadiness?.configured ? 'Configured' : 'Needs setup'}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-secondary/20 px-2.5 py-2">
            <div className="text-muted-foreground">Auth</div>
            <div className="mt-1 text-foreground font-medium">
              {oauthReady ? 'OAuth ready' : hermesStatus.providerReadiness?.env_configured ? 'API keys present' : 'No auth detected'}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-secondary/20 px-2.5 py-2">
            <div className="text-muted-foreground">Sessions</div>
            <div className="mt-1 text-foreground font-medium">
              {hermesStatus.gateway?.session_count ?? hermesStatus.activeSessions ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-secondary/20 px-2.5 py-2">
            <div className="text-muted-foreground">Cron</div>
            <div className="mt-1 text-foreground font-medium">
              {taskSummary?.failing ? `${taskSummary.failing} failing` : `${hermesStatus.cronJobCount ?? 0} jobs`}
            </div>
          </div>
        </div>

        {taskSummary && (
          <div className="grid grid-cols-2 gap-2 text-2xs">
            <div className="rounded-lg border border-border/40 bg-secondary/10 px-2.5 py-2">
              <div className="text-muted-foreground">Scheduled</div>
              <div className="mt-1 text-foreground font-medium">{taskSummary.scheduled}</div>
            </div>
            <div className="rounded-lg border border-border/40 bg-secondary/10 px-2.5 py-2">
              <div className="text-muted-foreground">Healthy runs</div>
              <div className="mt-1 text-foreground font-medium">{taskSummary.healthy}</div>
            </div>
          </div>
        )}

        {routingTargets.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-2xs font-medium text-foreground">Route bindings</div>
                <div className="mt-0.5 text-2xs text-muted-foreground">
                  Adjust the most active Hermes ingress routes directly from overview.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigateToPanel('activity')}
                className="text-2xs text-blue-300 hover:text-blue-200"
              >
                Open Activity
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {routingTargets.map((target) => {
                const currentProfile = hermesBindings[target.key] || target.profile
                const currentProfileLabel = resolveHermesProfileLabel(currentProfile)
                return (
                  <div key={target.key} className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{target.label}</div>
                      <div className="mt-0.5 text-2xs text-muted-foreground">{target.detail}</div>
                      <div className="mt-1 text-2xs text-muted-foreground/70">
                        Current binding: {currentProfileLabel}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        target.status === 'active'
                          ? 'bg-green-500/15 text-green-400'
                          : target.status === 'configured'
                            ? 'bg-blue-500/15 text-blue-300'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {target.status === 'active' ? 'Active' : target.status === 'configured' ? 'Configured' : 'Inactive'}
                    </span>
                  </div>
                  <HermesRouteBindingControl
                    source={target.key}
                    sourceLabel={target.label}
                    profile={currentProfile}
                    onChange={async (payload) => {
                      await updateHermesBinding(payload)
                    }}
                    compact
                  />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {blockers.length > 0 ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="text-2xs font-medium text-amber-300">Blocking right now</div>
            <ul className="mt-1 space-y-1 text-2xs text-muted-foreground">
              {blockers.slice(0, 3).map((blocker) => (
                <li key={blocker.code}>- {blocker.message}</li>
              ))}
            </ul>
          </div>
        ) : !cliAvailable ? (
          <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2">
            <div className="text-2xs font-medium text-foreground">Recommended next</div>
            <ul className="mt-1 space-y-1 text-2xs text-muted-foreground">
              <li>- Install Hermes CLI on this machine to enable bootstrap and doctor checks.</li>
              <li>- Keep using the task board for cron visibility while the CLI is offline.</li>
            </ul>
          </div>
        ) : nextSteps.length > 0 ? (
          <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2">
            <div className="text-2xs font-medium text-foreground">Recommended next</div>
            <ul className="mt-1 space-y-1 text-2xs text-muted-foreground">
              {nextSteps.slice(0, 3).map((step) => (
                <li key={step}>- {step}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {(doctorIssues.length > 0 || doctorManualIssues.length > 0) && (
          <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2">
            <div className="text-2xs font-medium text-foreground">Latest diagnostics</div>
            <ul className="mt-1 space-y-1 text-2xs text-muted-foreground">
              {doctorIssues.slice(0, 2).map((issue) => (
                <li key={issue}>- {issue}</li>
              ))}
              {doctorManualIssues.slice(0, 1).map((issue) => (
                <li key={issue}>- Manual follow-up: {issue}</li>
              ))}
            </ul>
          </div>
        )}

        {taskHighlights.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-secondary/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xs font-medium text-foreground">Task ledger highlights</div>
              <button
                type="button"
                onClick={() => navigateToPanel('tasks')}
                className="text-2xs text-blue-300 hover:text-blue-200"
              >
                Open task board
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {taskHighlights.map((job) => (
                <div key={job.id} className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">{job.name}</div>
                      <div className="mt-1 text-2xs text-muted-foreground">
                        {job.lastStatus === 'error'
                          ? `Last failure: ${formatHighlightTime(job.lastRunAt)}`
                          : `Next run: ${formatHighlightTime(job.nextRunAt)}`}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        job.lastStatus === 'error'
                          ? 'bg-red-500/15 text-red-400'
                          : 'bg-purple-500/15 text-purple-300'
                      }`}
                    >
                      {job.lastStatus === 'error' ? 'Failing' : 'Scheduled'}
                    </span>
                  </div>
                  {job.lastError && (
                    <div className="mt-2 text-2xs text-red-300 break-words">
                      {job.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigateToPanel('settings')}>
            Open Settings
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigateToPanel('gateways')}>
            Open Gateways
          </Button>
        </div>
      </div>
    </div>
  )
}
