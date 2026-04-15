'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MediaBundlePlayerProps {
  title: string
  audioUrl: string
  markdownContent: string
}

export function MediaBundlePlayer({ title, audioUrl, markdownContent }: MediaBundlePlayerProps) {
  return (
    <div className="w-full max-w-4xl mx-auto rounded-2xl border border-border bg-card overflow-hidden">
      {/* Title */}
      <div className="px-6 pt-8 pb-4 text-center">
        <h1 className="text-3xl font-bold text-foreground">{title}</h1>
      </div>

      {/* Audio Player — sticky */}
      {audioUrl && (
        <div className="sticky top-0 z-50 bg-card/90 backdrop-blur-md px-6 py-4 border-b border-border">
          <audio controls className="w-full h-10">
            <source src={audioUrl} type="audio/mpeg" />
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {/* Article */}
      <article className="px-6 py-8 prose prose-lg dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-code:text-primary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {markdownContent}
        </ReactMarkdown>
      </article>
    </div>
  )
}
