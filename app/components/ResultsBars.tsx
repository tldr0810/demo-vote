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
  revealed,
  fillDelay = 0,
}: {
  tally: TallyRow[]
  revealed: boolean
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

  const total = tally.reduce((sum, row) => sum + row.votes, 0)
  const leaderVotes = tally[0]?.votes ?? 0

  // The dashboard polls every two seconds and hands us a fresh array each time,
  // so the array identity changes constantly while the numbers in it do not.
  // Keying the work to the values means an unchanged tally costs nothing: no
  // layout read, no tween, no rAF burning for the hour a dashboard is left open.
  const signature = tally.map((row) => `${row.demoId}:${row.votes}`).join(',')

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
        // Bars are scaled against the leader, not against the total. With six
        // demos splitting the room the longest bar would otherwise sit at a
        // fifth of the track and the chart would read as empty.
        const share = leaderVotes > 0 ? row.votes / leaderVotes : 0
        const percent = total > 0 ? Math.round((row.votes / total) * 100) : 0
        // Every demo sharing the top count, not the first row of the array. On a
        // tie the array order is decided by slot number, which is not a result.
        const isLeader = revealed && row.leading

        return (
          <li
            key={row.demoId}
            className={`result${isLeader ? ' result--leader' : ''}`}
            data-flip-id={row.demoId}
          >
            <span className="result__rank num">{String(row.rank).padStart(2, '0')}</span>
            <div className="result__body">
              <div className="result__name">{row.name}</div>
              {row.team ? <div className="demo__team">{row.team}</div> : null}
              <div className="result__track">
                <div className="result__fill" data-share={share} />
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <RollingNumber className="result__count" value={row.votes} />
              <div className="label">
                <RollingNumber value={percent} suffix="%" />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
