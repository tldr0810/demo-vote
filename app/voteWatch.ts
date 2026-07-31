// The decisions a phone sitting on an event has to make about it, kept apart
// from the component that acts on them.
//
// Vote.tsx does the fetching, the timers and the screens; this file is the part
// with the rules in it, so the rules can be read in one place and tested without
// standing up a browser. tests/voteWatch.test.ts is the table.

import type { EventStatus } from './api'

/** The screens a phone can be on. Mirrors Vote.tsx's `Phase`. */
export type WatchedPhase = 'entry' | 'ballot' | 'unavailable'

/**
 * How often a phone asks what has happened to the event it is on.
 *
 * The projector polls every three seconds because there is one of it and a room
 * is watching it. A phone has two hundred copies of itself on the same venue
 * wifi and nobody is waiting for a number to twitch, so this is deliberately
 * slower.
 */
export const LIVE_POLL_MS = 8000

/**
 * The same question, asked before the doors open.
 *
 * Faster than the live rate, not slower, and this was the other way round until
 * the arithmetic got done. The reasoning for twenty seconds was that a draft is
 * the longest a phone sits on this page — people open the QR they were handed at
 * check-in and then wait through the introductions — so polling it at the live
 * rate would put the heaviest traffic of the event into the stretch where
 * nothing is happening.
 *
 * True, and it priced the wrong thing. A draft poll is one `GET /api/event/:id`:
 * five fields of JSON, no tally, no session work. Two hundred phones at this
 * interval is forty requests a second of that, which is nothing to a Worker and
 * nothing on the wifi next to two hundred phones idling on everything else they
 * run. What the twenty seconds actually bought was a twenty-second worst case on
 * the one transition in the whole event that has a room standing around waiting
 * for it, which is a bad trade.
 *
 * `visibilitychange` still covers the announced case, and that is the common
 * one: the organiser says it out loud, people pick their phones up, and the poll
 * fires on the wake rather than on this timer. This interval is the floor under
 * the phone nobody picked up — face-up on a table, screen on — and five seconds
 * is short enough that it reads as the page having noticed.
 */
export const DRAFT_POLL_MS = 5000

export function pollIntervalFor(status: EventStatus): number {
  return status === 'draft' ? DRAFT_POLL_MS : LIVE_POLL_MS
}

/**
 * How long a page that could not resolve its event waits before asking again.
 *
 * The one state this page can reach that nothing else recovers from. Everything
 * above watches an event; this is for not having one — the first
 * `GET /api/event/:id` came back a network error because the venue wifi dropped
 * a packet during the ten seconds when two hundred people were all scanning at
 * once, and there is nothing to watch, no id to poll and no reason for the page
 * to ever ask a second question. That phone is stuck on an error until somebody
 * thinks to pull down to refresh, which is exactly the thing this whole file
 * exists to avoid.
 *
 * Also the fix for a landing page opened too early: `/` with no event resolves
 * nothing, and a permanent QR on a wall scanned before the organiser has created
 * the event used to say "nothing is scheduled" for the rest of the day.
 */
export const BOOT_RETRY_MS = 5000

/**
 * What a phone should do about the event it just asked after.
 *
 * `enter` — voting is live and this phone is on a screen that cannot reach it.
 *   Which screen it should be on instead is not decided here: it depends on
 *   whether this browser already holds a session, and that costs a request.
 * `close` — voting is no longer live and this phone is still offering to score.
 * `results` — the standings exist and replace whatever is on screen.
 * `wait` — nothing has changed that this phone can see.
 */
export type WatchAction = 'results' | 'enter' | 'close' | 'wait'

export function watchAction(
  event: { status: EventStatus; votingLive: boolean },
  phase: WatchedPhase,
): WatchAction {
  // First, and regardless of the phase: once the organiser has revealed, the
  // standings are what everybody should see, whether or not they ever held a
  // code.
  if (event.status === 'revealed') return 'results'

  // Opened while somebody was already waiting on the page. This is the case the
  // draft poll exists for: people open their slip before the doors open, and the
  // only thing that used to move them on was a manual refresh.
  if (event.votingLive) return phase === 'unavailable' ? 'enter' : 'wait'

  // Closed while somebody was still scoring, or still typing their code. Both
  // screens are now offering something that cannot happen.
  return phase === 'unavailable' ? 'wait' : 'close'
}
