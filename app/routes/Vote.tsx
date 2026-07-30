import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Ballot, type PublicEvent, type ScoreSaved, type TallyRow } from '../api'
import { CountdownRing } from '../components/CountdownRing'
import { DemoCard } from '../components/DemoCard'
import { ResultsBars } from '../components/ResultsBars'
import { messageFor } from '../messages'
import { gsap, motionOk, useGSAP } from '../motion'
import { codeFromSearch, stripCodeFromUrl } from '../voteUrl'

type Phase = 'loading' | 'entry' | 'ballot' | 'unavailable' | 'results'

type Results = {
  event: { name: string }
  tally: TallyRow[]
  ballots: number
  maxScore: number
}

const CODE_LENGTH = 8

/**
 * How often a phone asks what has happened to the event it is on.
 *
 * The projector polls every three seconds because there is one of it and a room
 * is watching it. A phone has two hundred copies of itself on the same venue
 * wifi and nobody is waiting for a number to twitch, so this is deliberately
 * slower. It also stops for good on the first success, which means each phone
 * makes a handful of requests over the whole event and then goes quiet.
 */
const REVEAL_POLL_MS = 8000

export function Vote({ eventId }: { eventId: string | null }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [event, setEvent] = useState<PublicEvent | null>(null)
  const [ballot, setBallot] = useState<Ballot | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Results | null>(null)

  // What the voter sees, updated the instant they tap. `saved` is what the
  // server has acknowledged. They are usually identical and deliberately not the
  // same thing: the progress counter decides whether this ballot will be counted,
  // so it has to be answered by the server rather than by an optimistic update
  // that may still fail.
  const [scores, setScores] = useState<Record<string, number>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // One ticket per demo, incremented on every tap. A response whose ticket has
  // been superseded is discarded: tapping 2 and then 4 quickly enough sends two
  // requests, and if the slower one is allowed to write back it leaves the card
  // showing a score the voter has already changed their mind about.
  const tickets = useRef<Record<string, number>>({})

  const rootRef = useRef<HTMLDivElement>(null)
  const entryCardRef = useRef<HTMLDivElement>(null)
  // Read by the watcher below, which must not restart its interval every time
  // the voter moves between the entry screen and the ballot.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const applyBallot = useCallback((data: Ballot) => {
    setBallot(data)
    setScores(data.myScores)
    setSaved(data.myScores)
    setPhase('ballot')
  }, [])

  // Always asked for by event. A cookie left over from another event is refused
  // rather than answered, which is what stops a voter holding a live session
  // elsewhere from being dropped into that event instead of this one.
  const loadBallot = useCallback(
    async (forEventId: string) => {
      const result = await api.get<Ballot>(`/api/ballot?eventId=${encodeURIComponent(forEventId)}`)
      if (result.ok) applyBallot(result.data)
      return result
    },
    [applyBallot],
  )

  // Resolve which event this is, then find out whether this browser already
  // holds a session. Someone who refreshes mid-ballot should land back on the
  // ballot with the scores they have already set.
  useEffect(() => {
    let cancelled = false

    async function boot() {
      const path = eventId ? `/api/event/${eventId}` : '/api/current-event'
      const eventResult = await api.get<PublicEvent>(path)
      if (cancelled) return

      if (!eventResult.ok) {
        setError(messageFor(eventResult.error))
        setPhase('unavailable')
        return
      }
      setEvent(eventResult.data)

      // Checked before anything to do with sessions. Once the organiser has
      // revealed, the standings are what everybody should see, whether or not
      // they ever held a code: the results endpoint is public from that moment.
      // It also rescues a dead end, since scanning after voting closed used to
      // land on a screen that said so and nothing else.
      if (eventResult.data.status === 'revealed') {
        const revealed = await api.get<Results>(`/api/results/${eventResult.data.id}`)
        if (cancelled) return
        if (revealed.ok) {
          setResults(revealed.data)
          setPhase('results')
          return
        }
      }

      const ballotResult = await api.get<Ballot>(
        `/api/ballot?eventId=${encodeURIComponent(eventResult.data.id)}`,
      )
      if (cancelled) return

      // An existing session wins over a scanned code, and is checked first on
      // purpose. Someone re-scanning their own slip mid-ballot should land back
      // on the ballot rather than spend a request redeeming a code the cookie
      // already speaks for. A session for a *different* event answers 401 here,
      // so the scanned code still gets its turn below — which is what makes a
      // second event's QR work for somebody still holding the first one's.
      if (ballotResult.ok) {
        stripCodeFromUrl()
        applyBallot(ballotResult.data)
        return
      }

      if (!eventResult.data.votingLive) {
        setPhase('unavailable')
        return
      }

      // Scanned a personal QR code: redeem it and go straight to the ballot,
      // with no typing at all. The manual entry screen stays as the fallback,
      // because a scanner that mangles the query string, a slip that failed to
      // print, and a code read aloud by a steward all end up there.
      const scanned = codeFromSearch(window.location.search)
      if (scanned) {
        const redeemed = await api.post('/api/session', {
          eventId: eventResult.data.id,
          code: scanned,
        })
        if (cancelled) return

        // Cleared whether or not it worked. A code that failed will fail again
        // on every reload, and leaving it in the address bar turns one bad slip
        // into a page that cannot be recovered by refreshing.
        stripCodeFromUrl()

        if (redeemed.ok) {
          const scannedBallot = await loadBallot(eventResult.data.id)
          if (cancelled) return
          if (scannedBallot.ok) return
          setError(messageFor(scannedBallot.error))
        } else {
          setError(messageFor(redeemed.error))
        }
        // Redemption failed, or the ballot behind it did. Either way the code
        // entry screen is where somebody can do something about it, and the
        // error above says what went wrong.
        setPhase('entry')
        return
      }

      setPhase('entry')
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [eventId, applyBallot, loadBallot])

  const currentEventId = event?.id ?? null
  const demoCount = ballot?.demos.length ?? 0
  const savedCount = Object.keys(saved).length
  const complete = demoCount > 0 && savedCount >= demoCount

  // Every phone that is on this event and not already showing the standings.
  //
  // The closed screen is the obvious one. The entry screen and the ballot are
  // here because of "Close now": closing early does not move closesAt, so a
  // phone left on the ballot goes on counting down towards a deadline that no
  // longer means anything, and a phone that never redeemed a code has nothing to
  // count down at all. Neither of them would ever ask the server another
  // question, so neither would find out the event was revealed.
  //
  // A draft is excluded, and only a draft: it cannot be revealed without being
  // opened first, so watching it is traffic that can never come back with
  // anything.
  const watching =
    results === null &&
    event !== null &&
    event.status !== 'draft' &&
    (phase === 'entry' || phase === 'ballot' || phase === 'unavailable')

  /**
   * Watches the event this phone is on, and follows it to the end.
   *
   * Two things can arrive here. The standings, which replace whatever is on
   * screen, so a phone turns into the results by itself rather than telling its
   * owner to go and look elsewhere. And the news that voting is no longer live,
   * which matters more now than it did under one-vote-each: a ballot stays
   * editable for the whole window, so a phone left open on it is the normal
   * case, and it has to stop offering changes the server will refuse.
   *
   * Stops on the first set of results and never starts again: ResultsBars
   * animates its rows in, and a re-render landing mid-animation leaves them
   * stranded part-way. Screen.tsx guards the projector against exactly this.
   */
  useEffect(() => {
    if (!watching || !currentEventId) return
    let cancelled = false

    async function poll() {
      // A locked phone polling costs the venue wifi and tells nobody anything.
      if (document.visibilityState === 'hidden') return

      const current = await api.get<PublicEvent>(`/api/event/${currentEventId}`)
      if (cancelled || !current.ok) return

      if (current.data.status === 'revealed') {
        const revealed = await api.get<Results>(`/api/results/${currentEventId}`)
        // A 403 here would mean the reveal was undone, which the state machine
        // does not allow. Anything else is a network blip: keep waiting.
        if (cancelled || !revealed.ok) return
        setResults(revealed.data)
        setPhase('results')
        return
      }

      // Only on a real change. Replacing the object every eight seconds would
      // re-render this whole screen for the length of the event to say nothing.
      setEvent((previous) =>
        previous &&
        previous.status === current.data.status &&
        previous.votingLive === current.data.votingLive
          ? previous
          : current.data,
      )

      // Closed while somebody was still scoring, or still typing their code.
      // Both screens are now offering something that cannot happen.
      if (
        !current.data.votingLive &&
        (phaseRef.current === 'entry' || phaseRef.current === 'ballot')
      ) {
        setPhase('unavailable')
        setError(null)
      }
    }

    void poll()
    const timer = window.setInterval(poll, REVEAL_POLL_MS)
    // A phone picked up after the reveal should not have to sit through the rest
    // of an interval before it catches up.
    document.addEventListener('visibilitychange', poll)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [watching, currentEventId])

  async function submitCode(submittedEvent: React.FormEvent) {
    submittedEvent.preventDefault()
    if (busy || !event) return
    setBusy(true)
    setError(null)

    const result = await api.post('/api/session', { eventId: event.id, code })
    if (!result.ok) {
      setBusy(false)
      setError(messageFor(result.error))
      // A wrong code should feel wrong before it is read.
      if (motionOk()) {
        gsap.fromTo(
          entryCardRef.current,
          { x: -9 },
          { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.32)', clearProps: 'x' },
        )
      }
      return
    }

    const ballotResult = await loadBallot(event.id)
    setBusy(false)
    if (!ballotResult.ok) setError(messageFor(ballotResult.error))
  }

  /**
   * Sets one demo's score and saves it immediately.
   *
   * There is no submit button. A ballot is editable for the whole window, so a
   * "submit" would either have to be pressed again after every change — which
   * people forget, and forgetting costs them the whole ballot — or mean nothing.
   * Saving on the tap makes the score itself the commitment.
   */
  async function setScore(demoId: string, score: number) {
    if (!ballot || phase !== 'ballot') return

    const ticket = (tickets.current[demoId] ?? 0) + 1
    tickets.current[demoId] = ticket
    // Captured now rather than read after the await. Nothing else can change
    // this demo's confirmed score in the meantime: only a request for this demo
    // writes the key, and a later one would have superseded this ticket.
    const confirmed = saved[demoId]

    setScores((previous) => ({ ...previous, [demoId]: score }))
    setSaving((previous) => ({ ...previous, [demoId]: true }))
    setError(null)

    const result = await api.post<ScoreSaved>('/api/score', { demoId, score })

    // Superseded by a later tap on the same demo: that request owns this card
    // now, including the right to clear its saving state.
    if (tickets.current[demoId] !== ticket) return
    setSaving((previous) => ({ ...previous, [demoId]: false }))

    if (result.ok) {
      setSaved((previous) => ({ ...previous, [demoId]: score }))
      return
    }

    // Put the card back to the last score the server confirmed, so a failure
    // never leaves a number on screen that is not in the database. Dropping the
    // key entirely is right when there was no confirmed score: the card returns
    // to unscored and the progress line goes on saying so.
    setScores((previous) => {
      const reverted = { ...previous }
      if (confirmed === undefined) delete reverted[demoId]
      else reverted[demoId] = confirmed
      return reverted
    })

    if (result.error === 'VOTING_CLOSED') {
      setPhase('unavailable')
      return
    }
    if (result.error === 'NO_SESSION') {
      setPhase('entry')
      setError(messageFor(result.error))
      return
    }
    setError(messageFor(result.error))
  }

  // Screen-by-screen intros. Scoped to the root so selectors cannot escape,
  // and re-run on every phase change.
  // `clearProps` on every intro: once the tween lands, the inline styles GSAP
  // wrote are removed and the stylesheet is authoritative again. Without it a
  // tween interrupted by a re-render leaves an element frozen at whatever
  // opacity it had reached.
  useGSAP(
    () => {
      if (!motionOk()) return

      if (phase === 'entry') {
        gsap.from('[data-anim="entry"]', {
          y: 14,
          opacity: 0,
          duration: 0.5,
          stagger: 0.07,
          ease: 'power2.out',
          clearProps: 'all',
        })
      }
      if (phase === 'ballot') {
        gsap.from('[data-anim="ballot-head"]', {
          y: 10,
          opacity: 0,
          duration: 0.4,
          ease: 'power2.out',
          clearProps: 'all',
        })
        gsap.from('.demo', {
          y: 18,
          opacity: 0,
          duration: 0.45,
          stagger: 0.055,
          ease: 'power2.out',
          delay: 0.08,
          clearProps: 'all',
        })
      }
      if (phase === 'unavailable') {
        gsap.from('.receipt', {
          y: 16,
          opacity: 0,
          duration: 0.45,
          ease: 'power2.out',
          clearProps: 'all',
        })
      }
      // Only the heading. The bars bring their own motion, and a second tween
      // over the same rows would fight it.
      if (phase === 'results') {
        gsap.from('[data-anim="results-head"]', {
          y: 12,
          opacity: 0,
          duration: 0.45,
          stagger: 0.06,
          ease: 'power2.out',
          clearProps: 'all',
        })
      }
    },
    { dependencies: [phase], scope: rootRef },
  )

  return (
    <div className="shell" ref={rootRef}>
      {phase === 'loading' ? <p className="label">Loading</p> : null}

      {phase === 'unavailable' ? (
        <div className="stack">
          <div className="eyebrow">
            <span className="label">Demo Vote</span>
            <span className="label">{ballot?.event.name ?? event?.name}</span>
          </div>

          {/* Someone who scored every demo gets a receipt. Someone who did not
              gets told plainly that their ballot did not count, because the
              alternative is letting them leave believing it did. Neither can be
              acted on any more, so both are stated once and not dwelt on. */}
          {demoCount > 0 && complete ? (
            <div className="receipt">
              <div className="receipt__mark" aria-hidden="true">
                ✓
              </div>
              <h2>Your scores are in</h2>
              <p style={{ margin: '0 auto' }}>
                You scored all {demoCount} demos. The standings appear here the moment the
                organisers publish them, and on the big screen at the same time. Leave this page
                open.
              </p>
            </div>
          ) : demoCount > 0 ? (
            <div className="receipt">
              <h2>Voting has closed</h2>
              <p style={{ margin: '0 auto' }}>
                You scored {savedCount} of {demoCount} demos. A ballot counts only once every demo
                has a score, so this one was not included. The standings still appear here when the
                organisers publish them.
              </p>
            </div>
          ) : (
            <>
              <h1>{event?.name ?? 'Vote'}</h1>
              <p>
                {error ??
                  (event?.status === 'draft'
                    ? 'Voting has not opened yet. Wait for the organisers to announce it, then refresh this page.'
                    : 'Voting has closed. The results appear here as soon as the organisers publish them.')}
              </p>
            </>
          )}
        </div>
      ) : null}

      {phase === 'entry' && event ? (
        <form className="stack" onSubmit={submitCode}>
          <div className="eyebrow" data-anim="entry">
            <span className="label">Demo Vote</span>
            <span className="label">{event.name}</span>
          </div>

          <h1 data-anim="entry">Enter your voting code</h1>
          {/* Scanning is the way in, and the slip carries no printed code, so
              anybody reading this screen either scanned the shared event QR or
              has a code a steward read out to them. Saying where to get one is
              the only useful thing this paragraph can do. */}
          <p data-anim="entry">
            Scanning the QR code on your slip opens your ballot directly. If it will not scan, ask
            a steward for another slip, or for a code to type here.
          </p>

          <div className="field" data-anim="entry" ref={entryCardRef}>
            <label htmlFor="code">Voting code</label>
            <input
              id="code"
              className="input input--code"
              value={code}
              onChange={(changeEvent) =>
                // Strip as they type so a code copied with a dash still fits
                // the field, and cap at the real length so nobody keeps typing
                // into a full input wondering why nothing appears.
                setCode(
                  changeEvent.target.value
                    .replace(/[^a-zA-Z0-9]/g, '')
                    .toUpperCase()
                    .slice(0, CODE_LENGTH),
                )
              }
              placeholder="········"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-describedby="code-error"
            />
            <div className="hint">
              Not case sensitive. Spaces and dashes can be pasted in as they are.
            </div>
          </div>

          <div className="error" id="code-error" role="alert">
            {error}
          </div>

          <button
            className="btn btn--block"
            type="submit"
            disabled={busy || code.length !== CODE_LENGTH}
            data-busy={busy}
          >
            {busy ? 'Checking' : 'Start scoring'}
          </button>
        </form>
      ) : null}

      {phase === 'ballot' && ballot ? (
        <div className="stack">
          <div className="eyebrow" data-anim="ballot-head">
            <span className="label">{ballot.event.name}</span>
            <CountdownRing
              initialSeconds={ballot.secondsRemaining}
              totalSeconds={Math.max(ballot.secondsRemaining, 1)}
              onExpire={() => setPhase('unavailable')}
            />
          </div>

          <h1 data-anim="ballot-head">Score every demo</h1>
          <p data-anim="ballot-head">
            {ballot.minScore} is the lowest, {ballot.maxScore} the highest. Change your mind as
            often as you like — scores save as you set them and stay editable until voting closes.
          </p>

          {/* The one line that stops autosave from misleading anybody. Every
              card says "Saved" the moment it is scored, which on its own reads
              as "you are done"; a ballot missing even one demo is not counted at
              all, so the fraction and what it means have to be on screen the
              whole time, not just at the end. */}
          <div
            className="ballotstatus"
            data-complete={complete}
            role="status"
            aria-live="polite"
          >
            {complete ? (
              <>
                <strong>All {demoCount} scored.</strong> Your ballot counts. You can still adjust
                any score until voting closes.
              </>
            ) : (
              <>
                <strong>
                  {savedCount} of {demoCount} scored.
                </strong>{' '}
                A ballot counts only once every demo has a score.
              </>
            )}
          </div>

          <ul className="ballot">
            {ballot.demos.map((demo) => (
              <DemoCard
                key={demo.id}
                demo={demo}
                score={scores[demo.id] ?? null}
                min={ballot.minScore}
                max={ballot.maxScore}
                saving={saving[demo.id] === true}
                onScore={setScore}
              />
            ))}
          </ul>

          <div className="error" role="alert">
            {error}
          </div>
        </div>
      ) : null}

      {phase === 'results' && results ? (
        <div className="stack">
          <div className="eyebrow" data-anim="results-head">
            <span className="label">Demo Vote</span>
            <span className="label">{results.event.name}</span>
          </div>
          <h1 data-anim="results-head">Results</h1>
          <p data-anim="results-head">
            {results.ballots} {results.ballots === 1 ? 'ballot' : 'ballots'} counted.
          </p>
          <ResultsBars tally={results.tally} maxScore={results.maxScore} revealed />
        </div>
      ) : null}
    </div>
  )
}
