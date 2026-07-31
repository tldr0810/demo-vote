import { describe, expect, it } from 'vitest'
import { archivedCount, canArchive, listedEvents, onNowEvents } from '../app/adminEvents'
import type { AdminEvent, EventStatus } from '../app/api'

function event(patch: Partial<AdminEvent> & { id: string }): AdminEvent {
  return {
    name: patch.id,
    status: 'draft',
    windowSeconds: 3600,
    openedAt: null,
    closesAt: null,
    archivedAt: null,
    createdAt: '2026-07-31T09:00:00.000Z',
    votingLive: false,
    secondsRemaining: 0,
    demos: [],
    stats: { issued: 0, activated: 0, scored: 0 },
    ...patch,
  }
}

const STATUSES: EventStatus[] = ['draft', 'open', 'closed', 'revealed']

describe('what the event list shows', () => {
  it('keeps finished events out of the way until asked for', () => {
    const events = [event({ id: 'a' }), event({ id: 'b', archivedAt: '2026-07-30T00:00:00.000Z' })]

    expect(listedEvents(events, false).map((row) => row.id)).toEqual(['a'])
    expect(listedEvents(events, true).map((row) => row.id)).toEqual(['a', 'b'])
    expect(archivedCount(events)).toBe(1)
  })

  it('does not re-sort what the server sent', () => {
    // Newest first, decided by the query. Re-ordering here would mean the list
    // could rearrange itself under an organiser mid-read — and during an event
    // the row they are reaching for is the one that just changed.
    const events = [event({ id: 'newest' }), event({ id: 'older' }), event({ id: 'oldest' })]
    expect(listedEvents(events, true).map((row) => row.id)).toEqual([
      'newest',
      'older',
      'oldest',
    ])
  })
})

describe('what counts as on now', () => {
  it('is the event a room is voting in', () => {
    const events = [event({ id: 'live', status: 'open', votingLive: true })]
    expect(onNowEvents(events).map((row) => row.id)).toEqual(['live'])
  })

  it('keeps an event whose window ran out on its own', () => {
    // The clock closes a window without anybody pressing anything, and the two
    // things left to do about it — Close, then Reveal — are on this event's
    // dashboard. Dropping it out of reach at the exact moment the organiser
    // needs it would be the worst possible time.
    const ended = [event({ id: 'ended', status: 'open', votingLive: false })]
    expect(onNowEvents(ended).map((row) => row.id)).toEqual(['ended'])
  })

  it('is not a draft', () => {
    // A draft has been set up, not started. Under a heading saying "On now" it
    // would tell an organiser the room is voting when nobody can.
    expect(onNowEvents([event({ id: 'ready', status: 'draft' })])).toEqual([])
  })

  it('is not something already finished', () => {
    for (const status of ['closed', 'revealed'] as EventStatus[]) {
      expect(onNowEvents([event({ id: status, status })])).toEqual([])
    }
  })

  it('holds every event that is open at once', () => {
    // Parallel tracks. Sessions are event-scoped, so two rooms can vote
    // simultaneously, and an organiser running both needs both in reach.
    const events = [
      event({ id: 'track-a', status: 'open', votingLive: true }),
      event({ id: 'draft', status: 'draft' }),
      event({ id: 'track-b', status: 'open', votingLive: true }),
    ]
    expect(onNowEvents(events).map((row) => row.id)).toEqual(['track-a', 'track-b'])
  })

  it('never surfaces something filed away', () => {
    const events = [
      event({ id: 'filed', status: 'open', votingLive: true, archivedAt: '2026-07-30T00:00:00.000Z' }),
    ]
    expect(onNowEvents(events)).toEqual([])
  })
})

describe('what can be filed away', () => {
  it('is only a finished event', () => {
    // Archiving takes an event out of the landing page's reckoning. Offering it
    // on a draft or a live event would be offering to hide an event from a room
    // that is being told to scan for it.
    for (const status of STATUSES) {
      expect(canArchive(event({ id: status, status }))).toBe(
        status === 'closed' || status === 'revealed',
      )
    }
  })

  it('is not offered twice on something already filed', () => {
    expect(
      canArchive(event({ id: 'done', status: 'revealed', archivedAt: '2026-07-30T00:00:00.000Z' })),
    ).toBe(false)
  })
})
