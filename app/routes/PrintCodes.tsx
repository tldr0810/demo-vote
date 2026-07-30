import { useEffect, useState } from 'react'
import { api, type AdminEvent } from '../api'
import { renderQrSvg } from '../components/QrImage'
import { messageFor } from '../messages'
import { personalVoteUrl } from '../voteUrl'

type Slip = { code: string; dataUri: string }

/**
 * The sheet of personal QR codes, cut up and handed out at check-in.
 *
 * One slip per attendee, each carrying its own code. Scanning it lands that
 * person on the ballot with nothing to type, which is the whole point: typing
 * eight characters on a phone in a dark room was the step that lost people.
 *
 * The code is printed under its QR as well. A scanner that mangles the query
 * string, a slip that came out of the printer smudged, and a phone whose camera
 * will not focus all end at the manual entry screen, and the slip has to be able
 * to rescue them.
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

      // Rendered one at a time and appended as they land, rather than awaited as
      // one batch. Five hundred slips is five hundred encodes, and an organiser
      // watching a blank page for that long assumes it has hung.
      const origin = window.location.origin
      for (const code of codes) {
        const dataUri = await renderQrSvg(personalVoteUrl(origin, eventId, code))
        if (cancelled) return
        setSlips((previous) => [...previous, { code, dataUri }])
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
        <h1>Cannot print these codes</h1>
        <p>{error}</p>
        <a className="btn btn--ghost" href="/admin">
          Back to the dashboard
        </a>
      </div>
    )
  }

  const done = total !== null && slips.length === total

  return (
    <div className="printpage">
      {/* Everything in here is hidden by the print stylesheet: it is the
          organiser's controls, not part of what goes on paper. */}
      <div className="printbar">
        <div>
          <strong>{event?.name ?? 'Voting codes'}</strong>
          <div className="hint">
            {total === null
              ? 'Loading codes'
              : done
                ? `${total} slips ready. Print, then cut along the lines.`
                : `Rendering ${slips.length} of ${total}`}
          </div>
        </div>
        <div className="row">
          <a className="btn btn--ghost" href="/admin">
            Back
          </a>
          <button className="btn" type="button" disabled={!done} onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      {total === 0 ? (
        <p className="shell">
          This event has no codes yet. Generate a batch on the dashboard first.
        </p>
      ) : null}

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
      </div>
    </div>
  )
}
