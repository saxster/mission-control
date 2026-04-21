'use client'

import { useState, useEffect, useCallback } from 'react'
import { MediaBundlePlayer } from '@/components/MediaBundlePlayer'
import { useNavigateToPanel } from '@/lib/navigation'

interface BundleListItem {
  bundle_id: string
  title: string
  has_audio: boolean
  created_at: number
}

interface BundleDetail {
  bundle_id: string
  title: string
  audio_url: string | null
  markdown_content: string
}

export function LibraryPanel() {
  const [bundles, setBundles] = useState<BundleListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBundle, setSelectedBundle] = useState<BundleDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const navigateToPanel = useNavigateToPanel()

  const fetchBundles = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/media/bundles')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch bundles')
      }
      const data = await res.json()
      setBundles(data.bundles || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load library')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBundles()
  }, [fetchBundles])

  const openBundle = async (bundleId: string) => {
    try {
      setLoadingDetail(true)
      const res = await fetch(`/api/media/bundle/${bundleId}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load bundle')
      }
      const data: BundleDetail = await res.json()
      setSelectedBundle(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingDetail(false)
    }
  }

  // Detail view
  if (selectedBundle) {
    return (
      <div className="min-h-full bg-background">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Back button */}
          <button
            onClick={() => setSelectedBundle(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Back to Library
          </button>

          <MediaBundlePlayer
            title={selectedBundle.title}
            audioUrl={selectedBundle.audio_url || ''}
            markdownContent={selectedBundle.markdown_content}
          />
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <span className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm text-muted-foreground">Loading library...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm max-w-md text-center">
          {error}
        </div>
        <button
          onClick={fetchBundles}
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  // Library listing
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-amber-400">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="9" rx="1.5" />
              <rect x="3" y="15" width="18" height="6" rx="1.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Media Library</h1>
            <p className="text-sm text-muted-foreground">
              {bundles.length} {bundles.length === 1 ? 'bundle' : 'bundles'} generated
            </p>
          </div>
        </div>

        <button
          onClick={() => navigateToPanel('studio')}
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New
        </button>
      </div>

      {/* Empty state */}
      {bundles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-muted-foreground/50">
              <path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
              <path d="M12 18.5V22" />
              <path d="M7.5 12h-4" />
              <path d="M20.5 12h-4" />
              <path d="M12 5.5V2" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No bundles yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Head to the Studio to generate your first AI-powered podcast and article.
          </p>
          <button
            onClick={() => navigateToPanel('studio')}
            className="px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium text-sm transition-colors"
          >
            Open Studio
          </button>
        </div>
      )}

      {/* Bundle grid */}
      {bundles.length > 0 && (
        <div className="space-y-3">
          {bundles.map((bundle) => (
            <button
              key={bundle.bundle_id}
              onClick={() => openBundle(bundle.bundle_id)}
              disabled={loadingDetail}
              className="w-full text-left p-4 rounded-xl border border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all group"
            >
              <div className="flex items-center gap-4">
                {/* Icon */}
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 border border-violet-500/20 flex items-center justify-center shrink-0 group-hover:border-violet-500/40 transition-colors">
                  {bundle.has_audio ? (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-violet-400">
                      <path d="M6 3.5a.5.5 0 0 1 .804-.396l4.5 3.5a.5.5 0 0 1 0 .792l-4.5 3.5A.5.5 0 0 1 6 10.5v-7Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-muted-foreground">
                      <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Z" />
                    </svg>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {bundle.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {new Date(bundle.created_at * 1000).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {bundle.has_audio && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium">
                        Audio
                      </span>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
