// Which organiser screen a path is asking for.
//
// Kept out of the component for the same reason adminStatus.ts is: it is a set
// of rules about strings, and rules about strings are worth reading in one place
// and testing without a browser. tests/adminRoute.test.ts is the table.

/** Where an organiser can be. */
export type AdminRoute =
  /** The event list. Everything starts here. */
  | { kind: 'home' }
  /** The set-up form, on a URL of its own so the back button leaves it. */
  | { kind: 'new' }
  /** One event's dashboard. */
  | { kind: 'event'; id: string }
  /** The printable sheet of slips. A page, not a panel: it is sent to a printer. */
  | { kind: 'print'; id: string }

export const ADMIN_HOME = '/admin'
export const ADMIN_NEW = '/admin/new'

export function adminEventPath(eventId: string): string {
  return `/admin/event/${eventId}`
}

export function adminPrintPath(eventId: string): string {
  return `/admin/print/${eventId}`
}

/**
 * Reads a path under /admin.
 *
 * Anything unrecognised is the event list rather than a 404. There is one
 * organiser, they are holding a laptop at a demo day, and a mistyped or
 * out-of-date bookmark should put them in front of their events rather than in
 * front of an error page — the list is one click from everywhere they might have
 * meant. This is also what makes the old `/admin?event=…` era of links harmless.
 */
export function adminRoute(pathname: string): AdminRoute {
  // Trailing slashes only, and only when there is something before them, so `/`
  // never becomes the empty string.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  if (path === ADMIN_NEW) return { kind: 'new' }

  const print = idAfter(path, '/admin/print/')
  if (print) return { kind: 'print', id: print }

  const event = idAfter(path, '/admin/event/')
  if (event) return { kind: 'event', id: event }

  return { kind: 'home' }
}

/**
 * The single segment after a prefix, or null.
 *
 * Null for a deeper path as well as for a missing one: `/admin/event/x/y` names
 * no screen this app has, and answering it with event `x` would put an organiser
 * on a dashboard whose address bar disagrees with it.
 */
function idAfter(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (rest.length === 0 || rest.includes('/')) return null
  return rest
}
