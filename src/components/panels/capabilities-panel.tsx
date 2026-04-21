import React from 'react'

export function CapabilitiesPanel() {
  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-2">Hermes Expert (Optimization)</h1>
        <p className="text-sm text-foreground/70">
          The Hermes Expert proactively analyzes your environment and suggests ways to get more out of the ecosystem.
        </p>
      </div>

      <div className="flex-1 bg-card border border-border p-6 rounded-xl flex items-center justify-center text-center">
        <div>
          <h2 className="text-xl font-medium mb-2">Expert Ready</h2>
          <p className="text-sm text-foreground/60 mb-6 max-w-sm mx-auto">
            The expert is available. Switch to Chat and invoke the `hermes-expert` skill or wait for background cron jobs to provide proactive insights here.
          </p>
          <div className="text-xs text-foreground/40 font-mono bg-background p-2 rounded">
            python ~/.hermes/skills/hermes-expert/expert_tools.py list-crons
          </div>
        </div>
      </div>
    </div>
  )
}
