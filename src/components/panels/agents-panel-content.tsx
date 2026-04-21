'use client'

import { OrchestrationBar } from '@/components/panels/orchestration-bar'
import { LocalAgentsDocPanel } from '@/components/panels/local-agents-doc-panel'
import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'

export function AgentsPanelContent({ isLocal }: { isLocal: boolean }) {
  return (
    <>
      <OrchestrationBar />
      {isLocal && <LocalAgentsDocPanel />}
      <AgentSquadPanelPhase3 />
    </>
  )
}
