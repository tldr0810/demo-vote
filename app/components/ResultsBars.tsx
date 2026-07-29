import { useRef } from 'react'
import type { TallyRow } from '../api'
import { Flip, gsap, motionOk, useGSAP } from '../motion'
import { rankTally } from '../ranking'

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
export function ResultsBars({ tally, revealed }: { tally: TallyRow[]; revealed: boolean }) {
  const listRef = useRef<HTMLUListElement>(null)
  const flipState = useRef<Flip.FlipState | null>(null)

  const total = tally.reduce((sum, row) => sum + row.votes, 0)
  const leaderVotes = tally[0]?.votes ?? 0

  // Captured during render, while the DOM still holds the previous order.
  // React has not committed the new children yet at this point, and this only
  // reads layout, never writes it.
  if (listRef.current) {
    flipState.current = Flip.getState(listRef.current.querySelectorAll('.result'))
  }

  useGSAP(
    () => {
      const list = listRef.current
      if (!list) return
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
          ease: 'power2.out',
          overwrite: true,
        })
      })
    },
    { dependencies: [tally], scope: listRef },
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
              <span className="result__count">{row.votes}</span>
              <div className="label">{percent}%</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
