// The panels on one event's dashboard.
//
// Split out of Admin.tsx, which had grown to twelve hundred lines holding the
// sign-in screen, two page-level layouts, a set-up form and these. Each of these
// takes what it draws and nothing else — none of them knows about the event list,
// the auth state, or how a request is made.

import { useState } from 'react'
import type { AdminEvent, AdminResults } from '../../api'
import { ResultsBars } from '../../components/ResultsBars'
import { RollingNumber } from '../../components/RollingNumber'
import { SkeletonRows } from '../../components/Skeleton'
import { VoteQr } from '../../components/VoteQr'
import { adminPrintPath } from '../../adminRoute'
import { codesCanStillBeUsed, type DashboardStatus } from '../../adminStatus'

type Toast = (label: string, detail?: string) => void

/* ------------------------------------------------------------------ turnout */

/**
 * Issued, redeemed, scored — as the funnel they actually are.
 *
 * These were three numbers side by side, which left the relationship between
 * them to be worked out by whoever was reading. The relationship is the point:
 * every step down is people who did not take the next one, and the last drop is
 * the only one still worth acting on while a window is open.
 *
 * Mounted twice on the dashboard, in the two shapes below, with CSS showing
 * exactly one of them. On a laptop it is a band across the top of the page: it is
 * the summary of the whole event, it belongs directly under the event bar rather
 * than beside the tally, and lying it on its side costs a third of the height and
 * gives the bars three times the length. On a phone none of that is true — three
 * bars across 390px are 90px each and say nothing — so it stays what it has
 * always been, one of three tabs.
 */
export function TurnoutPanel({
  layout,
  stats,
  live,
  partway,
}: {
  layout: 'band' | 'panel'
  stats: { issued: number; activated: number; scored: number }
  live: boolean
  /**
   * Codes redeemed whose ballot is not finished: people who started scoring and
   * stopped. The one number on this screen an organiser can still do something
   * about, and only while the window is open.
   */
  partway: number
}) {
  const share = (value: number) => (stats.issued > 0 ? value / stats.issued : 0)

  const rows = [
    { name: 'Codes issued', value: stats.issued, fraction: stats.issued > 0 ? 1 : 0, lead: false },
    {
      name: 'Redeemed a code',
      value: stats.activated,
      fraction: share(stats.activated),
      lead: false,
    },
    { name: 'Scored every demo', value: stats.scored, fraction: share(stats.scored), lead: true },
  ]

  const body = (
    <>
      <div className={layout === 'band' ? 'funnel funnel--wide' : 'funnel'}>
        {rows.map((row) => (
          <div className="funnel__row" key={row.name} data-lead={row.lead}>
            <span className="funnel__name">{row.name}</span>
            <span className="funnel__figure">
              <RollingNumber className="funnel__value" value={row.value} />
              {stats.issued > 0 && row.value !== stats.issued ? (
                <span className="funnel__pct num">{Math.round(row.fraction * 100)}%</span>
              ) : null}
            </span>
            <div className="funnel__track">
              <div className="funnel__fill" style={{ width: `${row.fraction * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Only while it can still be changed. After the window has closed this is
          a fact about the past, and putting a warning colour on it would be
          asking the organiser to fix something that is over. */}
      {partway > 0 && live ? (
        <div className="callout">
          <span>
            <strong>
              {partway} {partway === 1 ? 'person is' : 'people are'} part-way through.
            </strong>{' '}
            A ballot counts only once every demo has a score, so these will not be included as
            things stand. There is still time to say so from the front.
          </span>
        </div>
      ) : null}

      {partway > 0 && !live ? (
        <p className="hint">
          {partway} {partway === 1 ? 'ballot was' : 'ballots were'} left unfinished and{' '}
          {partway === 1 ? 'is' : 'are'} not counted in the standings.
        </p>
      ) : null}

      {stats.issued === 0 ? (
        <p className="hint">
          No codes yet. Generate a batch under Codes and print the slips before the doors open.
        </p>
      ) : null}
    </>
  )

  if (layout === 'band') {
    return (
      <div className="dashband">
        <div className="bandhead">
          <h2>Turnout</h2>
          {live ? <span className="livedot">Live</span> : null}
        </div>
        {body}
      </div>
    )
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Turnout</h2>
        {live ? <span className="livedot">Live</span> : null}
      </div>
      {body}
    </section>
  )
}

/* -------------------------------------------------------------------- share */

export function SharePanel({ event, onToast }: { event: AdminEvent; onToast: Toast }) {
  const voteUrl = `${window.location.origin}/v/${event.id}`

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Scan to vote</h2>
      </div>

      <div className="share">
        <VoteQr url={voteUrl} />

        <div className="share__body">
          <span className="label">Shared link</span>
          <div className="urlbox">
            <code className="num">{voteUrl}</code>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard?.writeText(voteUrl)
                  onToast('Copied', 'The vote link is on your clipboard.')
                } catch {
                  // A clipboard write can be refused outright — an insecure
                  // origin, a browser that wants a fresher user gesture. Saying
                  // nothing would leave the organiser pasting whatever was on
                  // the clipboard before onto a slide.
                  onToast('Could not copy', 'Select the address and copy it by hand.')
                }
              }}
            >
              Copy
            </button>
          </div>

          {/* window.location.origin, so opening the dashboard on localhost
              encodes a localhost URL that no phone can reach. The print sheet
              builds its slips from the same origin, so this caveat covers both. */}
          <p className="hint">
            For the wall or the running-order slide. It carries no voting code, so it lands on the
            entry screen rather than on somebody's ballot. It encodes the address you are viewing
            this page on — open the dashboard from the address attendees will use before printing
            anything.
          </p>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------- codes */

export function CodesPanel({
  event,
  busy,
  issued,
  status,
  onGenerate,
  onToast,
}: {
  event: AdminEvent
  busy: boolean
  issued: number
  status: DashboardStatus
  onGenerate: (count: number) => Promise<unknown>
  onToast: Toast
}) {
  const [count, setCount] = useState(100)
  const [generated, setGenerated] = useState<string[] | null>(null)

  // Once the window has shut, a code generated here cannot be redeemed by
  // anybody. Generating stays available — it is not harmful, and an organiser
  // who wants a batch for a reprint should not be argued with — but it stops
  // being drawn as the primary action, because on a revealed event it was the
  // loudest thing on the dashboard and the one thing on it that does nothing.
  const usable = codesCanStillBeUsed(status)

  // Both ways out of a batch act on codes that exist. With none generated the
  // print sheet is a page of nothing and the CSV is a header row, so they are
  // not offered rather than offered and disappointing. `act` refetches before it
  // resolves, so this count is already the new one by the time a batch lands.
  const hasCodes = issued > 0

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Voting codes</h2>
        <span className="hint num">{issued} issued</span>
      </div>

      {!usable ? (
        <p className="hint">
          Voting is over, so a new code cannot be redeemed.
          {hasCodes ? ' The sheet and the CSV are still here for the record.' : ''}
        </p>
      ) : null}

      <div className="row">
        <input
          className="input input--count"
          type="number"
          min={1}
          max={5000}
          value={count}
          aria-label="Number of codes to generate"
          onChange={(changed) => setCount(Number(changed.target.value))}
        />
        <button
          className={usable ? 'btn' : 'btn btn--ghost'}
          type="button"
          disabled={busy}
          data-busy={busy}
          onClick={async () => {
            const created = await onGenerate(count)
            if (created && typeof created === 'object' && 'codes' in created) {
              const codes = (created as { codes: string[] }).codes
              setGenerated(codes)
              onToast(
                'Generated',
                `${codes.length} more ${codes.length === 1 ? 'code' : 'codes'}. Print the slips before the doors open.`,
              )
            }
          }}
        >
          Generate {count}
        </button>
      </div>

      {/* The two ways out of a batch, on a row of their own rather than trailing
          the generate control. They are the same kind of thing as each other and
          a different kind of thing from making codes, and left in one wrapping
          row the line breaks landed wherever the label lengths happened to fall:
          on a phone that was three buttons on three lines at three different
          widths, which reads as an accident rather than as a set of choices. */}
      {hasCodes ? (
        <div className="row row--pair">
          {/* A full page load rather than a navigate, deliberately: the print
              sheet renders a QR per code and the organiser prints it, closes it
              and comes back. There is no state worth carrying across. */}
          <a className="btn btn--ghost btn--sm" href={adminPrintPath(event.id)}>
            Print slips
          </a>
          <a className="btn btn--ghost btn--sm" href={`/api/admin/event/${event.id}/codes.csv`}>
            Save CSV
          </a>
        </div>
      ) : null}

      {/* Four lines of explanation that nobody reads during an event, kept for
          the first time somebody sets this up and folded away the rest of the
          time. The panel above it is a set of controls again. */}
      <details className="explain">
        <summary>How the slips work</summary>
        <p>
          One code per person. Print the sheet and hand a slip to each person at check-in — scanning
          it opens their ballot with nothing to type. Print a few spares: the slip carries its code
          in the QR only, so a slip that will not scan is replaced rather than typed in. The codes
          themselves are in the CSV, for reading one out to somebody genuinely stuck.
        </p>
      </details>

      {generated ? (
        <div className="codegrid" aria-label="Codes generated just now">
          {generated.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------- tally */

/**
 * "Live tally" was the heading in every state, including the ones where nothing
 * about it is live. On a revealed event it sat above a set of final numbers with
 * the "updating every 2s" badge correctly absent, which is the panel telling the
 * organiser two different things at once.
 */
function tallyHeading(status: DashboardStatus): string {
  if (status === 'open') return 'Live tally'
  // Nothing has been counted and nothing is going to be until voting opens.
  if (status === 'draft') return 'Tally'
  return 'Final standings'
}

export function TallyPanel({
  results,
  status,
  live,
}: {
  results: AdminResults | null
  status: DashboardStatus
  live: boolean
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{tallyHeading(status)}</h2>
        {live ? <span className="livedot">Updating every 2s</span> : null}
      </div>

      {results ? (
        <>
          {/* Stated next to the numbers rather than left to be inferred:
              partial ballots are excluded, so this is not the same as the
              number of people who scanned in, and an organiser reading a
              total needs to know how many ballots produced it. */}
          <p className="hint">
            {results.ballots} complete {results.ballots === 1 ? 'ballot' : 'ballots'} counted.
            Ballots missing a score for any demo are not included.
          </p>

          <ResultsBars
            tally={results.tally}
            maxScore={results.maxScore}
            ranked={results.ballots > 0}
            // A leader is highlighted only once the tally is final. Until then
            // the standings are shown in full — this screen is the organiser's
            // and nobody else can see it — but calling a leader while the window
            // is open would be naming something that can still change.
            revealed={!live}
          />

          {live ? (
            <p className="hint">
              Only you can see this. The room sees nothing until you reveal, and the order can still
              change.
            </p>
          ) : status === 'closed' ? (
            <p className="hint">Final. Reveal when the room is ready.</p>
          ) : null}
        </>
      ) : status === 'draft' ? (
        <p>Scores appear here as ballots come in. Open voting to start.</p>
      ) : (
        <SkeletonRows rows={4} height="3.25rem" />
      )}
    </section>
  )
}
