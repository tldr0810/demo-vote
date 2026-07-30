import type { BallotDemo } from '../api'

/**
 * One demo and the 1-5 score this ballot gives it.
 *
 * The card is no longer a button. A voter scores every demo rather than picking
 * one, so there is nothing for the card itself to do and making it clickable
 * would put a second, meaningless target under every score row.
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

  return (
    <li className="demo" data-scored={score !== null}>
      <div className="demo__head">
        <span className="demo__slot" aria-hidden="true">
          {String(demo.slot).padStart(2, '0')}
        </span>
        <span>
          <span className="demo__name">{demo.name}</span>
          {demo.team ? <span className="demo__team"> · {demo.team}</span> : null}
          {demo.blurb ? <div className="demo__team">{demo.blurb}</div> : null}
        </span>
      </div>

      {/* A radiogroup rather than a set of toggles: exactly one of these is the
          score, and picking a different one replaces it rather than adding to
          it. The group is labelled with the demo's own name, because a screen
          reader landing on "3 of 5" six times over needs to know which demo it
          is scoring. */}
      <div className="rating" role="radiogroup" aria-label={`Score for ${label}`}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="rating__option"
            role="radio"
            aria-checked={score === option}
            // Spelled out rather than left to the digit alone, which announces
            // as a bare number with no unit and no scale.
            aria-label={`${option} out of ${max}`}
            onClick={() => onScore(demo.id, option)}
          >
            {option}
          </button>
        ))}
        {/* Holds its space whether or not it is showing anything, so the row
            does not jump every time a score saves. */}
        <span className="rating__state" aria-live="polite">
          {saving ? 'Saving' : score !== null ? 'Saved' : ''}
        </span>
      </div>
    </li>
  )
}
