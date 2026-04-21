'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import { Loader } from '@/components/ui/loader'

function panelLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader />
    </div>
  )
}

function lazyNamedPanel<T extends object>(
  loader: () => Promise<Record<string, ComponentType<T>>>,
  exportName: string,
) {
  return dynamic(async () => {
    const loadedModule = await loader()
    return loadedModule[exportName]
  }, { loading: panelLoading })
}

export const LazyAgentsPanelContent = lazyNamedPanel(
  () => import('@/components/panels/agents-panel-content'),
  'AgentsPanelContent',
)
export const LazyTaskBoardPanel = lazyNamedPanel(() => import('@/components/panels/task-board-panel'), 'TaskBoardPanel')
export const LazyNotificationsPanel = lazyNamedPanel(() => import('@/components/panels/notifications-panel'), 'NotificationsPanel')
export const LazyStandupPanel = lazyNamedPanel(() => import('@/components/panels/standup-panel'), 'StandupPanel')
export const LazyLogViewerPanel = lazyNamedPanel(() => import('@/components/panels/log-viewer-panel'), 'LogViewerPanel')
export const LazyCronManagementPanel = lazyNamedPanel(() => import('@/components/panels/cron-management-panel'), 'CronManagementPanel')
export const LazyKnowledgeBasePanel = lazyNamedPanel(() => import('@/components/panels/knowledge-base-panel'), 'KnowledgeBasePanel')
export const LazyObsidianIntegrationPanel = lazyNamedPanel(() => import('@/components/panels/obsidian-integration-panel'), 'ObsidianIntegrationPanel')
export const LazyCostTrackerPanel = lazyNamedPanel(() => import('@/components/panels/cost-tracker-panel'), 'CostTrackerPanel')
export const LazyUserManagementPanel = lazyNamedPanel(() => import('@/components/panels/user-management-panel'), 'UserManagementPanel')
export const LazyActivityFeedPanel = lazyNamedPanel(() => import('@/components/panels/activity-feed-panel'), 'ActivityFeedPanel')
export const LazyAuditTrailPanel = lazyNamedPanel(() => import('@/components/panels/audit-trail-panel'), 'AuditTrailPanel')
export const LazyWebhookPanel = lazyNamedPanel(() => import('@/components/panels/webhook-panel'), 'WebhookPanel')
export const LazyAlertRulesPanel = lazyNamedPanel(() => import('@/components/panels/alert-rules-panel'), 'AlertRulesPanel')
export const LazyMultiGatewayPanel = lazyNamedPanel(() => import('@/components/panels/multi-gateway-panel'), 'MultiGatewayPanel')
export const LazyGatewayControlPanel = lazyNamedPanel(() => import('@/components/panels/gateway-control-panel'), 'GatewayControlPanel')
export const LazyGatewayConfigPanel = lazyNamedPanel(() => import('@/components/panels/gateway-config-panel'), 'GatewayConfigPanel')
export const LazyIntegrationsPanel = lazyNamedPanel(() => import('@/components/panels/integrations-panel'), 'IntegrationsPanel')
export const LazySuperAdminPanel = lazyNamedPanel(() => import('@/components/panels/super-admin-panel'), 'SuperAdminPanel')
export const LazyGitHubSyncPanel = lazyNamedPanel(() => import('@/components/panels/github-sync-panel'), 'GitHubSyncPanel')
export const LazyOfficePanel = lazyNamedPanel(() => import('@/components/panels/office-panel'), 'OfficePanel')
export const LazySystemMonitorPanel = lazyNamedPanel(() => import('@/components/panels/system-monitor-panel'), 'SystemMonitorPanel')
export const LazySkillsPanel = lazyNamedPanel(() => import('@/components/panels/skills-panel'), 'SkillsPanel')
export const LazyChannelsPanel = lazyNamedPanel(() => import('@/components/panels/channels-panel'), 'ChannelsPanel')
export const LazyNodesPanel = lazyNamedPanel(() => import('@/components/panels/nodes-panel'), 'NodesPanel')
export const LazySecurityAuditPanel = lazyNamedPanel(() => import('@/components/panels/security-audit-panel'), 'SecurityAuditPanel')
export const LazyDebugPanel = lazyNamedPanel(() => import('@/components/panels/debug-panel'), 'DebugPanel')
export const LazyExecApprovalPanel = lazyNamedPanel(() => import('@/components/panels/exec-approval-panel'), 'ExecApprovalPanel')
export const LazyProjectManagerModal = lazyNamedPanel(() => import('@/components/modals/project-manager-modal'), 'ProjectManagerModal')
export const LazySkillEvolutionPanel = dynamic(() => import('@/components/panels/skill-evolution-panel'), { loading: panelLoading })
export const LazyCapabilitiesPanel = lazyNamedPanel(() => import('@/components/panels/capabilities-panel'), 'CapabilitiesPanel')
export const LazyStudioPanel = lazyNamedPanel(() => import('@/components/panels/studio-panel'), 'StudioPanel')
export const LazyLibraryPanel = lazyNamedPanel(() => import('@/components/panels/library-panel'), 'LibraryPanel')
