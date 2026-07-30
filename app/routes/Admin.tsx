import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AdminEvent, type AdminResults, type EventStatus } from '../api'
import { CountdownRing } from '../components/CountdownRing'
import { EventPicker } from '../components/EventPicker'
import { ResultsBars } from '../components/ResultsBars'
import { RollingNumber } from '../components/RollingNumber'
import { VoteQr } from '../components/VoteQr'
import { STATUS_LABEL, messageFor } from '../messages'

const RESULTS_POLL_MS = 2000
const DEFAULT_DEMO_COUNT = 6

type DemoDraft = { slot: number; name: string; team: string }

function blankRoster(): DemoDraft[] {
  return Array.from({ length: DEFAULT_DEMO_COUNT }, (_, index) => ({
    slot: index + 1,
    name: `Demo ${index + 1}`,
    team: '',
  }))
}

export function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<AdminResults | null>(null)
  const [busy, setBusy] = useState(false)
  // Archived events stay out of the way until asked for. By the twentieth event
  // the picker is mostly history, and the one being run today is the only one
  // anybody is looking for.
  const [showArchived, setShowArchived] = useState(false)

  const refreshState = useCallback(async () => {
    const result = await api.get<{ events: AdminEvent[] }>('/api/admin/state')
    if (!result.ok) {
      if (result.status === 401) setAuthed(false)
      return
    }
    setAuthed(true)
    setEvents(result.data.events)
    setSelectedId((current) => current ?? result.data.events[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  const archivedCount = events.filter((event) => event.archivedAt).length
  const listed = showArchived ? events : events.filter((event) => !event.archivedAt)
  const selected = listed.find((event) => event.id === selectedId) ?? null

  // Archiving the event on screen, or hiding the archive again while an archived
  // event is selected, leaves the selection pointing at something no longer in
  // the list. Fall to the newest of what is left rather than showing an empty
  // dashboard that looks like the data went missing.
  useEffect(() => {
    if (selected || listed.length === 0) return
    setSelectedId(listed[0]!.id)
    setResults(null)
  }, [selected, listed])

  // The dashboard is the only live view of the tally, so it polls while voting
  // is running and stops as soon as it is not.
  useEffect(() => {
    if (!selectedId || !authed) return
    let cancelled = false

    async function poll() {
      const result = await api.get<AdminResults>(`/api/admin/event/${selectedId}/results`)
      if (!cancelled && result.ok) setResults(result.data)
    }

    void poll()
    if (selected?.status !== 'open') return () => {
      cancelled = true
    }

    const timer = window.setInterval(poll, RESULTS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selectedId, authed, selected?.status])

  async function login(submitted: React.FormEvent) {
    submitted.preventDefault()
    setBusy(true)
    setError(null)
    const result = await api.post('/api/admin/session', { password })
    setBusy(false)
    if (!result.ok) {
      setError(messageFor(result.error))
      return
    }
    setPassword('')
    await refreshState()
  }

  async function act(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    const result = await api.post(path, body)
    setBusy(false)
    if (!result.ok) {
      setError(messageFor(result.error))
      return null
    }
    await refreshState()
    return result.data
  }

  if (authed === null) {
    return (
      <div className="shell">
        <span className="label">Loading</span>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="shell">
        <form className="stack" onSubmit={login}>
          <div className="eyebrow">
            <span className="label">Demo Vote</span>
            <span className="label">Organiser</span>
          </div>
          <h1>Organiser sign in</h1>
          <div className="field">
            <label htmlFor="admin-password">Admin password</label>
            <input
              id="admin-password"
              className="input"
              type="password"
              value={password}
              onChange={(changed) => setPassword(changed.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="error" role="alert">
            {error}
          </div>
          <button className="btn" type="submit" disabled={busy || password.length === 0}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="shell shell--wide">
      <div className="stack">
        <div className="eyebrow">
          <span className="label">Demo Vote · Organiser</span>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={async () => {
              await api.del('/api/admin/session')
              setAuthed(false)
            }}
          >
            Sign out
          </button>
        </div>

        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}

        <CreateEvent
          busy={busy}
          onCreate={async (name, windowSeconds, demos) => {
            const created = await act('/api/admin/event', { name, windowSeconds, demos })
            if (created && typeof created === 'object' && 'eventId' in created) {
              setSelectedId((created as { eventId: string }).eventId)
            }
          }}
        />

        {/* A select rather than a row of buttons: this tool is meant to be
            reused, and by the twentieth event a button row would wrap into a
            wall. Newest first, since that is almost always the one wanted. */}
        {listed.length > 1 ? (
          <EventPicker
            label="Event"
            value={selectedId ?? ''}
            options={listed.map((event) => ({
              id: event.id,
              label: `${event.name} · ${
                event.archivedAt ? 'Archived' : STATUS_LABEL[event.status]
              }`,
            }))}
            onChange={(id) => {
              setSelectedId(id)
              setResults(null)
            }}
          />
        ) : null}

        {/* A button rather than a checkbox: a native checkbox is drawn by the
            operating system, so it would arrive looking like macOS on one laptop
            and Windows on the next. Same reasoning as EventPicker. */}
        {archivedCount > 0 ? (
          <div className="row">
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((current) => !current)}
            >
              {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
            </button>
          </div>
        ) : null}

        {selected ? (
          <EventPanel
            event={selected}
            results={results}
            busy={busy}
            onStatus={(status) => act(`/api/admin/event/${selected.id}/status`, { status })}
            onGenerate={(count) => act(`/api/admin/event/${selected.id}/codes`, { count })}
            onArchive={(archived) =>
              act(`/api/admin/event/${selected.id}/archive`, { archived })
            }
          />
        ) : events.length > 0 ? (
          <p>
            Every event is archived. Show archived to bring one back, or create a new one
            above.
          </p>
        ) : (
          <p>No events yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}

function CreateEvent({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (name: string, windowSeconds: number, demos: DemoDraft[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [roster, setRoster] = useState<DemoDraft[]>(blankRoster)

  if (!open) {
    return (
      <button className="btn btn--ghost btn--sm" type="button" onClick={() => setOpen(true)}>
        New event
      </button>
    )
  }

  return (
    <div className="panel">
      <h2>New event</h2>

      <div className="field">
        <label htmlFor="event-name">Event name</label>
        <input
          id="event-name"
          className="input"
          value={name}
          onChange={(changed) => setName(changed.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="event-minutes">Voting window (minutes)</label>
        <input
          id="event-minutes"
          className="input"
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

      <div className="field">
        <span className="label">Demo line-up</span>
        {roster.map((demo, index) => (
          <div className="demo-editor" key={demo.slot}>
            <span className="num" aria-hidden="true">
              {String(demo.slot).padStart(2, '0')}
            </span>
            <input
              className="input"
              aria-label={`Name of demo ${demo.slot}`}
              value={demo.name}
              onChange={(changed) =>
                setRoster((current) =>
                  current.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, name: changed.target.value } : row,
                  ),
                )
              }
            />
            <input
              className="input"
              aria-label={`Team for demo ${demo.slot}`}
              placeholder="Team (optional)"
              value={demo.team}
              onChange={(changed) =>
                setRoster((current) =>
                  current.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, team: changed.target.value } : row,
                  ),
                )
              }
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

      <div className="row">
        <button
          className="btn"
          type="button"
          disabled={busy || name.trim() === ''}
          onClick={async () => {
            await onCreate(name.trim(), minutes * 60, roster)
            setOpen(false)
            setName('')
            setRoster(blankRoster())
          }}
        >
          Create
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function EventPanel({
  event,
  results,
  busy,
  onStatus,
  onGenerate,
  onArchive,
}: {
  event: AdminEvent
  results: AdminResults | null
  busy: boolean
  onStatus: (status: EventStatus) => Promise<unknown>
  onGenerate: (count: number) => Promise<unknown>
  onArchive: (archived: boolean) => Promise<unknown>
}) {
  const [count, setCount] = useState(100)
  const [generated, setGenerated] = useState<string[] | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)

  const stats = results?.stats ?? event.stats
  const voteUrl = `${window.location.origin}/v/${event.id}`

  return (
    <div className="stack">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{event.name}</h2>
          <div className="row">
            {/* The status it ended on is kept, which is the reason archiving is
                not a fifth status value: "archived" alone would lose whether this
                event finished closed or revealed. */}
            {event.archivedAt ? <span className="pill">Archived</span> : null}
            <span className="pill" data-status={event.status}>
              {STATUS_LABEL[event.status]}
            </span>
          </div>
        </div>

        <div className="stats">
          <div>
            <RollingNumber className="stat__value" value={stats.issued} />
            <span className="label">Issued</span>
          </div>
          <div>
            <RollingNumber className="stat__value" value={stats.activated} />
            <span className="label">Redeemed</span>
          </div>
          <div>
            {/* Complete ballots. The gap between this and Redeemed is the
                people who started scoring and did not finish every demo, whose
                ballots will not be counted — the one number an organiser can
                still act on while the window is open. */}
            <RollingNumber className="stat__value" value={stats.scored} />
            <span className="label">Scored all</span>
          </div>
          {event.status === 'open' && results ? (
            <CountdownRing
              initialSeconds={results.secondsRemaining}
              totalSeconds={event.windowSeconds}
            />
          ) : null}
        </div>

        <div className="field">
          <span className="label">Scan to vote</span>
          <div className="row">
            <code className="num" style={{ wordBreak: 'break-all' }}>
              {voteUrl}
            </code>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(voteUrl)}
            >
              Copy
            </button>
          </div>
          <VoteQr url={voteUrl} />
          <div className="hint">
            {/* window.location.origin, so opening /admin on localhost encodes a
                localhost URL that no phone can reach. */}
            Encodes the address you are viewing this page on. Open the dashboard from the address
            attendees will use before printing this.
          </div>
        </div>

        <div className="row" ref={confirmRef}>
          {event.status === 'draft' ? (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                // Opening starts the clock for the whole room and cannot be
                // undone, so it asks first.
                if (
                  window.confirm(
                    `Opening voting starts a ${event.windowSeconds / 60} minute countdown straight away. Continue?`,
                  )
                )
                  void onStatus('open')
              }}
            >
              Open voting
            </button>
          ) : null}

          {event.status === 'open' ? (
            <button
              className="btn btn--danger"
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Close voting early. Continue?')) void onStatus('closed')
              }}
            >
              Close now
            </button>
          ) : null}

          {event.status === 'closed' ? (
            <button className="btn" type="button" disabled={busy} onClick={() => void onStatus('revealed')}>
              Reveal results
            </button>
          ) : null}

          {event.status === 'revealed' ? (
            <a className="btn btn--ghost" href={`/screen/${event.id}`} target="_blank" rel="noreferrer">
              Open big screen
            </a>
          ) : null}

          {/* Only a finished event can be filed away, and filing is reversible.
              Archiving takes it out of the landing page's reckoning, so a draft
              or a live event must not be archivable while a room is being told to
              scan for it. */}
          {event.archivedAt ? (
            <button
              className="btn btn--ghost"
              type="button"
              disabled={busy}
              onClick={() => void onArchive(false)}
            >
              Unarchive
            </button>
          ) : event.status === 'closed' || event.status === 'revealed' ? (
            <button
              className="btn btn--ghost"
              type="button"
              disabled={busy}
              onClick={() => void onArchive(true)}
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <h2>Voting codes</h2>
        <p>
          Hand one slip to each person at check-in. Codes are 8 characters and never contain I,
          L, O, U, 0 or 1.
        </p>
        <div className="row">
          <input
            className="input"
            style={{ width: '8rem' }}
            type="number"
            min={1}
            max={5000}
            value={count}
            aria-label="Number of codes to generate"
            onChange={(changed) => setCount(Number(changed.target.value))}
          />
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={async () => {
              const created = await onGenerate(count)
              if (created && typeof created === 'object' && 'codes' in created) {
                setGenerated((created as { codes: string[] }).codes)
              }
            }}
          >
            Generate {count}
          </button>
          <a className="btn btn--ghost" href={`/api/admin/event/${event.id}/codes.csv`}>
            Download all as CSV
          </a>
        </div>

        {generated ? (
          <div className="codegrid">
            {generated.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Live tally</h2>
          {event.status === 'open' ? <span className="label">Updates every 2s</span> : null}
        </div>
        {results ? (
          <>
            {/* Stated next to the numbers rather than left to be inferred:
                partial ballots are excluded, so this is not the same as the
                number of people who scanned in, and an organiser reading a
                total needs to know how many ballots produced it. */}
            <p className="hint">
              {results.ballots} complete {results.ballots === 1 ? 'ballot' : 'ballots'} counted.
              Ballots missing a score for any demo are not included.
            </p>
            <ResultsBars
              tally={results.tally}
              maxScore={results.maxScore}
              revealed={event.status !== 'open'}
            />
          </>
        ) : (
          <p>Nothing to show yet.</p>
        )}
      </div>
    </div>
  )
}
