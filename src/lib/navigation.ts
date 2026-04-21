'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import { startNavigationTiming } from '@/lib/navigation-metrics'
import { useMissionControlNavigationActions } from '@/store/selectors'

export function panelHref(panel: string): string {
  return panel === 'overview' ? '/' : `/${panel}`
}

const PREFETCHED_ROUTES = new Set<string>()
export const DEFAULT_PREFETCH_PANELS = [
  'overview',
  'chat',
  'tasks',
  'agents',
  'activity',
  'notifications',
  'tokens',
] as const

function safePrefetch(router: ReturnType<typeof useRouter>, href: string) {
  if (PREFETCHED_ROUTES.has(href)) return
  PREFETCHED_ROUTES.add(href)
  router.prefetch(href)
}

export function useNavigateToPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const { setOptimisticPanel, setChatPanelOpen } = useMissionControlNavigationActions()

  useEffect(() => {
    for (const panel of DEFAULT_PREFETCH_PANELS) {
      const href = panelHref(panel)
      if (href !== pathname) safePrefetch(router, href)
    }
  }, [pathname, router])

  return useCallback((panel: string) => {
    const href = panelHref(panel)
    if (href === pathname) return
    safePrefetch(router, href)
    startNavigationTiming(pathname, href)
    setOptimisticPanel(panel)
    if (panel === 'chat' || panel === 'sessions') {
      setChatPanelOpen(false)
    }
    router.push(href, { scroll: false })
  }, [pathname, router, setChatPanelOpen, setOptimisticPanel])
}

export function usePrefetchPanel() {
  const router = useRouter()
  return useCallback((panel: string) => {
    const href = panelHref(panel)
    safePrefetch(router, href)
  }, [router])
}
