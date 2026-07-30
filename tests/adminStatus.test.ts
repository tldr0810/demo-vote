import { describe, expect, it } from 'vitest'
import type { EventStatus } from '../app/api'
import { dashboardStatus, tallyCanChange } from '../app/adminStatus'

/**
 * The one stretch of an event where the organiser's dashboard and the truth can
 * disagree.
 *
 * `events.status` is the button they last pressed. Nothing writes to that column
 * when a deadline passes, so a window that runs out on its own leaves the row
 * saying `open` for as long as nobody presses Close — which, on a dashboard left
 * open on a side monitor, is indefinitely.
 */

const OTHER: EventStatus[] = ['draft', 'closed', 'revealed']

describe('what the dashboard says an event is doing', () => {
  it('calls out a window that ran out on its own', () => {
    // The whole point. The status column still says open because pressing Close
    // is the only thing that changes it, and nobody has.
    expect(dashboardStatus({ status: 'open' }, { votingLive: false })).toBe('ended')
  })

  it('leaves a running window alone', () => {
    expect(dashboardStatus({ status: 'open' }, { votingLive: true })).toBe('open')
  })

  it('never invents an ending for a status that has no clock behind it', () => {
    // A draft has not started one, and closed and revealed are already past it.
    // `votingLive` is false for all three, so reading it without checking the
    // status first would relabel every finished event as "window ended".
    for (const status of OTHER) {
      expect(dashboardStatus({ status }, { votingLive: false })).toBe(status)
      expect(dashboardStatus({ status }, null)).toBe(status)
    }
  })

  it('falls back to the status when there is no reading to go on', () => {
    // Before the first poll lands, and while a poll for a different event is
    // still in flight. Showing the event's own status is the honest answer —
    // it is at worst late, where a stale reading would be wrong.
    expect(dashboardStatus({ status: 'open' }, null)).toBe('open')
  })
})

describe('what follows from it', () => {
  it('stops polling and releases the leader once the tally is final', () => {
    // Both hang off the same fact, which is why they are one function. An ended
    // window cannot produce a different number however many times it is asked,
    // and a standing that cannot change is not provisional any more.
    expect(tallyCanChange('open')).toBe(true)
    expect(tallyCanChange('ended')).toBe(false)
    for (const status of OTHER) {
      expect(tallyCanChange(status)).toBe(false)
    }
  })

  it('keeps polling for exactly as long as a ballot can still land', () => {
    // The dashboard is the only live view of the tally, so this is the pair that
    // decides whether an organiser is watching numbers or a photograph of them.
    expect(tallyCanChange(dashboardStatus({ status: 'open' }, { votingLive: true }))).toBe(true)
    expect(tallyCanChange(dashboardStatus({ status: 'open' }, { votingLive: false }))).toBe(false)
  })
})
