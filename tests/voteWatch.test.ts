import { describe, expect, it } from 'vitest'
import type { EventStatus } from '../app/api'
import {
  BOOT_RETRY_MS,
  DRAFT_POLL_MS,
  LIVE_POLL_MS,
  pollIntervalFor,
  watchAction,
  type WatchedPhase,
} from '../app/voteWatch'

/**
 * What a phone left open on the vote page does about the event moving underneath
 * it.
 *
 * Every one of these is somebody who is not touching their phone: they opened
 * the page when they were handed a slip, or they finished scoring and put it
 * down. Nobody in that position is going to think to refresh, so the only thing
 * standing between them and a screen that has quietly stopped being true is this
 * table.
 */

const STATUSES: EventStatus[] = ['draft', 'open', 'closed', 'revealed']
const PHASES: WatchedPhase[] = ['entry', 'ballot', 'unavailable']

describe('following an event from a phone', () => {
  it('moves a phone that has been waiting since check-in onto the ballot', () => {
    // The whole point. The organiser presses "Open voting" and the phones that
    // were opened before the doors — which is most of them — have to move on
    // their own. This used to be the one transition nothing watched for: a draft
    // was excluded from polling on the grounds that it could not be revealed
    // without being opened first, which is true about reveals and says nothing
    // about opens.
    expect(watchAction({ status: 'open', votingLive: true }, 'unavailable')).toBe('enter')
  })

  it('does not decide between the entry screen and the ballot itself', () => {
    // `enter` deliberately stops short of naming a screen. Somebody who scanned
    // their personal slip before the doors opened is holding a code that is
    // printed nowhere a human can read, so sending them to "type your code"
    // would be a dead end; whether they get the ballot instead depends on a
    // session lookup, which costs a request and belongs in the component.
    expect(watchAction({ status: 'open', votingLive: true }, 'unavailable')).toBe('enter')
    expect(watchAction({ status: 'open', votingLive: true }, 'entry')).toBe('wait')
    expect(watchAction({ status: 'open', votingLive: true }, 'ballot')).toBe('wait')
  })

  it('takes the scoring screens away the moment voting stops', () => {
    // "Close now" does not move closesAt, so a phone on the ballot goes on
    // counting down towards a deadline that has stopped meaning anything.
    expect(watchAction({ status: 'closed', votingLive: false }, 'ballot')).toBe('close')
    expect(watchAction({ status: 'closed', votingLive: false }, 'entry')).toBe('close')
    // The window running out on its own looks the same from here: status is
    // still 'open' and only votingLive has changed.
    expect(watchAction({ status: 'open', votingLive: false }, 'ballot')).toBe('close')
  })

  it('shows the standings from any screen once they are published', () => {
    // Including to somebody who never held a code, and including to somebody
    // already sitting on the closed screen. A reveal outranks the phase.
    for (const phase of PHASES) {
      expect(watchAction({ status: 'revealed', votingLive: false }, phase)).toBe('results')
    }
  })

  it('leaves a phone alone when nothing it can see has changed', () => {
    expect(watchAction({ status: 'draft', votingLive: false }, 'unavailable')).toBe('wait')
    expect(watchAction({ status: 'closed', votingLive: false }, 'unavailable')).toBe('wait')
  })

  it('never sends a phone back to a screen it has moved on from', () => {
    // A phone on the closed screen must not be handed the ballot back by a
    // stale-looking poll, and a phone on the ballot must not be told to "enter"
    // and lose the scores on it. Stated over the whole grid rather than by
    // example, because the pair of directions is what the original bug was:
    // one of them existed and the other did not.
    for (const status of STATUSES) {
      for (const votingLive of [true, false]) {
        const action = watchAction({ status, votingLive }, 'ballot')
        expect(action).not.toBe('enter')
        if (status !== 'revealed') expect(action).toBe(votingLive ? 'wait' : 'close')
      }
    }
  })

  it('only ever asks to enter when voting is actually live', () => {
    for (const status of STATUSES) {
      for (const phase of PHASES) {
        expect(watchAction({ status, votingLive: false }, phase)).not.toBe('enter')
      }
    }
  })
})

describe('how often a phone asks', () => {
  it('watches a draft at least as closely as a live window', () => {
    // This asserted the opposite until the arithmetic got done. A draft poll is
    // one five-field GET with no tally and no session work behind it, and the
    // interval was buying a twenty-second worst case on the single transition in
    // the whole event that has a room standing around waiting for it.
    expect(pollIntervalFor('draft')).toBe(DRAFT_POLL_MS)
    expect(DRAFT_POLL_MS).toBeLessThanOrEqual(LIVE_POLL_MS)
  })

  it('keeps the live rate for every state a room is actually voting or waiting in', () => {
    for (const status of ['open', 'closed', 'revealed'] as EventStatus[]) {
      expect(pollIntervalFor(status)).toBe(LIVE_POLL_MS)
    }
  })

  it('opens a ballot inside the time it takes to say so out loud', () => {
    // The ceiling that replaces the old wifi one, and the reason this number is
    // what it is. A phone nobody picked up has to reach the ballot before the
    // organiser has finished the sentence announcing it, or the room spends the
    // first part of the window watching people refresh. `visibilitychange`
    // covers every phone that did get picked up; this is the floor under the
    // rest.
    expect(DRAFT_POLL_MS).toBeLessThanOrEqual(5000)
  })

  it('costs a room of phones less than the window it is waiting for', () => {
    // The load question, asked the way it actually lands: requests per second
    // across the room, not per phone per minute. A draft is watched by everybody
    // holding a slip; the open window is watched by the same phones, and every
    // one of those polls is doing strictly more work at the other end.
    const perSecond = (phones: number, ms: number) => (phones * 1000) / ms
    expect(perSecond(200, DRAFT_POLL_MS)).toBeLessThanOrEqual(50)
  })

  it('retries a page that never resolved an event at all', () => {
    // Not an interval on an event — an interval on not having one. Nothing else
    // in this file recovers from it, because everything else needs an id to
    // poll, and this is the state a dropped first request leaves a phone in.
    expect(BOOT_RETRY_MS).toBeGreaterThan(0)
    expect(BOOT_RETRY_MS).toBeLessThanOrEqual(LIVE_POLL_MS)
  })
})
