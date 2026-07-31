import { useState } from 'react'

export type DemoDraft = { slot: number; name: string; team: string }

const DEFAULT_DEMO_COUNT = 6

function blankRoster(): DemoDraft[] {
  return Array.from({ length: DEFAULT_DEMO_COUNT }, (_, index) => ({
    slot: index + 1,
    name: `Demo ${index + 1}`,
    team: '',
  }))
}

/**
 * A page rather than a panel, on a URL of its own.
 *
 * The line-up editor is a row per demo of three fields, and there can be twenty
 * of them. Inside a panel on the dashboard that was a wall in the middle of the
 * controls, and on a phone the three-column grid it is built from collapsed into
 * something unusable. Setting an event up happens once, before anything is live,
 * so it can have the screen to itself.
 *
 * /admin/new rather than a flag on the page it was opened from, so that the back
 * button leaves the form. It used to be a piece of component state, which meant
 * back went to whatever was open before the dashboard — usually nothing.
 */
export function CreateEvent({
  busy,
  onCreate,
  onDone,
}: {
  busy: boolean
  onCreate: (name: string, windowSeconds: number, demos: DemoDraft[]) => Promise<void>
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [roster, setRoster] = useState<DemoDraft[]>(blankRoster)

  function updateDemo(index: number, patch: Partial<DemoDraft>) {
    setRoster((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    )
  }

  return (
    <div className="stack">
      <div className="eyebrow">
        <span className="label">New event</span>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>

      <h1>Set up an event</h1>
      <p>Nothing here is visible to anybody until you open voting.</p>

      <section className="panel">
        <div className="field">
          <label htmlFor="event-name">Event name</label>
          <input
            id="event-name"
            className="input"
            value={name}
            onChange={(changed) => setName(changed.target.value)}
            placeholder="Demo Day"
          />
        </div>

        <div className="field">
          <label htmlFor="event-minutes">Voting window (minutes)</label>
          <input
            id="event-minutes"
            className="input input--count"
            type="number"
            min={1}
            max={480}
            value={minutes}
            onChange={(changed) => setMinutes(Number(changed.target.value))}
          />
          <div className="hint">
            Counts down from the moment you open voting, and closes itself when it runs out.
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>Demo line-up</h2>
          <span className="hint num">{roster.length}</span>
        </div>

        <div className="field">
          {roster.map((demo, index) => (
            <div className="demo-editor" key={demo.slot}>
              <span className="num demo-editor__slot" aria-hidden="true">
                {String(demo.slot).padStart(2, '0')}
              </span>
              <input
                className="input"
                aria-label={`Name of demo ${demo.slot}`}
                value={demo.name}
                onChange={(changed) => updateDemo(index, { name: changed.target.value })}
              />
              <input
                className="input"
                aria-label={`Team for demo ${demo.slot}`}
                placeholder="Team (optional)"
                value={demo.team}
                onChange={(changed) => updateDemo(index, { team: changed.target.value })}
              />
            </div>
          ))}

          <div className="row">
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() =>
                setRoster((current) => [
                  ...current,
                  { slot: current.length + 1, name: `Demo ${current.length + 1}`, team: '' },
                ])
              }
            >
              Add one
            </button>
            {roster.length > 1 ? (
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => setRoster((current) => current.slice(0, -1))}
              >
                Remove one
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="row">
        <button
          className="btn btn--lg"
          type="button"
          disabled={busy || name.trim() === ''}
          data-busy={busy}
          onClick={() => void onCreate(name.trim(), minutes * 60, roster)}
        >
          Create event
        </button>
        <button className="btn btn--ghost" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
