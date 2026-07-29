import type { BallotDemo } from '../api'

export function DemoCard({
  demo,
  selected,
  onSelect,
}: {
  demo: BallotDemo
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        className="demo"
        // aria-pressed rather than a checked radio: this is a toggle the voter
        // can change their mind about right up until they confirm.
        aria-pressed={selected}
        // Spelled out rather than left to the computed name. The slot number is
        // aria-hidden (it is decoration next to the title for sighted readers),
        // and without this the button announces only the blurb, which is the
        // least useful part of the card.
        aria-label={`Number ${demo.slot}, ${demo.name}${demo.team ? `, ${demo.team}` : ''}`}
        onClick={() => onSelect(demo.id)}
      >
        <span className="demo__slot" aria-hidden="true">
          {String(demo.slot).padStart(2, '0')}
        </span>
        <span>
          <span className="demo__name">{demo.name}</span>
          {demo.team ? <span className="demo__team"> · {demo.team}</span> : null}
          {demo.blurb ? <div className="demo__team">{demo.blurb}</div> : null}
        </span>
      </button>
    </li>
  )
}
