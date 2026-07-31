import { useEffect, useState } from 'react'

// A router for a handful of routes. Pulling in a routing library for /v/:id,
// /admin, /admin/event/:id and /screen/:id would add a dependency, a bundle, and
// a CVE surface to something that fits on a screen.

// Links that leave the app entirely — the big-screen view, the print sheet — stay
// full page loads, which is the right thing for a URL somebody opens on a venue
// machine and closes again. `navigate` is for moving inside the organiser's own
// dashboard, where a full load would mean a white flash and a fresh cookie check
// every time somebody steps from the event list into an event, in the middle of
// an event.

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return pathname
}

/**
 * Moves to a path without reloading.
 *
 * `pushState` on its own fires nothing — it is deliberately silent, so that a
 * page pushing its own scroll position does not trip every listener in the
 * document. The synthetic `popstate` is what lets `usePathname` above be the one
 * subscription in the app: back, forward and this all arrive the same way, so
 * there is no second code path to keep in step with the first.
 */
export function navigate(pathname: string): void {
  if (pathname === window.location.pathname) return
  window.history.pushState(null, '', pathname)
  // What a page load would have done, and the reason this is here rather than
  // left to the browser: `pushState` keeps the scroll position, so opening an
  // event from the bottom of a long list landed the organiser part-way down its
  // dashboard, below the bar carrying the event's name and its one action. Not
  // done on a real `popstate` — going back should return to where you were, and
  // the browser restores that itself.
  window.scrollTo({ top: 0 })
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Returns the id segment for a `/prefix/:id` path, or null. */
export function segmentAfter(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length).split('/')[0]
  return rest && rest.length > 0 ? rest : null
}
