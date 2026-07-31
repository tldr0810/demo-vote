import { useCallback, useEffect, useState } from 'react'
import { api, type AdminEvent, type AdminResults, type EventStatus } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CountdownRing } from '../components/CountdownRing'
import { EventPicker } from '../components/EventPicker'
import { ResultsBars } from '../components/ResultsBars'
import { RollingNumber } from '../components/RollingNumber'
import { Skeleton, SkeletonRows } from '../components/Skeleton'
import { Toasts, useToasts } from '../components/Toasts'
import { VoteQr } from '../components/VoteQr'
import { dashboardStatus, tallyCanChange, type DashboardStatus } from '../adminStatus'
import { STATUS_LABEL, messageFor } from '../messages'

const RESULTS_POLL_MS = 2000
const DEFAULT_DEMO_COUNT = 6

type DemoDraft = { slot: number; name: string; team: string }

/**
 * Which group of panels a phone is showing.
 *
 * On a laptop all three are on screen at once and this is ignored — the panels
 * are laid out in two columns and nothing is hidden. It exists because the
 * dashboard is run from whatever the organiser is holding, and at a demo day
 * that is usually a phone: one column of six stacked panels means the tally,
 * which is the thing they came to look at, is four scrolls below the fold.
 */
type Pane = 'tally' | 'turnout' | 'codes'

/** What is waiting on a confirmation. Null when no dialog is up. */
type Pending = 'open' | 'close-early' | null

function blankRoster(): DemoDraft[] {
  return Array.from({ length: DEFAULT_DEMO_COUNT }, (_, index) => ({
    slot: index + 1,
    name: `Demo ${index + 1}`,
    team: '',
  }))
}

function minutesOf(seconds: number): number {
  return Math.round(seconds / 60)
}

export function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<AdminResults | null>(null)
  const [busy, setBusy] = useState(false)
  const [pane, setPane] = useState<Pane>('tally')
  // Archived events stay out of the way until asked for. By the twentieth event
  // the picker is mostly history, and the one being run today is the only one
  // anybody is looking for.
  const [showArchived, setShowArchived] = useState(false)

  const { toasts, push } = useToasts()

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
  //
  // "Is not" has two halves, and only one of them is a status. The organiser
  // pressing Close is caught by the dependency below; the window running out on
  // its own is not, because nothing writes to the event row when a deadline
  // passes. So the second half is decided here, from the reading that discovered
  // it: `votingLive` going false means this tally is final, and every request
  // after that one comes back with the same numbers for as long as the dashboard
  // is left open.
  useEffect(() => {
    if (!selectedId || !authed) return
    let cancelled = false
    let timer = 0

    async function poll() {
      const result = await api.get<AdminResults>(`/api/admin/event/${selectedId}/results`)
      if (cancelled || !result.ok) return
      setResults(result.data)
      if (!result.data.votingLive && timer !== 0) {
        window.clearInterval(timer)
        timer = 0
      }
    }

    void poll()
    if (selected?.status !== 'open') return () => {
      cancelled = true
    }

    timer = window.setInterval(poll, RESULTS_POLL_MS)
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
      <div className="shell shell--wide">
        <div className="stack" aria-busy="true">
          <span className="visually-hidden" role="status">
            Loading the dashboard
          </span>
          <Skeleton height="2.5rem" width="14rem" />
          <Skeleton height="9rem" radius="var(--radius-surface)" />
          <SkeletonRows rows={3} height="7rem" />
        </div>
      </div>
    )
  }

  if (!authed) {
    return (
      <SignIn
        busy={busy}
        error={error}
        password={password}
        onPassword={setPassword}
        onSubmit={login}
      />
    )
  }

  return (
    <>
      <header className="appbar">
        <span className="appbar__mark">
          Demo<span>·</span>Vote
        </span>
        <span className="label appbar__role">Organiser</span>

        <span className="appbar__spacer" />

        {/* Rendered whenever there is anything to pick, including when there is
            only one thing. It used to appear at the second event, which meant
            creating one moved every control on the page down by a row. */}
        {listed.length > 0 ? (
          <EventPicker
            compact
            label="Event"
            value={selectedId ?? ''}
            // Only the selected event can be labelled from the clock — it is the
            // one the polled results describe. The rest fall back to their own
            // status, which is what dashboardStatus does with no reading. That
            // asymmetry is the honest one: the alternative is this list
            // contradicting the pill three lines below it about the very event
            // being looked at.
            options={listed.map((event) => ({
              id: event.id,
              label: `${event.name} · ${
                event.archivedAt
                  ? 'Archived'
                  : STATUS_LABEL[
                      dashboardStatus(event, results?.event.id === event.id ? results : null)
                    ]
              }`,
            }))}
            onChange={(id) => {
              setSelectedId(id)
              setResults(null)
            }}
          />
        ) : null}

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
      </header>

      {selected ? (
        <EventDashboard
          key={selected.id}
          event={selected}
          results={results?.event.id === selected.id ? results : null}
          busy={busy}
          error={error}
          pane={pane}
          onPane={setPane}
          onToast={push}
          onStatus={(status) => act(`/api/admin/event/${selected.id}/status`, { status })}
          onGenerate={(count) => act(`/api/admin/event/${selected.id}/codes`, { count })}
          onArchive={(archived) => act(`/api/admin/event/${selected.id}/archive`, { archived })}
          onCreate={async (name, windowSeconds, demos) => {
            const created = await act('/api/admin/event', { name, windowSeconds, demos })
            if (created && typeof created === 'object' && 'eventId' in created) {
              setSelectedId((created as { eventId: string }).eventId)
              setResults(null)
            }
          }}
          archivedCount={archivedCount}
          showArchived={showArchived}
          onShowArchived={setShowArchived}
        />
      ) : (
        <EmptyDashboard
          busy={busy}
          hasArchived={events.length > 0}
          archivedCount={archivedCount}
          onShowArchived={() => setShowArchived(true)}
          onCreate={async (name, windowSeconds, demos) => {
            const created = await act('/api/admin/event', { name, windowSeconds, demos })
            if (created && typeof created === 'object' && 'eventId' in created) {
              setSelectedId((created as { eventId: string }).eventId)
              setResults(null)
            }
          }}
        />
      )}

      <Toasts toasts={toasts} />
    </>
  )
}

/* ------------------------------------------------------------------ sign in */

function SignIn({
  busy,
  error,
  password,
  onPassword,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  password: string
  onPassword: (value: string) => void
  onSubmit: (submitted: React.FormEvent) => void
}) {
  return (
    <div className="auth">
      {/* The half that says what this is. On a phone it collapses to a heading
          above the form rather than disappearing: somebody signing in on their
          own device at the back of a room is the likeliest person not to have
          seen this tool before. */}
      <div className="auth__brand">
        <div className="auth__brandhead">
          <p className="auth__mark">
            Demo<span>·</span>Vote
          </p>
          <p className="auth__blurb">
            Scoring for a demo day. Hand out a slip at check-in, everybody scores every demo from
            their own phone, and the standings go up on the big screen when you say so.
          </p>
        </div>

        <ol className="auth__steps">
          <li>
            <b>01</b>
            <span>Create the event and its line-up</span>
          </li>
          <li>
            <b>02</b>
            <span>Print the slips for the check-in desk</span>
          </li>
          <li>
            <b>03</b>
            <span>Open voting — the window closes itself</span>
          </li>
          <li>
            <b>04</b>
            <span>Reveal, and put it on the big screen</span>
          </li>
        </ol>
      </div>

      <form className="auth__form" onSubmit={onSubmit}>
        <div>
          <span className="label">Organiser</span>
          <h1>Sign in to run an event</h1>
        </div>

        <div className="field">
          <label htmlFor="admin-password">Admin password</label>
          <input
            id="admin-password"
            className="input"
            type="password"
            value={password}
            onChange={(changed) => onPassword(changed.target.value)}
            autoComplete="current-password"
            aria-describedby="admin-password-error"
          />
        </div>

        <div className="error" id="admin-password-error" role="alert">
          {error}
        </div>

        <button
          className="btn btn--block btn--lg"
          type="submit"
          disabled={busy || password.length === 0}
          data-busy={busy}
        >
          {busy ? 'Signing in' : 'Sign in'}
        </button>

        <p className="hint">
          The password is set when this deployment is configured. If you do not have it, ask
          whoever set it up — it cannot be recovered from here.
        </p>
      </form>
    </div>
  )
}

/* ------------------------------------------------------- nothing to show yet */

function EmptyDashboard({
  busy,
  hasArchived,
  archivedCount,
  onShowArchived,
  onCreate,
}: {
  busy: boolean
  hasArchived: boolean
  archivedCount: number
  onShowArchived: () => void
  onCreate: (name: string, windowSeconds: number, demos: DemoDraft[]) => Promise<void>
}) {
  const [creating, setCreating] = useState(false)

  if (creating) {
    return (
      <div className="shell shell--wide">
        <CreateEvent busy={busy} onCreate={onCreate} onDone={() => setCreating(false)} />
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="empty">
        <span className="label">No event on</span>
        <h1>{hasArchived ? 'Everything is filed away' : 'Nothing set up yet'}</h1>
        <p>
          {hasArchived
            ? 'Every event you have run is archived. Bring one back to look at its standings, or set up the next one.'
            : 'An event is a name, a voting window and the running order of the demos. It takes about a minute, and nothing goes live until you open voting.'}
        </p>
        <div className="row">
          <button className="btn btn--lg" type="button" onClick={() => setCreating(true)}>
            Create an event
          </button>
          {hasArchived ? (
            <button className="btn btn--ghost" type="button" onClick={onShowArchived}>
              Show archived ({archivedCount})
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- dashboard */

function EventDashboard({
  event,
  results,
  busy,
  error,
  pane,
  onPane,
  onToast,
  onStatus,
  onGenerate,
  onArchive,
  onCreate,
  archivedCount,
  showArchived,
  onShowArchived,
}: {
  event: AdminEvent
  results: AdminResults | null
  busy: boolean
  error: string | null
  pane: Pane
  onPane: (pane: Pane) => void
  onToast: (label: string, detail?: string) => void
  onStatus: (status: EventStatus) => Promise<unknown>
  onGenerate: (count: number) => Promise<unknown>
  onArchive: (archived: boolean) => Promise<unknown>
  onCreate: (name: string, windowSeconds: number, demos: DemoDraft[]) => Promise<void>
  archivedCount: number
  showArchived: boolean
  onShowArchived: (show: boolean) => void
}) {
  const [pending, setPending] = useState<Pending>(null)
  const [creating, setCreating] = useState(false)

  const stats = results?.stats ?? event.stats
  const status = dashboardStatus(event, results)
  const live = tallyCanChange(status)

  // The gap between a code redeemed and a ballot that will be counted: people
  // who started scoring and have not finished. The one number on this screen an
  // organiser can still do something about, and only while the window is open.
  const partway = Math.max(0, stats.activated - stats.scored)

  if (creating) {
    return (
      <div className="shell shell--wide">
        <CreateEvent busy={busy} onCreate={onCreate} onDone={() => setCreating(false)} />
      </div>
    )
  }

  return (
    <>
      {/* One sticky block rather than three stacked sticky elements. Each of
          them would need to know the height of everything above it, and those
          heights are not constants: the event name wraps to two lines on a
          phone, and a browser set to larger text moves all of them at once. */}
      <div className="topbars">
        <EventBar
          event={event}
          results={results}
          status={status}
          live={live}
          busy={busy}
          onOpen={() => setPending('open')}
          onCloseEarly={() => setPending('close-early')}
          onClose={() => void onStatus('closed')}
          onReveal={() => void onStatus('revealed')}
          onNewEvent={() => setCreating(true)}
        />

        {/* Hidden on a laptop, where every panel below is already on screen. */}
        <div className="tabs" role="tablist" aria-label="Dashboard sections">
          {(
            [
              ['tally', 'Tally'],
              ['turnout', 'Turnout'],
              ['codes', 'Codes'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className="tab"
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={pane === id}
              aria-controls={`pane-${id}`}
              onClick={() => onPane(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="shell--flush">
          <div className="error" role="alert">
            {error}
          </div>
        </div>
      ) : null}

      <div className="dash" data-pane={pane}>
        <div className="dash__col">
          <div className="pane" data-pane="turnout" id="pane-turnout" role="tabpanel" aria-labelledby="tab-turnout">
            <TurnoutPanel stats={stats} live={live} partway={partway} status={status} />
            <ManagePanel
              event={event}
              busy={busy}
              archivedCount={archivedCount}
              showArchived={showArchived}
              onShowArchived={onShowArchived}
              onArchive={onArchive}
              onToast={onToast}
            />
          </div>

          <div className="pane" data-pane="codes" id="pane-codes" role="tabpanel" aria-labelledby="tab-codes">
            <SharePanel event={event} onToast={onToast} />
            <CodesPanel event={event} busy={busy} issued={stats.issued} onGenerate={onGenerate} onToast={onToast} />
          </div>
        </div>

        <div className="dash__col">
          <div className="pane" data-pane="tally" id="pane-tally" role="tabpanel" aria-labelledby="tab-tally">
            <TallyPanel results={results} status={status} live={live} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pending === 'open'}
        eyebrow="Starts the clock for the room"
        title="Open voting now?"
        body="Everybody holding a slip can start scoring straight away, and the window begins counting down from this moment. It cannot be paused."
        facts={[
          { value: `${minutesOf(event.windowSeconds)} min`, label: 'window' },
          { value: String(event.demos.length), label: 'demos' },
          { value: String(event.stats.issued), label: 'codes issued' },
        ]}
        confirmLabel="Open voting"
        cancelLabel="Not yet"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null)
          void onStatus('open')
        }}
      />

      <ConfirmDialog
        open={pending === 'close-early'}
        tone="danger"
        eyebrow="Cannot be undone"
        title="Close voting now?"
        body="Scoring stops for everybody immediately, including the people who have not finished. Their ballots stay incomplete and will not be counted."
        facts={[
          { value: clockOf(results?.secondsRemaining ?? 0), label: 'time left' },
          { value: String(partway), label: 'part-way' },
          { value: String(stats.scored), label: 'will count' },
        ]}
        confirmLabel="Close now"
        cancelLabel="Keep voting open"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null)
          void onStatus('closed')
        }}
      />
    </>
  )
}

function clockOf(seconds: number): string {
  const safe = Math.max(0, seconds)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/* ----------------------------------------------------------------- event bar */

/**
 * What the event is doing, and the one thing to do about it.
 *
 * Sticky, because the answer to "how long is left" should not depend on where
 * the page happens to be scrolled. Exactly one primary action lives here at a
 * time: the four statuses form a line — open, close, reveal, project — and only
 * ever one step of it is available. Everything reversible or rare is in Manage
 * event, further down, where it cannot be hit by somebody reaching for the
 * button they actually wanted.
 */
function EventBar({
  event,
  results,
  status,
  live,
  busy,
  onOpen,
  onCloseEarly,
  onClose,
  onReveal,
  onNewEvent,
}: {
  event: AdminEvent
  results: AdminResults | null
  status: DashboardStatus
  live: boolean
  busy: boolean
  onOpen: () => void
  onCloseEarly: () => void
  onClose: () => void
  onReveal: () => void
  onNewEvent: () => void
}) {
  return (
    <div className="eventbar">
      <div className="eventbar__id">
        <h1 className="eventbar__name">{event.name}</h1>
        <div className="eventbar__meta">
          {/* The status it ended on is kept, which is the reason archiving is
              not a fifth status value: "archived" alone would lose whether this
              event finished closed or revealed. */}
          {event.archivedAt ? <span className="pill">Archived</span> : null}
          <span className="pill" data-status={status}>
            {STATUS_LABEL[status]}
          </span>
          <span className="hint">
            {event.demos.length} {event.demos.length === 1 ? 'demo' : 'demos'} ·{' '}
            {minutesOf(event.windowSeconds)} minute window
          </span>
        </div>
      </div>

      {/* Only while there is time left to show. A ring sitting at 00:00 in its
          urgent colour reads as "hurry", which is the wrong thing to say about a
          window that has already finished; the pill next to it is what carries
          that news now. */}
      {live && results ? (
        <div className="eventbar__clock">
          <CountdownRing
            initialSeconds={results.secondsRemaining}
            totalSeconds={event.windowSeconds}
          />
        </div>
      ) : null}

      <div className="eventbar__actions">
        {status === 'draft' ? (
          <button className="btn btn--lg" type="button" disabled={busy} onClick={onOpen}>
            Open voting
          </button>
        ) : null}

        {/* Still the same transition either way — `closed` is what unlocks
            Reveal — but only one of the two takes anything away from anybody.
            Cutting a window short costs the room the time it had left, so it
            asks first; confirming the end of a window that has already run out
            would be asking permission to agree with the clock. */}
        {status === 'open' ? (
          <button
            className="btn btn--lg btn--danger"
            type="button"
            disabled={busy}
            onClick={onCloseEarly}
          >
            Close voting now
          </button>
        ) : null}

        {status === 'ended' ? (
          <button className="btn btn--lg" type="button" disabled={busy} onClick={onClose}>
            Close voting
          </button>
        ) : null}

        {status === 'closed' ? (
          <button className="btn btn--lg" type="button" disabled={busy} onClick={onReveal}>
            Reveal results
          </button>
        ) : null}

        {status === 'revealed' ? (
          <a
            className="btn btn--lg"
            href={`/screen/${event.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open big screen
          </a>
        ) : null}

        <button className="btn btn--ghost eventbar__new" type="button" onClick={onNewEvent}>
          New event
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ turnout */

/**
 * Issued, redeemed, scored — as the funnel they actually are.
 *
 * These were three numbers side by side, which left the relationship between
 * them to be worked out by whoever was reading. The relationship is the point:
 * every step down is people who did not take the next one, and the last drop is
 * the only one still worth acting on while a window is open.
 */
function TurnoutPanel({
  stats,
  live,
  partway,
  status,
}: {
  stats: { issued: number; activated: number; scored: number }
  live: boolean
  partway: number
  status: DashboardStatus
}) {
  const share = (value: number) => (stats.issued > 0 ? value / stats.issued : 0)

  const rows = [
    { name: 'Codes issued', value: stats.issued, fraction: stats.issued > 0 ? 1 : 0, lead: false },
    { name: 'Redeemed a code', value: stats.activated, fraction: share(stats.activated), lead: false },
    { name: 'Scored every demo', value: stats.scored, fraction: share(stats.scored), lead: true },
  ]

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Turnout</h2>
        {live ? <span className="livedot">Live</span> : null}
      </div>

      <div className="funnel">
        {rows.map((row) => (
          <div className="funnel__row" key={row.name} data-lead={row.lead}>
            <span className="funnel__name">{row.name}</span>
            <span className="funnel__figure">
              <RollingNumber className="funnel__value" value={row.value} />
              {stats.issued > 0 && row.value !== stats.issued ? (
                <span className="funnel__pct num">{Math.round(row.fraction * 100)}%</span>
              ) : null}
            </span>
            <div className="funnel__track">
              <div className="funnel__fill" style={{ width: `${row.fraction * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Only while it can still be changed. After the window has closed this is
          a fact about the past, and putting a warning colour on it would be
          asking the organiser to fix something that is over. */}
      {partway > 0 && live ? (
        <div className="callout">
          <span>
            <strong>
              {partway} {partway === 1 ? 'person is' : 'people are'} part-way through.
            </strong>{' '}
            A ballot counts only once every demo has a score, so these will not be included as
            things stand. There is still time to say so from the front.
          </span>
        </div>
      ) : null}

      {partway > 0 && !live ? (
        <p className="hint">
          {partway} {partway === 1 ? 'ballot was' : 'ballots were'} left unfinished and{' '}
          {partway === 1 ? 'is' : 'are'} not counted in the standings.
        </p>
      ) : null}

      {stats.issued === 0 ? (
        <p className="hint">
          No codes yet. Generate a batch under {status === 'draft' ? 'Codes' : 'Codes'} and print
          the slips before the doors open.
        </p>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------- share */

function SharePanel({ event, onToast }: { event: AdminEvent; onToast: (label: string, detail?: string) => void }) {
  const voteUrl = `${window.location.origin}/v/${event.id}`

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Scan to vote</h2>
      </div>

      <div className="share">
        <VoteQr url={voteUrl} />

        <div className="share__body">
          <span className="label">Shared link</span>
          <div className="urlbox">
            <code className="num">{voteUrl}</code>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard?.writeText(voteUrl)
                  onToast('Copied', 'The vote link is on your clipboard.')
                } catch {
                  // A clipboard write can be refused outright — an insecure
                  // origin, a browser that wants a fresher user gesture. Saying
                  // nothing would leave the organiser pasting whatever was on
                  // the clipboard before onto a slide.
                  onToast('Could not copy', 'Select the address and copy it by hand.')
                }
              }}
            >
              Copy
            </button>
          </div>

          {/* window.location.origin, so opening /admin on localhost encodes a
              localhost URL that no phone can reach. The print sheet builds its
              slips from the same origin, so this caveat covers both. */}
          <p className="hint">
            For the wall or the running-order slide. It carries no voting code, so it lands on the
            entry screen rather than on somebody's ballot. It encodes the address you are viewing
            this page on — open the dashboard from the address attendees will use before printing
            anything.
          </p>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------- codes */

function CodesPanel({
  event,
  busy,
  issued,
  onGenerate,
  onToast,
}: {
  event: AdminEvent
  busy: boolean
  issued: number
  onGenerate: (count: number) => Promise<unknown>
  onToast: (label: string, detail?: string) => void
}) {
  const [count, setCount] = useState(100)
  const [generated, setGenerated] = useState<string[] | null>(null)

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Voting codes</h2>
        <span className="hint num">{issued} issued</span>
      </div>

      <div className="row">
        <input
          className="input input--count"
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
          data-busy={busy}
          onClick={async () => {
            const created = await onGenerate(count)
            if (created && typeof created === 'object' && 'codes' in created) {
              const codes = (created as { codes: string[] }).codes
              setGenerated(codes)
              onToast(
                'Generated',
                `${codes.length} more ${codes.length === 1 ? 'code' : 'codes'}. Print the slips before the doors open.`,
              )
            }
          }}
        >
          Generate {count}
        </button>
        {/* A full page load rather than a router push, deliberately: the print
            sheet renders a QR per code and the organiser prints it, closes it
            and comes back. There is no state worth carrying across. */}
        <a className="btn btn--ghost" href={`/admin/print/${event.id}`}>
          Print QR slips
        </a>
        <a className="btn btn--ghost" href={`/api/admin/event/${event.id}/codes.csv`}>
          Download CSV
        </a>
      </div>

      {/* Four lines of explanation that nobody reads during an event, kept for
          the first time somebody sets this up and folded away the rest of the
          time. The panel above it is a set of controls again. */}
      <details className="explain">
        <summary>How the slips work</summary>
        <p>
          One code per person. Print the sheet and hand a slip to each person at check-in — scanning
          it opens their ballot with nothing to type. Print a few spares: the slip carries its code
          in the QR only, so a slip that will not scan is replaced rather than typed in. The codes
          themselves are in the CSV, for reading one out to somebody genuinely stuck.
        </p>
      </details>

      {generated ? (
        <div className="codegrid" aria-label="Codes generated just now">
          {generated.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------- manage */

function ManagePanel({
  event,
  busy,
  archivedCount,
  showArchived,
  onShowArchived,
  onArchive,
  onToast,
}: {
  event: AdminEvent
  busy: boolean
  archivedCount: number
  showArchived: boolean
  onShowArchived: (show: boolean) => void
  onArchive: (archived: boolean) => Promise<unknown>
  onToast: (label: string, detail?: string) => void
}) {
  // Only a finished event can be filed away, and filing is reversible.
  // Archiving takes it out of the landing page's reckoning, so a draft or a live
  // event must not be archivable while a room is being told to scan for it.
  const canArchive = event.status === 'closed' || event.status === 'revealed'

  if (!canArchive && !event.archivedAt && archivedCount === 0) return null

  return (
    <section className="panel panel--quiet">
      <div className="panel__head">
        <h2>Manage events</h2>
      </div>

      <div className="row">
        {event.archivedAt ? (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy}
            onClick={async () => {
              await onArchive(false)
              onToast('Unarchived', `${event.name} is back in the list.`)
            }}
          >
            Unarchive this event
          </button>
        ) : canArchive ? (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy}
            onClick={async () => {
              await onArchive(true)
              onToast('Archived', `${event.name} is filed away. Its standings are kept.`)
            }}
          >
            Archive this event
          </button>
        ) : null}

        {/* A button rather than a checkbox: a native checkbox is drawn by the
            operating system, so it would arrive looking like macOS on one laptop
            and Windows on the next. Same reasoning as EventPicker. */}
        {archivedCount > 0 ? (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            aria-pressed={showArchived}
            onClick={() => onShowArchived(!showArchived)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        ) : null}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------- tally */

function TallyPanel({
  results,
  status,
  live,
}: {
  results: AdminResults | null
  status: DashboardStatus
  live: boolean
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Live tally</h2>
        {live ? <span className="livedot">Updating every 2s</span> : null}
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
            ranked={results.ballots > 0}
            // A leader is highlighted only once the tally is final. Until then
            // the standings are shown in full — this screen is the organiser's
            // and nobody else can see it — but calling a leader while the window
            // is open would be naming something that can still change.
            revealed={!live}
          />

          {live ? (
            <p className="hint">
              Only you can see this. The room sees nothing until you reveal, and the order can still
              change.
            </p>
          ) : status === 'closed' ? (
            <p className="hint">Final. Reveal when the room is ready.</p>
          ) : null}
        </>
      ) : status === 'draft' ? (
        <p>Scores appear here as ballots come in. Open voting to start.</p>
      ) : (
        <SkeletonRows rows={4} height="3.25rem" />
      )}
    </section>
  )
}

/* ------------------------------------------------------------- create event */

/**
 * A page rather than a panel.
 *
 * The line-up editor is a row per demo of three fields, and there can be twenty
 * of them. Inside a panel on the dashboard that was a wall in the middle of the
 * controls, and on a phone the three-column grid it is built from collapsed into
 * something unusable. Setting an event up happens once, before anything is live,
 * so it can have the screen to itself.
 */
function CreateEvent({
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
    setRoster((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
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
          onClick={async () => {
            await onCreate(name.trim(), minutes * 60, roster)
            onDone()
          }}
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
