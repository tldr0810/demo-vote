// The organiser's front page.
//
// There was no such page. /admin was one event's dashboard with a picker in the
// app bar, which meant the set of events only existed as a dropdown, and the two
// things that are about the set rather than about one event — creating one, filing
// one away — had to be put somewhere on a page belonging to a single event.
// "Manage events" ended up in the middle of the left column of a dashboard, next
// to a live tally, which is where it looked wrong enough to be noticed.

import type { AdminEvent } from '../../api'
import { archivedCount, canArchive, listedEvents, onNowEvents } from '../../adminEvents'
import { adminEventPath } from '../../adminRoute'
import { dashboardStatus } from '../../adminStatus'
import { STATUS_LABEL } from '../../messages'
import { navigate } from '../../router'

type Toast = (label: string, detail?: string) => void

function minutesOf(seconds: number): number {
  return Math.round(seconds / 60)
}

/**
 * 12:20. When a window closes, not how long is left in it.
 *
 * A countdown belongs on the event's own dashboard, where a two-second poll keeps
 * it honest and CountdownRing ticks it. This page does not poll: it is a launcher,
 * refetched when the organiser comes back to the tab. "27:22 left" printed once
 * and then left alone is a lie within a minute of being rendered, and it is the
 * kind of lie somebody reads off a laptop and says out loud to a room. A clock
 * time is as true an hour later as it was when the page loaded.
 */
function endsAt(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** 31 Jul. The year is left off: an organiser reading this list knows what year it is. */
function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function EventList({
  events,
  busy,
  showArchived,
  onShowArchived,
  onArchive,
  onNew,
  onToast,
}: {
  events: AdminEvent[]
  busy: boolean
  showArchived: boolean
  onShowArchived: (show: boolean) => void
  onArchive: (event: AdminEvent, archived: boolean) => Promise<unknown>
  onNew: () => void
  onToast: Toast
}) {
  const archived = archivedCount(events)
  const listed = listedEvents(events, showArchived)
  const onNow = onNowEvents(events)

  if (events.length === 0) {
    return (
      <div className="shell">
        <div className="empty">
          <span className="label">No event on</span>
          <h1>Nothing set up yet</h1>
          <p>
            An event is a name, a voting window and the running order of the demos. It takes about a
            minute, and nothing goes live until you open voting.
          </p>
          <div className="row">
            <button className="btn btn--lg" type="button" onClick={onNew}>
              Create an event
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell shell--wide">
      <div className="stack">
        <div>
          <span className="label">Organiser</span>
          <h1>Events</h1>
          <p>
            Everything you have set up, newest first. Open one to run it: the line-up, the codes and
            the tally all live inside the event.
          </p>
        </div>

        {/* The event being run today, above the list it is also in.
            On the day, this page is a doorway the organiser goes through while a
            room waits, and hunting for today's event in a list of twenty is the
            wrong thing to be doing at that moment. Plural, because sessions are
            event-scoped and two rooms can vote at once. */}
        {onNow.length > 0 ? (
          <section className="panel evfeature">
            <div className="panel__head">
              <h2>On now</h2>
              <span className="livedot">Live</span>
            </div>

            {onNow.map((event) => {
              // The event's own reading of the clock, taken by the server when
              // this list was fetched. It is what lets a window that ran out on
              // its own say so here rather than still claiming to be open.
              const status = dashboardStatus(event, event)
              const closes = endsAt(event.closesAt)
              return (
                <div className="evrow evrow--feature" key={event.id}>
                  <div className="evrow__id">
                    <a
                      className="evrow__open"
                      href={adminEventPath(event.id)}
                      onClick={(clicked) => {
                        if (clicked.metaKey || clicked.ctrlKey || clicked.shiftKey) return
                        clicked.preventDefault()
                        navigate(adminEventPath(event.id))
                      }}
                    >
                      {event.name}
                    </a>
                    <span className="hint">
                      {event.demos.length} {event.demos.length === 1 ? 'demo' : 'demos'}
                      {status === 'ended'
                        ? ' · window ended'
                        : closes
                          ? ` · closes ${closes}`
                          : ''}
                    </span>
                  </div>

                  <div className="evrow__state">
                    <span className="pill" data-status={status}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>

                  <Counts event={event} />

                  <span className="btn btn--sm evrow__go">Open dashboard</span>
                </div>
              )
            })}
          </section>
        ) : null}

        <section className="panel">
          <div className="panel__head">
            <h2>All events</h2>
            <span className="hint num">{listed.length}</span>
          </div>

          {/* No arrow at the end of a row. The whole row is the target — the name
              lays a stretched ::after over it — so an arrow would point at
              something you are already standing on.

              The row is a div and only the name is a link. A row-shaped <a> with
              an Archive button inside it is nested interactive content: invalid
              HTML, and a screen reader reads the button's label as part of the
              link's name. */}
          <div className="evlist">
            {listed.map((event) => {
              const status = dashboardStatus(event, event)
              return (
                <div className="evrow" key={event.id}>
                  <div className="evrow__id">
                    <a
                      className="evrow__open"
                      href={adminEventPath(event.id)}
                      onClick={(clicked) => {
                        // Modified clicks belong to the browser: an organiser
                        // opening two parallel tracks in two tabs is doing
                        // something reasonable, and the href is real.
                        if (clicked.metaKey || clicked.ctrlKey || clicked.shiftKey) return
                        clicked.preventDefault()
                        navigate(adminEventPath(event.id))
                      }}
                    >
                      {event.name}
                    </a>
                    <span className="hint">
                      {event.demos.length} {event.demos.length === 1 ? 'demo' : 'demos'} ·{' '}
                      {minutesOf(event.windowSeconds)} min · created {shortDate(event.createdAt)}
                    </span>
                  </div>

                  <div className="evrow__state">
                    {/* The status it ended on is kept, which is why archiving is
                        not a fifth status value: "archived" alone would lose
                        whether this event finished closed or revealed. */}
                    {event.archivedAt ? <span className="pill">Archived</span> : null}
                    <span className="pill" data-status={status}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>

                  <Counts event={event} />

                  {/* Filing an event away, on the row it acts on. Empty on the
                      rows that cannot be filed — a draft, a live event — and it
                      holds its width so the column does not jump down the list. */}
                  <span className="evrow__manage">
                    {event.archivedAt ? (
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          await onArchive(event, false)
                          onToast('Unarchived', `${event.name} is back in the list.`)
                        }}
                      >
                        Unarchive
                      </button>
                    ) : canArchive(event) ? (
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          await onArchive(event, true)
                          onToast('Archived', `${event.name} is filed away. Its standings are kept.`)
                        }}
                      >
                        Archive
                      </button>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>

          {/* A button rather than a checkbox: a native checkbox is drawn by the
              operating system, so it would arrive looking like macOS on one
              laptop and Windows on the next. Same reasoning as EventPicker. */}
          {archived > 0 ? (
            <div className="evlist__foot">
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                aria-pressed={showArchived}
                onClick={() => onShowArchived(!showArchived)}
              >
                {showArchived ? 'Hide archived' : `Show archived (${archived})`}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

/**
 * Issued, redeemed, ballots.
 *
 * The same three figures the event's own dashboard opens with, so a row and the
 * page behind it agree at a glance. `scored` is the count of complete ballots —
 * see worker/data.ts — which is why it is labelled that rather than "scored".
 */
function Counts({ event }: { event: AdminEvent }) {
  return (
    <div className="evrow__stats">
      <span>
        <b className="num">{event.stats.issued}</b>
        <i className="label">issued</i>
      </span>
      <span>
        <b className="num">{event.stats.activated}</b>
        <i className="label">redeemed</i>
      </span>
      <span>
        <b className="num">{event.stats.scored}</b>
        <i className="label">ballots</i>
      </span>
    </div>
  )
}
