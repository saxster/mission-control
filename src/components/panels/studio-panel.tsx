'use client'

import { useState } from 'react'
import { useNavigateToPanel } from '@/lib/navigation'

interface SynthesisResult {
  bundle_id: string
  title: string
  audio_url: string
  article_path: string
}

export function StudioPanel() {
  const [topic, setTopic] = useState('')
  const [sourceRefs, setSourceRefs] = useState('')
  const [status, setStatus] = useState<'idle' | 'synthesizing' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [lastResult, setLastResult] = useState<SynthesisResult | null>(null)
  const navigateToPanel = useNavigateToPanel()

  const handleSynthesize = async () => {
    if (!topic.trim()) return
    setStatus('synthesizing')
    setStatusMessage('Initializing Synthesis Engine...')
    setLastResult(null)

    try {
      setStatusMessage('Generating research ledger & script...')

      const refs = sourceRefs
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)

      const res = await fetch('/api/media/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, source_refs: refs.length > 0 ? refs : [] }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `Request failed with status ${res.status}`)
      }

      const data: SynthesisResult = await res.json()
      setLastResult(data)
      setStatus('success')
      setStatusMessage(`Bundle "${data.title}" generated successfully.`)
    } catch (error: any) {
      console.error(error)
      setStatus('error')
      setStatusMessage(error.message || 'Synthesis failed')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-violet-400">
              <path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
              <path d="M12 18.5V22" />
              <path d="M7.5 12h-4" />
              <path d="M20.5 12h-4" />
              <path d="M12 5.5V2" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Media Synthesis Studio</h1>
            <p className="text-sm text-muted-foreground">Generate an AI podcast and deep-dive article from any topic.</p>
          </div>
        </div>
      </div>

      {/* Input Form */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-2 text-foreground">
            Target Topic or Research Question
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full p-3 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all text-foreground placeholder:text-muted-foreground"
            placeholder="e.g. How AI agents will impact enterprise unit economics"
            disabled={status === 'synthesizing'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSynthesize()
              }
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-foreground">
            Source References <span className="text-muted-foreground font-normal">(optional, one per line)</span>
          </label>
          <textarea
            value={sourceRefs}
            onChange={(e) => setSourceRefs(e.target.value)}
            className="w-full p-3 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all text-foreground placeholder:text-muted-foreground resize-none"
            placeholder="https://example.com/paper.pdf&#10;https://example.com/podcast-episode"
            rows={3}
            disabled={status === 'synthesizing'}
          />
        </div>

        <button
          onClick={handleSynthesize}
          disabled={status === 'synthesizing' || !topic.trim()}
          className="w-full bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground font-medium p-3 rounded-lg transition-all flex justify-center items-center gap-2"
        >
          {status === 'synthesizing' ? (
            <>
              <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
              Synthesizing...
            </>
          ) : (
            <>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M8 3v10M3 8h10" />
              </svg>
              Synthesize Media Bundle
            </>
          )}
        </button>
      </div>

      {/* Status Messages */}
      {statusMessage && (
        <div className={`mt-4 p-4 rounded-lg border text-sm transition-all ${
          status === 'error'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : status === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-primary/5 border-primary/20 text-muted-foreground'
        }`}>
          <div className="flex items-start gap-2">
            {status === 'synthesizing' && (
              <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full mt-0.5 shrink-0" />
            )}
            {status === 'error' && (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 mt-0.5 shrink-0">
                <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM7 5a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0V5Zm1 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
              </svg>
            )}
            {status === 'success' && (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 mt-0.5 shrink-0">
                <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.151-.043l4.25-5.5Z" />
              </svg>
            )}
            <span>{statusMessage}</span>
          </div>
        </div>
      )}

      {/* Success Action */}
      {status === 'success' && lastResult && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => navigateToPanel('library')}
            className="flex-1 px-4 py-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium text-sm transition-colors flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <rect x="2" y="2" width="5" height="6" rx="1" />
              <rect x="9" y="2" width="5" height="6" rx="1" />
              <rect x="2" y="10" width="12" height="4" rx="1" />
            </svg>
            View in Library
          </button>
          <button
            onClick={() => {
              setTopic('')
              setSourceRefs('')
              setStatus('idle')
              setStatusMessage('')
              setLastResult(null)
            }}
            className="px-4 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground font-medium text-sm transition-colors"
          >
            New Synthesis
          </button>
        </div>
      )}
    </div>
  )
}
