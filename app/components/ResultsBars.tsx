import { useRef } from 'react'
import type { TallyRow } from '../api'
import { Flip, gsap, motionOk, useGSAP } from '../motion'
import { rankTally } from '../ranking'
import { RollingNumber } from './RollingNumber'

/**
 * The tally, as a ranked list of bars.
 *
 * Two pieces of motion here. Bars grow with scaleX so the browser keeps them on
 * the compositor while the dashboard polls. Rank changes are handled by Flip:
 * the list is captured before React reorders the DOM and the rows are then
 * animated from their old positions, which turns "the numbers jumped" into
 * "Demo 4 just overtook Demo 2" — the only thing anyone in the room is watching
 * for.
 */
export function ResultsBars({
  tally,
  maxScore,
  revealed,
  ranked = true,
  fillDelay = 0,
}: {
  tally: TallyRow[]
  /** Top of the scoring scale, from the server. Bars are drawn against it. */
  maxScore: number
  revealed: boolean
  /**
   * Whether there is a ranking to show yet.
   *
   * False before the first complete ballot, when every demo is on zero and so
   * every demo is joint first. That is arithmetically true and reads as a bug:
   * an organiser watching a dashboard before the doors open sees the number 01
   * six times down the left of the list. The demos are numbered by their slot
   * instead, which is what they are called on the ballot and on the running
   * order, and the column becomes a ranking as soon as there is one.
   */
  ranked?: boolean
  /**
   * Holds the bars at zero for this many seconds before they grow.
   *
   * The projector fades its rows in on a timeline that starts them at 1.05s. The
   * fill tween is created by this component on the same render, so without a
   * matching delay the bars finish growing while their rows are still at opacity
   * 0 and the room sees full-length bars fly in rather than bars filling up.
   */
  fillDelay?: number
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const flipState = useRef<Flip.FlipState | null>(null)
  const capturedFor = useRef<string | null>(null)

  // The dashboard polls every two seconds and hands us a fresh array each time,
  // so the array identity changes constantly while the numbers in it do not.
  // Keying the work to the values means an unchanged tally costs nothing: no
  // layout read, no tween, no rAF burning for the hour a dashboard is left open.
  const signature = tally.map((row) => `${row.demoId}:${row.score}`).join(',')

  // Captured during render, while the DOM still holds the previous order. React
  // has not committed the new children yet at this point, and this only reads
  // layout, never writes it.
  if (listRef.current && signature !== capturedFor.current) {
    flipState.current = Flip.getState(listRef.current.querySelectorAll('.result'))
  }

  useGSAP(
    () => {
      const list = listRef.current
      if (!list) return
      capturedFor.current = signature
      const animate = motionOk()

      if (flipState.current && animate) {
        Flip.from(flipState.current, { duration: 0.55, ease: 'power3.inOut', absolute: true })
      }

      list.querySelectorAll<HTMLElement>('.result__fill').forEach((fill) => {
        const share = Number(fill.dataset.share ?? 0)
        // Duration 0 rather than skipping the call: the bars start at scaleX(0)
        // in CSS, so under reduced motion they still have to be set, just
        // without the sweep.
        gsap.to(fill, {
          scaleX: share,
          duration: animate ? 0.7 : 0,
          delay: animate ? fillDelay : 0,
          ease: 'power2.out',
          overwrite: true,
        })
      })
    },
    { dependencies: [signature, fillDelay], scope: listRef },
  )

  if (tally.length === 0) {
    return <p>No demos have been added yet.</p>
  }

  return (
    <ul className="results" ref={listRef}>
      {rankTally(tally).map((row) => {
        // Bars run against the top of the scale rather than against the leader.
        // Under one-vote-each the leader was the only sensible reference, because
        // six demos splitting a room left every bar near the left edge. An
        // average out of five has a meaningful ceiling of its own, and using it
        // means a bar length says something absolute — four out of five is four
        // fifths of the track whether or not anything beat it.
        const share = maxScore > 0 ? Math.min(1, row.average / maxScore) : 0
        // Every demo sharing the top score, not the first row of the array. On a
        // tie the array order is decided by slot number, which is not a result.
        const isLeader = revealed && row.leading

        return (
          <li
            key={row.demoId}
            className={`result${isLeader ? ' result--leader' : ''}`}
            data-flip-id={row.demoId}
          >
            <span className="result__rank num">
              {String(ranked ? row.rank : row.slot).padStart(2, '0')}
            </span>
            <div className="result__body">
              <div className="result__name">{row.name}</div>
              {row.team ? <div className="demo__team">{row.team}</div> : null}
              <div className="result__track">
                <div className="result__fill" data-share={share} />
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {/* The total is what the ranking is on, so it is the headline.
                  RollingNumber counts through the integers between two values,
                  which is right for a sum and wrong for an average — 4.3 has no
                  integers to roll through — so the average is plain text. */}
              <RollingNumber className="result__count" value={row.score} />
              <div className="label">
                {row.average.toFixed(1)} / {maxScore}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
