import { useEffect, useState } from 'react'
import { api, type AdminEvent } from '../api'
import { renderQrSvg } from '../components/QrImage'
import { messageFor } from '../messages'
import { personalVoteUrl } from '../voteUrl'

type Slip = { code: string; dataUri: string }

/**
 * How many slips are appended to the page at a time.
 *
 * One at a time was a re-render per QR, and a five-hundred-code event is five
 * hundred of them: the tab stops answering the scroll wheel for the length of
 * the job, which is exactly when the organiser is trying to see whether it is
 * working. Batching gives the browser a gap to paint in, and twenty-four is
 * roughly two rows of the grid, so the page still visibly grows.
 */
const BATCH = 24

/**
 * The sheet of personal QR codes, cut up and handed out at check-in.
 *
 * One slip per attendee, each carrying its own code. Scanning it lands that
 * person on the ballot with nothing to type, which is the whole point: typing
 * eight characters on a phone in a dark room was the step that lost people.
 *
 * Deliberately a page rather than a PDF export: the browser's own print dialogue
 * already does page size, margins and duplex, and it is the tool the organiser
 * has open in front of them.
 */
export function PrintCodes({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<AdminEvent | null>(null)
  const [slips, setSlips] = useState<Slip[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const state = await api.get<{ events: AdminEvent[] }>('/api/admin/state')
      if (cancelled) return
      if (!state.ok) {
        setError(state.status === 401 ? messageFor('ADMIN_REQUIRED') : messageFor(state.error))
        return
      }
      const found = state.data.events.find((candidate) => candidate.id === eventId) ?? null
      if (!found) {
        setError(messageFor('EVENT_NOT_FOUND'))
        return
      }
      setEvent(found)

      // The CSV endpoint is the one that already lists every code for an event.
      // Parsing two columns here is cheaper than a second endpoint that would
      // return the same rows in a different shape.
      const response = await fetch(`/api/admin/event/${eventId}/codes.csv`)
      if (cancelled) return
      if (!response.ok) {
        setError(messageFor('ADMIN_REQUIRED'))
        return
      }
      const codes = (await response.text())
        .split('\n')
        .slice(1)
        .map((line) => line.split(',')[0]?.trim())
        .filter((code): code is string => Boolean(code))

      if (cancelled) return
      setTotal(codes.length)

      // Rendered as they land rather than awaited as one batch. Five hundred
      // slips is five hundred encodes, and an organiser watching a blank page
      // for that long assumes it has hung.
      const origin = window.location.origin
      let pending: Slip[] = []
      for (const code of codes) {
        const dataUri = await renderQrSvg(personalVoteUrl(origin, eventId, code))
        if (cancelled) return
        pending.push({ code, dataUri })
        if (pending.length >= BATCH) {
          const batch = pending
          pending = []
          setSlips((previous) => [...previous, ...batch])
        }
      }
      if (pending.length > 0) {
        const batch = pending
        setSlips((previous) => [...previous, ...batch])
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [eventId])

  if (error) {
    return (
      <div className="shell">
        <div className="empty">
          <span className="label">Cannot print</span>
          <h1>These codes are not available</h1>
          <p>{error}</p>
          <a className="btn btn--ghost" href="/admin">
            Back to the dashboard
          </a>
        </div>
      </div>
    )
  }

  const done = total !== null && slips.length === total
  const progress = total && total > 0 ? slips.length / total : 0

  if (total === 0) {
    return (
      <div className="shell">
        <div className="empty">
          <span className="label">{event?.name ?? 'Voting codes'}</span>
          <h1>No codes to print yet</h1>
          <p>
            Generate a batch on the dashboard first — one per person expected, and a few spares.
            They appear here as printable slips.
          </p>
          <a className="btn" href="/admin">
            Back to the dashboard
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="printpage">
      {/* Everything in here is hidden by the print stylesheet: it is the
          organiser's controls, not part of what goes on paper. Stuck to the top,
          because five hundred slips is a long way to scroll back up to reach the
          one button on the page. */}
      <div className="printbar">
        <div className="printbar__row">
          <div>
            <strong>{event?.name ?? 'Voting codes'}</strong>
            <div className="hint">
              {total === null
                ? 'Finding the codes'
                : done
                  ? `${total} slips ready. Print, then cut along the dashed lines — three across.`
                  : `Rendering ${slips.length} of ${total}. Leave this page open.`}
            </div>
          </div>
          <div className="row">
            <a className="btn btn--ghost" href="/admin">
              Back
            </a>
            <button className="btn" type="button" disabled={!done} onClick={() => window.print()}>
              {done ? 'Print' : 'Rendering'}
            </button>
          </div>
        </div>

        {/* A bar rather than the counter alone. Five hundred QR codes is long
            enough that "247 of 500" does not answer the only question being
            asked, which is whether this is nearly over. */}
        {!done ? (
          <div
            className="printbar__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total ?? 0}
            aria-valuenow={slips.length}
            aria-label="Slips rendered"
          >
            <div className="printbar__fill" style={{ width: `${progress * 100}%` }} />
          </div>
        ) : null}
      </div>

      <div className="slips">
        {/* The code itself is not printed. It was here as the fallback for a
            slip that would not scan, but the fallback that actually works is a
            spare slip: the recovery for a bad piece of paper is another piece of
            paper, not eight characters typed into a phone in a dark room. The
            code still exists — it is in the CSV and on the dashboard — so a
            steward can read one out for somebody genuinely stuck, and the entry
            screen is still there to receive it. */}
        {slips.map((slip) => (
          <div className="slip" key={slip.code}>
            <div className="slip__event">{event?.name}</div>
            <img className="slip__qr" src={slip.dataUri} alt="" width={190} height={190} />
            <div className="slip__hint">Scan to score the demos</div>
          </div>
        ))}

        {/* The shape of what is still coming, so the grid does not appear to
            end where the rendering happens to have got to. Capped: an organiser
            printing five thousand does not need five thousand grey boxes. */}
        {!done && total !== null
          ? Array.from({ length: Math.min(BATCH, total - slips.length) }, (_, index) => (
              <div className="slip slip--pending" key={`pending-${index}`} aria-hidden="true">
                <span className="skeleton slip__qr" />
              </div>
            ))
          : null}
      </div>
    </div>
  )
}
