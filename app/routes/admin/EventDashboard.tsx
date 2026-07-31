// One event, while it is being run.
//
// Everything about the set of events has moved to EventList: creating one, filing
// one away, choosing between them. What is left is the four-step line an organiser
// walks down — open, close, reveal, project — and the three things they watch
// while walking it.

import { useEffect, useState } from 'react'
import { api, type AdminEvent, type AdminResults, type EventStatus } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CountdownRing } from '../../components/CountdownRing'
import { SkeletonRows } from '../../components/Skeleton'
import { dashboardStatus, tallyCanChange, type DashboardStatus } from '../../adminStatus'
import { STATUS_LABEL } from '../../messages'
import { CodesPanel, SharePanel, TallyPanel, TurnoutPanel } from './panels'

const RESULTS_POLL_MS = 2000

/**
 * Which group of panels a phone is showing.
 *
 * On a laptop all of them are on screen at once and this is ignored — turnout is
 * a band across the top and the other two are the two columns under it. It exists
 * because the dashboard is run from whatever the organiser is holding, and at a
 * demo day that is usually a phone: one column of five stacked panels means the
 * tally, which is the thing they came to look at, is four scrolls below the fold.
 */
type Pane = 'tally' | 'turnout' | 'codes'

/** What is waiting on a confirmation. Null when no dialog is up. */
type Pending = 'open' | 'close-early' | null

type Toast = (label: string, detail?: string) => void

function minutesOf(seconds: number): number {
  return Math.round(seconds / 60)
}

function clockOf(seconds: number): string {
  const safe = Math.max(0, seconds)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function EventDashboard({
  event,
  busy,
  error,
  onStatus,
  onGenerate,
  onToast,
}: {
  event: AdminEvent
  busy: boolean
  error: string | null
  onStatus: (status: EventStatus) => Promise<unknown>
  onGenerate: (count: number) => Promise<unknown>
  onToast: Toast
}) {
  const [pending, setPending] = useState<Pending>(null)
  const [pane, setPane] = useState<Pane>('tally')
  const [results, setResults] = useState<AdminResults | null>(null)

  // The dashboard is the only live view of the tally, so it polls while voting
  // is running and stops as soon as it is not.
  //
  // "Is not" has two halves, and only one of them is a status. The organiser
  // pressing Close is caught by the dependency below; the window running out on
  // its own is not, because nothing writes to the event row when a deadline
  // passes. So the second half is decided here, from the reading that discovered
  // it: `votingLive` going false means this tally is final, and every request
  // after that one comes back with the same numbers for as long as the dashboard
  // is left open.
  useEffect(() => {
    let cancelled = false
    let timer = 0

    async function poll() {
      const result = await api.get<AdminResults>(`/api/admin/event/${event.id}/results`)
      if (cancelled || !result.ok) return
      setResults(result.data)
      if (!result.data.votingLive && timer !== 0) {
        window.clearInterval(timer)
        timer = 0
      }
    }

    void poll()
    if (event.status !== 'open') {
      return () => {
        cancelled = true
      }
    }

    timer = window.setInterval(poll, RESULTS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [event.id, event.status])

  // Guards against a reading that describes a different event, which is what the
  // first poll after a navigation looks like.
  const forThisEvent = results?.event.id === event.id ? results : null
  const stats = forThisEvent?.stats ?? event.stats
  const status = dashboardStatus(event, forThisEvent)
  const live = tallyCanChange(status)

  // The gap between a code redeemed and a ballot that will be counted: people
  // who started scoring and have not finished.
  const partway = Math.max(0, stats.activated - stats.scored)

  return (
    <>
      {/* One sticky block rather than two stacked sticky elements. Each of them
          would need to know the height of everything above it, and those heights
          are not constants: the event name wraps to two lines on a phone, and a
          browser set to larger text moves both at once. */}
      <div className="topbars">
        <EventBar
          event={event}
          results={forThisEvent}
          status={status}
          live={live}
          busy={busy}
          onOpen={() => setPending('open')}
          onCloseEarly={() => setPending('close-early')}
          onClose={() => void onStatus('closed')}
          onReveal={() => void onStatus('revealed')}
        />

        {/* Hidden on a laptop, where every panel below is already on screen. */}
        <div className="tabs" role="tablist" aria-label="Dashboard sections">
          {(
            [
              ['tally', 'Tally'],
              ['turnout', 'Turnout'],
              ['codes', 'Codes'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className="tab"
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={pane === id}
              aria-controls={`pane-${id}`}
              onClick={() => setPane(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Turnout, across the page and directly under the event bar, because it is
          the summary of the whole event rather than something that belongs beside
          the tally. Hidden below 62rem, where the same component is mounted in
          the pane the Turnout tab switches to. */}
      <TurnoutPanel layout="band" stats={stats} live={live} partway={partway} />

      {error ? (
        <div className="shell--flush">
          <div className="error" role="alert">
            {error}
          </div>
        </div>
      ) : null}

      {/* Two columns of equal width. The tally takes the reading side; the right
          column is the set of things done to the event and sticks to the top, so
          a twenty-demo tally scrolls past it rather than leaving dead space
          beside it. */}
      <div className="dash" data-pane={pane}>
        <div className="dash__col">
          <div
            className="pane"
            data-pane="tally"
            id="pane-tally"
            role="tabpanel"
            aria-labelledby="tab-tally"
          >
            <TallyPanel results={forThisEvent} status={status} live={live} />
          </div>

          {/* The phone's copy of Turnout. One component, two mount points, and
              CSS showing exactly one of them at any width. */}
          <div
            className="pane"
            data-pane="turnout"
            id="pane-turnout"
            role="tabpanel"
            aria-labelledby="tab-turnout"
          >
            <TurnoutPanel layout="panel" stats={stats} live={live} partway={partway} />
          </div>
        </div>

        <div className="dash__col dash__col--side">
          <div
            className="pane"
            data-pane="codes"
            id="pane-codes"
            role="tabpanel"
            aria-labelledby="tab-codes"
          >
            <SharePanel event={event} onToast={onToast} />
            <CodesPanel
              event={event}
              busy={busy}
              issued={stats.issued}
              onGenerate={onGenerate}
              onToast={onToast}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pending === 'open'}
        eyebrow="Starts the clock for the room"
        title="Open voting now?"
        body="Everybody holding a slip can start scoring straight away, and the window begins counting down from this moment. It cannot be paused."
        facts={[
          { value: `${minutesOf(event.windowSeconds)} min`, label: 'window' },
          { value: String(event.demos.length), label: 'demos' },
          { value: String(event.stats.issued), label: 'codes issued' },
        ]}
        confirmLabel="Open voting"
        cancelLabel="Not yet"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null)
          void onStatus('open')
        }}
      />

      <ConfirmDialog
        open={pending === 'close-early'}
        tone="danger"
        eyebrow="Cannot be undone"
        title="Close voting now?"
        body="Scoring stops for everybody immediately, including the people who have not finished. Their ballots stay incomplete and will not be counted."
        facts={[
          { value: clockOf(forThisEvent?.secondsRemaining ?? 0), label: 'time left' },
          { value: String(partway), label: 'part-way' },
          { value: String(stats.scored), label: 'will count' },
        ]}
        confirmLabel="Close now"
        cancelLabel="Keep voting open"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null)
          void onStatus('closed')
        }}
      />
    </>
  )
}

/**
 * A dashboard whose event has not arrived yet.
 *
 * Only ever seen for one request: /admin/event/:id resolves against a list the
 * shell is still fetching. Worth having rather than rendering nothing, because
 * nothing is what a broken link looks like.
 */
export function DashboardSkeleton() {
  return (
    <div className="shell shell--wide">
      <div className="stack" aria-busy="true">
        <span className="visually-hidden" role="status">
          Loading the event
        </span>
        <SkeletonRows rows={3} height="7rem" />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- event bar */

/**
 * What the event is doing, and the one thing to do about it.
 *
 * Sticky, because the answer to "how long is left" should not depend on where
 * the page happens to be scrolled. Exactly one action lives here at a time: the
 * four statuses form a line — open, close, reveal, project — and only ever one
 * step of it is available.
 *
 * "New event" used to sit here beside them, which put the one control that leaves
 * this event next to the one control that changes its state, on the bar an
 * organiser reaches for while talking to a room. It is on /admin now, which is
 * where the rest of the set of events lives.
 */
function EventBar({
  event,
  results,
  status,
  live,
  busy,
  onOpen,
  onCloseEarly,
  onClose,
  onReveal,
}: {
  event: AdminEvent
  results: AdminResults | null
  status: DashboardStatus
  live: boolean
  busy: boolean
  onOpen: () => void
  onCloseEarly: () => void
  onClose: () => void
  onReveal: () => void
}) {
  return (
    <div className="eventbar">
      <div className="eventbar__id">
        <h1 className="eventbar__name">{event.name}</h1>
        <div className="eventbar__meta">
          {event.archivedAt ? <span className="pill">Archived</span> : null}
          <span className="pill" data-status={status}>
            {STATUS_LABEL[status]}
          </span>
          <span className="hint">
            {event.demos.length} {event.demos.length === 1 ? 'demo' : 'demos'} ·{' '}
            {minutesOf(event.windowSeconds)} minute window
          </span>
        </div>
      </div>

      {/* Only while there is time left to show. A ring sitting at 00:00 in its
          urgent colour reads as "hurry", which is the wrong thing to say about a
          window that has already finished; the pill next to it is what carries
          that news now. */}
      {live && results ? (
        <div className="eventbar__clock">
          <CountdownRing
            initialSeconds={results.secondsRemaining}
            totalSeconds={event.windowSeconds}
          />
        </div>
      ) : null}

      <div className="eventbar__actions">
        {status === 'draft' ? (
          <button className="btn btn--lg" type="button" disabled={busy} onClick={onOpen}>
            Open voting
          </button>
        ) : null}

        {/* Still the same transition either way — `closed` is what unlocks
            Reveal — but only one of the two takes anything away from anybody.
            Cutting a window short costs the room the time it had left, so it
            asks first; confirming the end of a window that has already run out
            would be asking permission to agree with the clock. */}
        {status === 'open' ? (
          <button
            className="btn btn--lg btn--danger"
            type="button"
            disabled={busy}
            onClick={onCloseEarly}
          >
            Close voting now
          </button>
        ) : null}

        {status === 'ended' ? (
          <button className="btn btn--lg" type="button" disabled={busy} onClick={onClose}>
            Close voting
          </button>
        ) : null}

        {status === 'closed' ? (
          <button className="btn btn--lg" type="button" disabled={busy} onClick={onReveal}>
            Reveal results
          </button>
        ) : null}

        {status === 'revealed' ? (
          <a className="btn btn--lg" href={`/screen/${event.id}`} target="_blank" rel="noreferrer">
            Open big screen
          </a>
        ) : null}
      </div>
    </div>
  )
}
