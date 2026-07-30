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
 * Slower again, and for a different reason from the one above. A draft is the
 * longest a phone can sit on this page: people open the QR they were handed at
 * check-in and then wait through the introductions, where the voting window
 * itself is measured in minutes. Polling a draft at the live rate would put the
 * heaviest traffic of the whole event into the part of it where nothing is
 * happening, which is the opposite of what the venue wifi can afford.
 *
 * Twenty seconds costs a phone three requests a minute instead of seven or
 * eight, so watching every draft still adds less load than the open window it is
 * waiting for. What makes that latency acceptable is that nobody finds out about
 * the open from this page: the organiser says it out loud, people pick their
 * phones up, and `visibilitychange` polls immediately — so the interval is the
 * worst case for a phone already awake in someone's hand, not for the room.
 */
export const DRAFT_POLL_MS = 20000

export function pollIntervalFor(status: EventStatus): number {
  return status === 'draft' ? DRAFT_POLL_MS : LIVE_POLL_MS
}

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
