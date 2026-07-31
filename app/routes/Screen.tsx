import { useEffect, useRef, useState } from 'react'
import { api, type TallyRow } from '../api'
import { ResultsBars } from '../components/ResultsBars'
import { Skeleton, SkeletonRows } from '../components/Skeleton'
import { messageFor } from '../messages'
import { gsap, motionOk, useGSAP } from '../motion'
import { joinNames, leaders } from '../ranking'

type Payload = {
  event: { name: string }
  tally: TallyRow[]
  /** Complete ballots — the denominator behind every number on this screen. */
  ballots: number
  maxScore: number
}

/**
 * When the standings rows start fading in: 0.6s of heading, then a held beat.
 *
 * Named because two things have to agree about it. The rows are brought in by a
 * `from` tween, and GSAP renders a `from` immediately on creation even when it
 * sits later in a timeline, so the rows are pinned at opacity 0 from the first
 * frame. ResultsBars grows its bars on the same render, so it has to be told to
 * wait: otherwise the growth happens entirely inside those invisible rows and
 * the reveal becomes finished bars flying in.
 */
const ROWS_IN_AT = 0.6 + 0.45

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

  // Everyone on the top count. The tally arrives in a total order, so reading
  // tally[0] as "the winner" would announce whichever tied demo happened to have
  // the lower slot number, in the largest type on the largest screen in the room.
  const winners = payload ? leaders(payload.tally) : []
  const settledWithRows = Boolean(payload?.tally.length)

  useGSAP(
    () => {
      if (!settledWithRows || !motionOk()) return
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
          ROWS_IN_AT,
        )
        .from(
          '[data-anim="winner"]',
          { scale: 0.82, opacity: 0, duration: 0.6, ease: 'back.out(1.9)', clearProps: 'all' },
          '-=0.15',
        )
    },
    { dependencies: [settledWithRows], scope: rootRef },
  )

  if (error === 'PENDING') {
    return (
      <div className="screen screen--waiting" ref={rootRef}>
        {/* The same pulse a waiting phone shows, for the same reason and with
            more riding on it: this is on a wall in front of a room, and a
            projector holding a still page is the picture of a machine that has
            crashed. It has not — it is polling, and it will turn into the
            standings by itself. */}
        <div className="waiting__pulse" aria-hidden="true">
          <span />
        </div>
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
      <div className="screen" ref={rootRef} aria-busy="true">
        <span className="visually-hidden" role="status">
          Loading the standings
        </span>
        <Skeleton height="1rem" width="16rem" />
        <Skeleton height="4rem" width="60%" />
        <SkeletonRows rows={4} height="4rem" />
      </div>
    )
  }

  return (
    <div className="screen" ref={rootRef}>
      <div className="eyebrow" data-anim="screen-head">
        <span className="label">{payload.event.name}</span>
        {/* Ballots, not scores. The sum of every score in the room is a large
            number that means nothing to anybody looking at it; the number of
            people whose ballots counted is the figure that tells the room how
            much weight the standings carry. */}
        <span className="label">
          {payload.ballots} {payload.ballots === 1 ? 'ballot' : 'ballots'}
        </span>
      </div>

      {/* Says the word out loud, and says it on a single winner too. Two names
          in 4rem type with no label reads as a layout accident, and one name in
          4rem type reads as a title — the room has to be told this is the
          result. The standings underneath show the counts. */}
      {winners.length > 0 ? (
        <span className="label screen__place" data-anim="screen-head">
          {winners.length > 1 ? 'Joint first place' : 'First place'}
        </span>
      ) : null}

      <div>
        <h1 data-anim="winner">
          {winners.length > 0
            ? joinNames(winners.map((row) => row.name))
            : 'No ballots were counted'}
        </h1>

        {/* The team, and what the name above it actually scored. The largest
            type in the room was carrying no evidence at all: a name, and then
            a list somebody at the back has to find it in again to learn
            anything about it. Only for a single winner — on a tie there are two
            teams and two identical averages, and the rows below say it better
            than a comma would. */}
        {winners.length === 1 ? (
          <p className="screen__sub" data-anim="screen-head">
            {winners[0]!.team ? `${winners[0]!.team} · ` : ''}
            {winners[0]!.average.toFixed(1)} out of {payload.maxScore} on average
          </p>
        ) : null}
      </div>

      {/* Starts growing a fraction after the rows begin arriving, so the first
          thing the room sees in a row is an empty track, and then it fills. */}
      <ResultsBars
        tally={payload.tally}
        maxScore={payload.maxScore}
        revealed
        // Nothing was counted, so nothing is ranked. The heading above already
        // says so; the column beside the rows should not contradict it by
        // numbering six demos joint first.
        ranked={payload.ballots > 0}
        fillDelay={ROWS_IN_AT + 0.15}
      />
    </div>
  )
}
