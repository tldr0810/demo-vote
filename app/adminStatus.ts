// What the organiser's dashboard should say an event is doing.
//
// Deliberately not the same question as `events.status`. That column is the
// button the organiser last pressed, and there is one stretch of an event where
// the button and the truth disagree: `open` with a `closesAt` that has already
// passed. See isVotingLive in worker/data.ts — the clock closes a window whether
// or not anybody presses anything, which during a live event is the normal way
// for one to end.

import type { EventStatus } from './api'

/**
 * `ended` is the state with no button behind it: the window ran out on its own
 * and the organiser has not pressed Close yet. Everything else is the event's
 * own status, unchanged.
 */
export type DashboardStatus = EventStatus | 'ended'

/**
 * `live` is the polled results payload, which is the only thing on this screen
 * carrying a fresh reading of the clock — the event row behind the rest of the
 * dashboard is refetched when an organiser acts and at no other time. Null when
 * nothing has been polled yet, or when what was polled describes a different
 * event, in which case the event's own status is all there is to go on.
 */
export function dashboardStatus(
  event: { status: EventStatus },
  live: { votingLive: boolean } | null,
): DashboardStatus {
  // A closed, draft or revealed event has no clock left to disagree with. Only
  // `open` can be overtaken by its own deadline.
  if (event.status !== 'open') return event.status
  if (!live) return 'open'
  return live.votingLive ? 'open' : 'ended'
}

/**
 * Whether the tally can still change, which is what decides whether the
 * dashboard keeps polling and whether it is allowed to name a leader.
 *
 * Both follow from the same fact and are stated once here: an ended window
 * produces a final tally, so polling it is requests that return the same numbers
 * for as long as the page is left open, and holding back the leader highlight is
 * withholding a result that is no longer provisional.
 */
export function tallyCanChange(status: DashboardStatus): boolean {
  return status === 'open'
}

/**
 * Whether a code generated now could still be redeemed by somebody.
 *
 * Only up to the point the window shuts. After that a new code is a slip nobody
 * can use — redemption is refused for the same reason voting is — so the panel
 * that makes them stops being the loudest thing on the dashboard. `ended`
 * counts as shut: the clock closes the window whether or not the organiser has
 * pressed Close yet.
 */
export function codesCanStillBeUsed(status: DashboardStatus): boolean {
  return status === 'draft' || status === 'open'
}
