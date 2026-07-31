// Which events the organiser's list shows, in which group, with which actions.
//
// The event list is the first thing an organiser sees and the only place events
// are filed away from, so the rules deciding what appears on it are worth having
// somewhere they can be read together. tests/adminEvents.test.ts is the table.

import type { AdminEvent } from './api'

/**
 * The events on the list.
 *
 * Archived events stay out of the way until asked for: by the twentieth event
 * the list is mostly history and the one being run today is the only one anybody
 * is looking for. The order is the server's — newest first — and is not
 * re-sorted here, because "newest" is the only ordering that does not change
 * under the organiser while they are reading it.
 */
export function listedEvents(events: AdminEvent[], showArchived: boolean): AdminEvent[] {
  return showArchived ? events : events.filter((event) => !event.archivedAt)
}

export function archivedCount(events: AdminEvent[]): number {
  return events.filter((event) => event.archivedAt).length
}

/**
 * The events being run right now, pulled to the top of the page.
 *
 * `status === 'open'` and nothing else. A draft is deliberately not on now: it is
 * a thing that has been set up, and putting it under a heading that says "On now"
 * next to a live tally would say the room is voting when nobody can. An `open`
 * event whose window has run out stays here, because it is still the event the
 * organiser is standing in front of and the next thing they have to press —
 * Close, then Reveal — is on its dashboard.
 *
 * Plural because parallel tracks are a thing this app supports: sessions are
 * event-scoped, so two rooms can vote at once, and an organiser running both
 * needs both within reach.
 *
 * Archived events are excluded, which cannot normally happen — only a finished
 * event can be archived — but is cheap to state and would otherwise be a filed
 * event reappearing at the top of the page.
 */
export function onNowEvents(events: AdminEvent[]): AdminEvent[] {
  return events.filter((event) => event.status === 'open' && !event.archivedAt)
}

/**
 * Whether this event can be filed away.
 *
 * Only something finished. Archiving takes an event out of the landing page's
 * reckoning, so a draft or a live event must not be archivable while a room is
 * being told to scan for it. Mirrors the same rule in worker/routes/admin.ts,
 * which is the one that actually enforces it — this only decides whether to
 * offer the button.
 */
export function canArchive(event: AdminEvent): boolean {
  return !event.archivedAt && (event.status === 'closed' || event.status === 'revealed')
}
