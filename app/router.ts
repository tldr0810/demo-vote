import { useEffect, useState } from 'react'

// A router for three routes. Pulling in a routing library for /v/:id, /admin
// and /screen/:id would add a dependency, a bundle, and a CVE surface to
// something that fits in twenty lines.

// There is no programmatic navigation: every link out of a screen (the big-screen
// view from the dashboard) is a full page load, which is the right thing for a URL
// somebody opens on a venue machine.

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return pathname
}

/** Returns the id segment for a `/prefix/:id` path, or null. */
export function segmentAfter(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length).split('/')[0]
  return rest && rest.length > 0 ? rest : null
}
