'use client'

import { useShallow } from 'zustand/react/shallow'
import { useMissionControl, type ChatMessage } from '@/store'
import type { ChatMessageGroup } from '@/store/chat-derived'

const EMPTY_CHAT_MESSAGES: ChatMessage[] = []
const EMPTY_CHAT_GROUPS: ChatMessageGroup[] = []

export function useMissionControlShellState() {
  return useMissionControl(useShallow((state) => ({
    activeTab: state.activeTab,
    optimisticPanel: state.optimisticPanel,
    setActiveTab: state.setActiveTab,
    setOptimisticPanel: state.setOptimisticPanel,
    setCurrentUser: state.setCurrentUser,
    setDashboardMode: state.setDashboardMode,
    setGatewayAvailable: state.setGatewayAvailable,
    setLocalSessionsAvailable: state.setLocalSessionsAvailable,
    setCapabilitiesChecked: state.setCapabilitiesChecked,
    setSubscription: state.setSubscription,
    setDefaultOrgName: state.setDefaultOrgName,
    setUpdateAvailable: state.setUpdateAvailable,
    setOpenclawUpdate: state.setOpenclawUpdate,
    showOnboarding: state.showOnboarding,
    setShowOnboarding: state.setShowOnboarding,
    liveFeedOpen: state.liveFeedOpen,
    toggleLiveFeed: state.toggleLiveFeed,
    showProjectManagerModal: state.showProjectManagerModal,
    setShowProjectManagerModal: state.setShowProjectManagerModal,
    fetchProjects: state.fetchProjects,
    setChatPanelOpen: state.setChatPanelOpen,
    bootComplete: state.bootComplete,
    setBootComplete: state.setBootComplete,
    setAgents: state.setAgents,
    setSessions: state.setSessions,
    setProjects: state.setProjects,
    setInterfaceMode: state.setInterfaceMode,
    setSkillsData: state.setSkillsData,
  })))
}

export function useMissionControlContentRouterState() {
  return useMissionControl(useShallow((state) => ({
    dashboardMode: state.dashboardMode,
    interfaceMode: state.interfaceMode,
    setInterfaceMode: state.setInterfaceMode,
  })))
}

export function useMissionControlNavigationActions() {
  return useMissionControl(useShallow((state) => ({
    setOptimisticPanel: state.setOptimisticPanel,
    setChatPanelOpen: state.setChatPanelOpen,
  })))
}

export function useMissionControlNavState() {
  return useMissionControl(useShallow((state) => ({
    activeTab: state.optimisticPanel ?? state.activeTab,
    connection: state.connection,
    dashboardMode: state.dashboardMode,
    currentUser: state.currentUser,
    activeTenant: state.activeTenant,
    tenants: state.tenants,
    osUsers: state.osUsers,
    setActiveTenant: state.setActiveTenant,
    fetchTenants: state.fetchTenants,
    fetchOsUsers: state.fetchOsUsers,
    activeProject: state.activeProject,
    projects: state.projects,
    setActiveProject: state.setActiveProject,
    fetchProjects: state.fetchProjects,
    sidebarExpanded: state.sidebarExpanded,
    collapsedGroups: state.collapsedGroups,
    toggleSidebar: state.toggleSidebar,
    toggleGroup: state.toggleGroup,
    defaultOrgName: state.defaultOrgName,
    interfaceMode: state.interfaceMode,
    setInterfaceMode: state.setInterfaceMode,
  })))
}

export function useMissionControlHeaderState() {
  return useMissionControl(useShallow((state) => ({
    connection: state.connection,
    sessions: state.sessions,
    unreadNotificationCount: state.unreadNotificationCount,
    activeTenant: state.activeTenant,
    activeProject: state.activeProject,
    dashboardMode: state.dashboardMode,
  })))
}

export function useMissionControlLiveFeedState() {
  return useMissionControl(useShallow((state) => ({
    logs: state.logs,
    sessions: state.sessions,
    activities: state.activities,
    connection: state.connection,
    dashboardMode: state.dashboardMode,
    toggleLiveFeed: state.toggleLiveFeed,
  })))
}

export function useMissionControlChatInputState() {
  return useMissionControl(useShallow((state) => ({
    chatInput: state.chatInput,
    setChatInput: state.setChatInput,
    isSendingMessage: state.isSendingMessage,
  })))
}

export function useMissionControlChatPanelState() {
  return useMissionControl(useShallow((state) => ({
    chatPanelOpen: state.chatPanelOpen,
    setChatPanelOpen: state.setChatPanelOpen,
  })))
}

export function useMissionControlDashboardState() {
  return useMissionControl(useShallow((state) => ({
    sessions: state.sessions,
    setSessions: state.setSessions,
    connection: state.connection,
    dashboardMode: state.dashboardMode,
    subscription: state.subscription,
    logs: state.logs,
    agents: state.agents,
    tasks: state.tasks,
    setActiveConversation: state.setActiveConversation,
  })))
}

export function useMissionControlChatWorkspaceState() {
  return useMissionControl(useShallow((state) => ({
    activeConversation: state.activeConversation,
    setActiveConversation: state.setActiveConversation,
    setChatMessages: state.setChatMessages,
    setConversations: state.setConversations,
    addChatMessage: state.addChatMessage,
    replacePendingMessage: state.replacePendingMessage,
    updatePendingMessage: state.updatePendingMessage,
    agents: state.agents,
    conversations: state.conversations,
    setAgents: state.setAgents,
    notifications: state.notifications,
    splitPanes: state.splitPanes,
    addSplitPane: state.addSplitPane,
    removeSplitPane: state.removeSplitPane,
    clearSplitPanes: state.clearSplitPanes,
  })))
}

export function useMissionControlServerEventActions() {
  return useMissionControl(useShallow((state) => ({
    setConnection: state.setConnection,
    addTask: state.addTask,
    updateTask: state.updateTask,
    deleteTask: state.deleteTask,
    addAgent: state.addAgent,
    updateAgent: state.updateAgent,
    addChatMessage: state.addChatMessage,
    addNotification: state.addNotification,
    addActivity: state.addActivity,
  })))
}

export function useMissionControlWebSocketState() {
  return useMissionControl(useShallow((state) => ({
    connection: state.connection,
    setConnection: state.setConnection,
    setLastMessage: state.setLastMessage,
    setSessions: state.setSessions,
    addLog: state.addLog,
    updateSpawnRequest: state.updateSpawnRequest,
    setCronJobs: state.setCronJobs,
    addTokenUsage: state.addTokenUsage,
    addChatMessage: state.addChatMessage,
    addNotification: state.addNotification,
    updateAgent: state.updateAgent,
    addExecApproval: state.addExecApproval,
    updateExecApproval: state.updateExecApproval,
  })))
}

export function useMissionControlLogViewerState() {
  return useMissionControl(useShallow((state) => ({
    logs: state.logs,
    logFilters: state.logFilters,
    replaceLogs: state.replaceLogs,
    prependLogs: state.prependLogs,
    setLogFilters: state.setLogFilters,
    clearLogs: state.clearLogs,
    logViewerCache: state.logViewerCache,
    setLogViewerCache: state.setLogViewerCache,
  })))
}

export function useMissionControlConversationMessages(conversationId: string | null) {
  return useMissionControl((state) => {
    if (!conversationId) return EMPTY_CHAT_MESSAGES
    return state.chatMessagesByConversation[conversationId] || EMPTY_CHAT_MESSAGES
  })
}

export function useMissionControlConversationGroups(conversationId: string | null) {
  return useMissionControl((state) => {
    if (!conversationId) return EMPTY_CHAT_GROUPS
    return state.chatMessageGroupsByConversation[conversationId] || EMPTY_CHAT_GROUPS
  })
}
