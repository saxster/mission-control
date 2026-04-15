'use client'

import { createElement, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NavRail } from '@/components/layout/nav-rail'
import { HeaderBar } from '@/components/layout/header-bar'
import { LiveFeed } from '@/components/layout/live-feed'
import { Dashboard } from '@/components/dashboard/dashboard'
import { AgentCommsPanel } from '@/components/panels/agent-comms-panel'
import { SettingsPanel } from '@/components/panels/settings-panel'
import { ChatPagePanel } from '@/components/panels/chat-page-panel'
import { ChatPanel } from '@/components/chat/chat-panel'
import { getPluginPanel } from '@/lib/plugins'
import { shouldRedirectDashboardToHttps } from '@/lib/browser-security'
import { useTranslations } from 'next-intl'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LocalModeBanner } from '@/components/layout/local-mode-banner'
import { UpdateBanner } from '@/components/layout/update-banner'
import { OpenClawUpdateBanner } from '@/components/layout/openclaw-update-banner'
import { OpenClawDoctorBanner } from '@/components/layout/openclaw-doctor-banner'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { Loader } from '@/components/ui/loader'
import { ExecApprovalOverlay } from '@/components/modals/exec-approval-overlay'
import {
  LazyActivityFeedPanel,
  LazyAgentsPanelContent,
  LazyAlertRulesPanel,
  LazyAuditTrailPanel,
  LazyChannelsPanel,
  LazyCostTrackerPanel,
  LazyCronManagementPanel,
  LazyDebugPanel,
  LazyExecApprovalPanel,
  LazyGatewayConfigPanel,
  LazyGitHubSyncPanel,
  LazyIntegrationsPanel,
  LazyLogViewerPanel,
  LazyKnowledgeBasePanel,
  LazyMultiGatewayPanel,
  LazyNodesPanel,
  LazyNotificationsPanel,
  LazyOfficePanel,
  LazyObsidianIntegrationPanel,
  LazyProjectManagerModal,
  LazySecurityAuditPanel,
  LazySkillEvolutionPanel,
  LazySkillsPanel,
  LazyStandupPanel,
  LazySystemMonitorPanel,
  LazyTaskBoardPanel,
  LazyUserManagementPanel,
  LazyWebhookPanel,
  LazySuperAdminPanel,
  LazyCapabilitiesPanel,
  LazyStudioPanel,
  LazyLibraryPanel,
} from '@/app/panel-registry'
import { useWebSocket } from '@/lib/websocket'
import { useServerEvents } from '@/lib/use-server-events'
import { completeNavigationTiming } from '@/lib/navigation-metrics'
import { panelHref, useNavigateToPanel } from '@/lib/navigation'
import { clearOnboardingDismissedThisSession, clearOnboardingReplayFromStart, getOnboardingSessionDecision, markOnboardingReplayFromStart, readOnboardingDismissedThisSession } from '@/lib/onboarding-session'
import { initMissionControlPerformanceObserver } from '@/lib/performance-monitor'
import {
  emitMissionControlHarnessReady,
  getMissionControlHarnessAttributes,
  isMissionControlHarnessTestMode,
} from '@/lib/mission-control-harness'
import { Button } from '@/components/ui/button'
import { useMissionControlContentRouterState, useMissionControlShellState } from '@/store/selectors'

interface GatewaySummary {
  id: number
  is_primary: number
}

const STEP_KEYS = ['auth', 'capabilities', 'config', 'connect', 'agents', 'sessions', 'projects', 'knowledgeBase', 'skills'] as const

const bootLabelKeys: Record<string, string> = {
  auth: 'authenticatingOperator',
  capabilities: 'detectingStationMode',
  config: 'loadingControlConfig',
  connect: 'connectingRuntimeLinks',
  agents: 'syncingAgentRegistry',
  sessions: 'loadingActiveSessions',
  projects: 'hydratingWorkspaceBoard',
  knowledgeBase: 'mappingKnowledgeBaseGraph',
  skills: 'indexingSkillCatalog',
}

function renderPluginPanel(panelId: string) {
  const pluginPanel = getPluginPanel(panelId)
  return pluginPanel ? createElement(pluginPanel) : <Dashboard />
}

export default function Home() {
  const router = useRouter()
  const { connect } = useWebSocket()
  const tb = useTranslations('boot')
  const tp = useTranslations('page')
  const tc = useTranslations('common')
  const { optimisticPanel, setActiveTab, setOptimisticPanel, setCurrentUser, setDashboardMode, setGatewayAvailable, setLocalSessionsAvailable, setCapabilitiesChecked, setSubscription, setDefaultOrgName, setUpdateAvailable, setOpenclawUpdate, showOnboarding, setShowOnboarding, liveFeedOpen, toggleLiveFeed, showProjectManagerModal, setShowProjectManagerModal, fetchProjects, setChatPanelOpen, bootComplete, setBootComplete, setAgents, setSessions, setProjects, setInterfaceMode, setSkillsData } = useMissionControlShellState()
  const hideHarnessChrome = isMissionControlHarnessTestMode()

  // Sync URL → Zustand activeTab
  const pathname = usePathname()
  const panelFromUrl = pathname === '/' ? 'overview' : pathname.slice(1)
  const normalizedPanel = panelFromUrl === 'sessions'
    ? 'chat'
    : panelFromUrl === 'memory'
      ? 'knowledge-base'
      : panelFromUrl
  const displayPanel = optimisticPanel ?? normalizedPanel

  useEffect(() => {
    setActiveTab(normalizedPanel)
    if (optimisticPanel === normalizedPanel) {
      setOptimisticPanel(null)
    }
    if (normalizedPanel === 'chat') {
      setChatPanelOpen(false)
    }
    if (panelFromUrl === 'sessions') {
      router.replace('/chat')
    } else if (panelFromUrl === 'memory') {
      router.replace('/knowledge-base')
    }
  }, [normalizedPanel, optimisticPanel, panelFromUrl, router, setActiveTab, setChatPanelOpen, setOptimisticPanel])

  // Connect to SSE for real-time local DB events (tasks, agents, chat, etc.)
  useServerEvents()
  const [isClient, setIsClient] = useState(false)
  const [stepStatuses, setStepStatuses] = useState<Record<string, 'pending' | 'done'>>(
    () => Object.fromEntries(STEP_KEYS.map(k => [k, 'pending']))
  )

  const initSteps = useMemo(() =>
    STEP_KEYS.map(key => ({
      key,
      label: tb(bootLabelKeys[key] as Parameters<typeof tb>[0]),
      status: stepStatuses[key] || 'pending' as const,
    })),
    [tb, stepStatuses]
  )

  const markStep = (key: string) => {
    setStepStatuses(prev => ({ ...prev, [key]: 'done' }))
  }

  useEffect(() => {
    if (!bootComplete && initSteps.every(s => s.status === 'done')) {
      setBootComplete()
    }
  }, [initSteps, bootComplete, setBootComplete])

  // Security console warning (anti-self-XSS)
  useEffect(() => {
    if (!bootComplete) return
    if (typeof window === 'undefined') return
    const key = 'mc-console-warning'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')

    console.log(
      '%c  Stop!  ',
      'color: #fff; background: #e53e3e; font-size: 40px; font-weight: bold; padding: 4px 16px; border-radius: 4px;'
    )
    console.log(
      '%cThis is a browser feature intended for developers.\n\nIf someone told you to copy-paste something here to enable a feature or "hack" an account, it is a scam and will give them access to your account.',
      'font-size: 14px; color: #e2e8f0; padding: 8px 0;'
    )
    console.log(
      '%cLearn more: https://en.wikipedia.org/wiki/Self-XSS',
      'font-size: 12px; color: #718096;'
    )
  }, [bootComplete])

  useEffect(() => initMissionControlPerformanceObserver(), [])

  useEffect(() => {
    emitMissionControlHarnessReady({
      pathname,
      activeTab: displayPanel,
      bootComplete,
      showOnboarding,
    })
  }, [pathname, displayPanel, bootComplete, showOnboarding])

  useEffect(() => {
    setIsClient(true)

    if (shouldRedirectDashboardToHttps({
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      forceHttps: process.env.NEXT_PUBLIC_FORCE_HTTPS === '1',
    })) {
      const secureUrl = new URL(window.location.href)
      secureUrl.protocol = 'https:'
      window.location.replace(secureUrl.toString())
      return
    }

    const connectWithEnvFallback = () => {
      const explicitWsUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || ''
      const gatewayPort = process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789'
      const gatewayHost = process.env.NEXT_PUBLIC_GATEWAY_HOST || window.location.hostname
      const gatewayProto =
        process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL ||
        (window.location.protocol === 'https:' ? 'wss' : 'ws')
      const wsUrl = explicitWsUrl || `${gatewayProto}://${gatewayHost}:${gatewayPort}`
      connect(wsUrl)
    }

    const connectWithPrimaryGateway = async (): Promise<{ attempted: boolean; connected: boolean }> => {
      try {
        const gatewaysRes = await fetch('/api/gateways')
        if (!gatewaysRes.ok) return { attempted: false, connected: false }
        const gatewaysJson = await gatewaysRes.json().catch(() => ({}))
        const gateways = Array.isArray(gatewaysJson?.gateways) ? gatewaysJson.gateways as GatewaySummary[] : []
        if (gateways.length === 0) return { attempted: false, connected: false }

        const primaryGateway = gateways.find(gw => Number(gw?.is_primary) === 1) || gateways[0]
        if (!primaryGateway?.id) return { attempted: true, connected: false }

        const connectRes = await fetch('/api/gateways/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: primaryGateway.id }),
        })
        if (!connectRes.ok) return { attempted: true, connected: false }

        const payload = await connectRes.json().catch(() => ({}))
        const wsUrl = typeof payload?.ws_url === 'string' ? payload.ws_url : ''
        const wsToken = typeof payload?.token === 'string' ? payload.token : ''
        if (!wsUrl) return { attempted: true, connected: false }

        connect(wsUrl, wsToken)
        return { attempted: true, connected: true }
      } catch {
        return { attempted: false, connected: false }
      }
    }

    // Fetch current user
    fetch('/api/auth/me')
      .then(async (res) => {
        if (res.ok) return res.json()
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        }
        return null
      })
      .then(data => { if (data?.user) setCurrentUser(data.user); markStep('auth') })
      .catch(() => { markStep('auth') })

    // Check for available updates
    fetch('/api/releases/check')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.updateAvailable) {
          setUpdateAvailable({
            latestVersion: data.latestVersion,
            releaseUrl: data.releaseUrl,
            releaseNotes: data.releaseNotes,
          })
        }
      })
      .catch(() => {})

    // Check for OpenClaw updates
    fetch('/api/openclaw/version')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.updateAvailable) {
          setOpenclawUpdate({
            installed: data.installed,
            latest: data.latest,
            releaseUrl: data.releaseUrl,
            releaseNotes: data.releaseNotes,
            updateCommand: data.updateCommand,
          })
        } else {
          setOpenclawUpdate(null)
        }
      })
      .catch(() => {})

    // Check capabilities, then conditionally connect to gateway
    fetch('/api/status?action=capabilities')
      .then(res => res.ok ? res.json() : null)
      .then(async data => {
        if (data?.subscription) {
          setSubscription(data.subscription)
        }
        if (data?.processUser) {
          setDefaultOrgName(data.processUser)
        }
        if (data?.interfaceMode === 'essential' || data?.interfaceMode === 'full') {
          setInterfaceMode(data.interfaceMode)
        }
        if (data && data.gateway === false) {
          setDashboardMode('local')
          setGatewayAvailable(false)
          setCapabilitiesChecked(true)
          markStep('capabilities')
          markStep('connect')
          // Skip WebSocket connect — no gateway to talk to
          return
        }
        if (data && data.gateway === true) {
          setDashboardMode('full')
          setGatewayAvailable(true)
        }
        if (data?.claudeHome) {
          setLocalSessionsAvailable(true)
        }
        setCapabilitiesChecked(true)
        markStep('capabilities')

        const primaryConnect = await connectWithPrimaryGateway()
        if (!primaryConnect.connected && !primaryConnect.attempted) {
          connectWithEnvFallback()
        }
        markStep('connect')
      })
      .catch(() => {
        // If capabilities check fails, still try to connect
        setCapabilitiesChecked(true)
        markStep('capabilities')
        markStep('connect')
        connectWithEnvFallback()
      })

    // Check onboarding state
    fetch('/api/onboarding')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const decision = getOnboardingSessionDecision({
          isAdmin: data?.isAdmin === true,
          serverShowOnboarding: data?.showOnboarding === true,
          completed: data?.completed === true,
          skipped: data?.skipped === true,
          dismissedThisSession: readOnboardingDismissedThisSession(),
        })

        if (decision.shouldOpen) {
          clearOnboardingDismissedThisSession()
          if (decision.replayFromStart) {
            markOnboardingReplayFromStart()
          } else {
            clearOnboardingReplayFromStart()
          }
          setShowOnboarding(true)
        }
        markStep('config')
      })
      .catch(() => { markStep('config') })
    // Preload workspace data in parallel
    Promise.allSettled([
      fetch('/api/agents')
        .then(r => r.ok ? r.json() : null)
        .then((agentsData) => {
          if (agentsData?.agents) setAgents(agentsData.agents)
        })
        .finally(() => { markStep('agents') }),
      // Sessions can be slow with many JSONL files — don't block boot
      (() => {
        markStep('sessions')
        return fetch('/api/sessions')
          .then(r => r.ok ? r.json() : null)
          .then((sessionsData) => {
            if (sessionsData?.sessions) setSessions(sessionsData.sessions)
          })
      })(),
      fetch('/api/projects')
        .then(r => r.ok ? r.json() : null)
        .then((projectsData) => {
          if (projectsData?.projects) setProjects(projectsData.projects)
        })
        .finally(() => { markStep('projects') }),
      // Knowledge Base graph can be slow — don't block boot
      (() => {
        markStep('knowledgeBase')
        return fetch('/api/knowledge-base/graph')
          .then(r => r.ok ? r.json() : null)
      })(),
      fetch('/api/skills')
        .then(r => r.ok ? r.json() : null)
        .then((skillsData) => {
          if (skillsData?.skills) setSkillsData(skillsData.skills, skillsData.groups || [], skillsData.total || 0)
        })
        .finally(() => { markStep('skills') }),
    ]).catch(() => { /* panels will lazy-load as fallback */ })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount, not on every pathname change
  }, [connect, router, setCurrentUser, setDashboardMode, setGatewayAvailable, setLocalSessionsAvailable, setCapabilitiesChecked, setSubscription, setUpdateAvailable, setShowOnboarding, setAgents, setSessions, setProjects, setInterfaceMode, setSkillsData])

  const harnessAttributes = getMissionControlHarnessAttributes({
    activePanel: displayPanel,
    bootComplete,
    showOnboarding,
  })

  if (!isClient || !bootComplete) {
    return (
      <div {...harnessAttributes}>
        <Loader variant="page" steps={isClient ? initSteps : undefined} />
      </div>
    )
  }

  return (
    <div
      {...harnessAttributes}
      className="flex h-screen bg-background overflow-hidden"
    >
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">
        {tc('skipToMainContent')}
      </a>

      {/* Left: Icon rail navigation (hidden on mobile, shown as bottom bar instead) */}
      {!showOnboarding && <NavRail />}

      {/* Center: Header + Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!showOnboarding && (
          <>
            <HeaderBar />
            {!hideHarnessChrome && <LocalModeBanner />}
            {!hideHarnessChrome && <UpdateBanner />}
            {!hideHarnessChrome && <OpenClawUpdateBanner />}
            {!hideHarnessChrome && <OpenClawDoctorBanner />}
          </>
        )}
        <main
          id="main-content"
          className={`flex-1 overflow-auto pb-16 md:pb-0 ${showOnboarding ? 'pointer-events-none select-none blur-[2px] opacity-30' : ''}`}
          role="main"
          aria-hidden={showOnboarding}
        >
          <div aria-live="polite" className="relative flex flex-col min-h-full">
            <ErrorBoundary>
              <ContentRouter tab={displayPanel} />
            </ErrorBoundary>
          </div>
{/* Footer removed — attribution moved to nav sidebar */}
        </main>
      </div>

      {/* Right: Live feed (hidden on mobile) */}
      {!showOnboarding && liveFeedOpen && (
        <div className="hidden lg:flex h-full">
          <LiveFeed />
        </div>
      )}

      {/* Floating button to reopen LiveFeed when closed */}
      {!showOnboarding && !liveFeedOpen && !hideHarnessChrome && (
        <button
          onClick={toggleLiveFeed}
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 w-6 h-12 items-center justify-center bg-card border border-r-0 border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
          title={tp('showLiveFeed')}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Chat panel overlay */}
      {!showOnboarding && <ChatPanel />}

      {/* Global exec approval overlay (shown regardless of active panel) */}
      {!showOnboarding && <ExecApprovalOverlay />}

      {/* Global Project Manager Modal */}
      {!showOnboarding && showProjectManagerModal && (
        <LazyProjectManagerModal
          onClose={() => setShowProjectManagerModal(false)}
          onChanged={async () => { await fetchProjects() }}
        />
      )}

      <OnboardingWizard />
    </div>
  )
}

const ESSENTIAL_PANELS = new Set([
  'overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings',
])

function KeepAliveLogsPanel({ active }: { active: boolean }) {
  const [hasMountedOnce, setHasMountedOnce] = useState(active)

  useEffect(() => {
    if (active) {
      setHasMountedOnce(true)
    }
  }, [active])

  if (!hasMountedOnce) return null

  return (
    <div
      className={active ? 'h-full' : 'pointer-events-none absolute inset-0 invisible overflow-hidden'}
      aria-hidden={active ? undefined : true}
    >
      <LazyLogViewerPanel active={active} />
    </div>
  )
}

function PanelNavigationCommitMarker({ panel }: { panel: string }) {
  useLayoutEffect(() => {
    completeNavigationTiming(panelHref(panel))
  }, [panel])

  return null
}

function ContentRouter({ tab }: { tab: string }) {
  const tp = useTranslations('page')
  const { dashboardMode, interfaceMode, setInterfaceMode } = useMissionControlContentRouterState()
  const navigateToPanel = useNavigateToPanel()
  const isLocal = dashboardMode === 'local'
  const panelName = tab.replace(/-/g, ' ')
  const showLogsPanel = tab === 'logs'

  // Guard: show nudge for non-essential panels in essential mode
  if (interfaceMode === 'essential' && !ESSENTIAL_PANELS.has(tab)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <p className="text-sm text-muted-foreground">
          {tp('availableInFullMode', { panel: panelName })}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setInterfaceMode('full')
              try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }) }) } catch {}
            }}
          >
            {tp('switchToFull')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToPanel('overview')}
          >
            {tp('goToOverview')}
          </Button>
        </div>
      </div>
    )
  }

  let panelContent: ReactNode

  switch (tab) {
    case 'overview':
      panelContent = (
        <>
          <Dashboard active />
          {!isLocal && (
            <div className="mt-4 mx-4 mb-4 rounded-lg border border-border bg-card overflow-hidden">
              <AgentCommsPanel />
            </div>
          )}
        </>
      )
      break
    case 'tasks':
      panelContent = <LazyTaskBoardPanel />
      break
    case 'agents':
      panelContent = <LazyAgentsPanelContent isLocal={isLocal} />
      break
    case 'notifications':
      panelContent = <LazyNotificationsPanel />
      break
    case 'standup':
      panelContent = <LazyStandupPanel />
      break
    case 'sessions':
      panelContent = <ChatPagePanel />
      break
    case 'logs':
      panelContent = null
      break
    case 'cron':
      panelContent = <LazyCronManagementPanel />
      break
    case 'memory':
      panelContent = <LazyKnowledgeBasePanel />
      break
    case 'knowledge-base':
      panelContent = <LazyKnowledgeBasePanel />
      break
    case 'obsidian':
      panelContent = <LazyObsidianIntegrationPanel />
      break
    case 'cost-tracker':
    case 'tokens':
    case 'agent-costs':
      panelContent = <LazyCostTrackerPanel />
      break
    case 'users':
      panelContent = <LazyUserManagementPanel />
      break
    case 'history':
    case 'activity':
      panelContent = <LazyActivityFeedPanel />
      break
    case 'audit':
      panelContent = <LazyAuditTrailPanel />
      break
    case 'webhooks':
      panelContent = <LazyWebhookPanel />
      break
    case 'alerts':
      panelContent = <LazyAlertRulesPanel />
      break
    case 'evolution':
      panelContent = <LazySkillEvolutionPanel />
      break
    case 'gateways':
      panelContent = isLocal ? <LocalModeUnavailable panel={tab} /> : <LazyMultiGatewayPanel />
      break
    case 'gateway-config':
      panelContent = isLocal ? <LocalModeUnavailable panel={tab} /> : <LazyGatewayConfigPanel />
      break
    case 'integrations':
      panelContent = <LazyIntegrationsPanel />
      break
    case 'settings':
      panelContent = <SettingsPanel />
      break
    case 'super-admin':
      panelContent = <LazySuperAdminPanel />
      break
    case 'github':
      panelContent = <LazyGitHubSyncPanel />
      break
    case 'office':
      panelContent = <LazyOfficePanel />
      break
    case 'monitor':
      panelContent = <LazySystemMonitorPanel />
      break
    case 'skills':
      panelContent = <LazySkillsPanel />
      break
    case 'channels':
      panelContent = isLocal ? <LocalModeUnavailable panel={tab} /> : <LazyChannelsPanel />
      break
    case 'nodes':
      panelContent = isLocal ? <LocalModeUnavailable panel={tab} /> : <LazyNodesPanel />
      break
    case 'security':
      panelContent = <LazySecurityAuditPanel />
      break
    case 'debug':
      panelContent = <LazyDebugPanel />
      break
    case 'exec-approvals':
      panelContent = isLocal ? <LocalModeUnavailable panel={tab} /> : <LazyExecApprovalPanel />
      break
    case 'chat':
      panelContent = <ChatPagePanel />
      break
    case 'capabilities':
      panelContent = <LazyCapabilitiesPanel />
      break
    case 'studio':
      panelContent = <LazyStudioPanel />
      break
    case 'library':
      panelContent = <LazyLibraryPanel />
      break
    default: {
      panelContent = renderPluginPanel(tab)
    }
  }

  return (
    <>
      <PanelNavigationCommitMarker panel={tab} />
      {panelContent}
      <KeepAliveLogsPanel active={showLogsPanel} />
    </>
  )
}

function LocalModeUnavailable({ panel }: { panel: string }) {
  const tp = useTranslations('page')
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-muted-foreground">
        {tp('requiresGateway', { panel })}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {tp('configureGateway')}
      </p>
    </div>
  )
}
