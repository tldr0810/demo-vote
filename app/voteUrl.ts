// How a voting code travels in a URL.
//
// Its own module because three places have to agree about it: the print sheet
// writes it into a QR, the voting page reads it back out, and the tests assert
// the round trip. A mismatch here means a room full of slips that scan to a
// page asking people to type the code they just scanned.

/** The query parameter carrying a personal voting code. */
export const CODE_PARAM = 'c'

/** The URL encoded into one attendee's QR code. */
export function personalVoteUrl(origin: string, eventId: string, code: string): string {
  const url = new URL(`/v/${eventId}`, origin)
  url.searchParams.set(CODE_PARAM, code)
  return url.toString()
}

/**
 * The code a scanned URL carries, if any.
 *
 * Normalised the same way typed input is, so a code that survives a QR scan and
 * a code somebody reads off the slip and types in reach the server identically.
 */
export function codeFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(CODE_PARAM)
  if (!value) return null
  const normalised = value.replace(/[\s-]/g, '').toUpperCase()
  return normalised.length > 0 ? normalised : null
}

/**
 * Rewrites the address bar without the code, leaving the event path intact.
 *
 * A code in the address bar outlives the moment it was scanned: it sits in
 * history, in a screenshot of the ballot, in whatever the browser syncs. It has
 * done its job once the session cookie exists, so it should stop being on
 * screen. replaceState rather than pushState — a back button that returns to the
 * URL-with-code would undo this.
 */
export function stripCodeFromUrl(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(CODE_PARAM)) return
  url.searchParams.delete(CODE_PARAM)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
