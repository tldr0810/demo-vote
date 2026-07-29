import { useEffect, useRef, useState } from 'react'
import { api, type TallyRow } from '../api'
import { ResultsBars } from '../components/ResultsBars'
import { messageFor } from '../messages'
import { gsap, motionOk, useGSAP } from '../motion'

type Payload = { event: { name: string }; tally: TallyRow[] }

/**
 * The projector view.
 *
 * Deliberately has no controls and no admin session: it is a URL you can open
 * on a venue machine you do not own, and it shows nothing at all until the
 * organiser has pressed reveal.
 */
export function Screen({ eventId }: { eventId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Polls only until the results arrive, then stops for good.
  //
  // Continuing to poll would be actively harmful: voting is already closed when
  // reveal is pressed, so the tally cannot change, and every re-render lands in
  // the middle of the 1.5s reveal stagger. An interrupted `from` tween leaves
  // its rows stranded at opacity 0, which on a projector in front of a room is
  // a blank screen where the winner should be.
  const settled = payload !== null

  useEffect(() => {
    if (settled) return
    let cancelled = false

    async function poll() {
      const result = await api.get<Payload>(`/api/results/${eventId}`)
      if (cancelled) return
      if (result.ok) {
        setPayload(result.data)
        setError(null)
      } else {
        setError(result.error === 'ADMIN_REQUIRED' ? 'PENDING' : messageFor(result.error))
      }
    }

    void poll()
    // Until then it keeps checking, so the projector flips to the standings by
    // itself the moment the organiser presses reveal.
    const timer = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [eventId, settled])

  const winner = payload?.tally[0]

  useGSAP(
    () => {
      if (!winner || !motionOk()) return
      gsap
        .timeline()
        .from('[data-anim="screen-head"]', {
          y: 24,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out',
          clearProps: 'all',
        })
        // A beat of stillness before the standings land. The pause is the
        // drama; without it the reveal is just a list appearing.
        .from(
          '.result',
          {
            y: 28,
            opacity: 0,
            duration: 0.55,
            stagger: 0.09,
            ease: 'power3.out',
            clearProps: 'all',
          },
          '+=0.45',
        )
        .from(
          '[data-anim="winner"]',
          { scale: 0.82, opacity: 0, duration: 0.6, ease: 'back.out(1.9)', clearProps: 'all' },
          '-=0.15',
        )
    },
    { dependencies: [Boolean(winner)], scope: rootRef },
  )

  if (error === 'PENDING') {
    return (
      <div className="screen" ref={rootRef}>
        <span className="label">Demo Vote</span>
        <h1>Results not published yet</h1>
        <p>This page updates itself the moment the organisers reveal them.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="screen" ref={rootRef}>
        <h1>Could not load the results</h1>
        <p>{error}</p>
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="screen" ref={rootRef}>
        <span className="label">Loading</span>
      </div>
    )
  }

  const totalVotes = payload.tally.reduce((sum, row) => sum + row.votes, 0)

  return (
    <div className="screen" ref={rootRef}>
      <div className="eyebrow" data-anim="screen-head">
        <span className="label">{payload.event.name}</span>
        <span className="label">
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      <h1 data-anim="winner">
        {winner && winner.votes > 0 ? winner.name : 'No votes were cast'}
      </h1>

      <ResultsBars tally={payload.tally} revealed />
    </div>
  )
}
