import type { BallotDemo } from '../api'

/**
 * One demo and the 1-5 score this ballot gives it.
 *
 * The card is not a button. A voter scores every demo rather than picking one,
 * so there is nothing for the card itself to do and making it clickable would
 * put a second, meaningless target under every score row.
 */
export function DemoCard({
  demo,
  score,
  min,
  max,
  saving,
  onScore,
}: {
  demo: BallotDemo
  /** Null until this voter has scored it. */
  score: number | null
  min: number
  max: number
  saving: boolean
  onScore: (demoId: string, score: number) => void
}) {
  const options = Array.from({ length: max - min + 1 }, (_, index) => min + index)
  const label = `Number ${demo.slot}, ${demo.name}${demo.team ? `, ${demo.team}` : ''}`
  const last = Math.max(1, options.length - 1)

  return (
    // The id is what "Next unscored" scrolls to.
    <li className="demo" id={`demo-${demo.id}`} data-scored={score !== null}>
      <div className="demo__head">
        <span className="demo__slot" aria-hidden="true">
          {String(demo.slot).padStart(2, '0')}
        </span>
        <span>
          <span className="demo__name">{demo.name}</span>
          {demo.team ? <span className="demo__team"> · {demo.team}</span> : null}
          {demo.blurb ? <div className="demo__team">{demo.blurb}</div> : null}
        </span>
        {/* Holds its space whether or not it is showing anything, so the row does
            not jump every time a score saves. Moved up here from beside the
            buttons, which is where it used to eat 3.25rem of a phone's width
            from a row of five targets. */}
        <span className="demo__state" aria-live="polite">
          {saving ? 'Saving' : score !== null ? 'Saved' : 'Not scored'}
        </span>
      </div>

      {/* A radiogroup rather than a set of toggles: exactly one of these is the
          score, and picking a different one replaces it rather than adding to
          it. The group is labelled with the demo's own name, because a screen
          reader landing on "3 of 5" six times over needs to know which demo it
          is scoring. */}
      <div className="rating" role="radiogroup" aria-label={`Score for ${label}`}>
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            className="rating__option"
            role="radio"
            aria-checked={score === option}
            // Spelled out rather than left to the digit alone, which announces
            // as a bare number with no unit and no scale.
            aria-label={`${option} out of ${max}`}
            // 0 at the bottom of the scale, 1 at the top. The stylesheet grows
            // each target from it, so the row is a staircase and which end is
            // "more" can be seen without reading anything. Computed from the
            // range the server sent rather than written into the CSS, so a scale
            // that is one day not 1-5 still climbs.
            style={{ '--ramp': index / last } as React.CSSProperties}
            onClick={() => onScore(demo.id, option)}
          >
            {option}
          </button>
        ))}
      </div>

      {/* Which end is which, said once per card. Five bare digits do not carry
          a direction: somebody scoring their favourite demo has to decide
          whether 1 is best or worst, and getting it backwards costs that demo
          the four points it was owed. Hidden from screen readers, which are
          already told "4 out of 5" on every target. */}
      <div className="anchors" aria-hidden="true">
        <span>Weakest</span>
        <span>Strongest</span>
      </div>
    </li>
  )
}
