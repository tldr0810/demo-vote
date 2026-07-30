import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Ballot, type PublicEvent, type ScoreSaved, type TallyRow } from '../api'
import { CountdownRing } from '../components/CountdownRing'
import { DemoCard } from '../components/DemoCard'
import { ResultsBars } from '../components/ResultsBars'
import { messageFor } from '../messages'
import { gsap, motionOk, useGSAP } from '../motion'
import { codeFromSearch, stripCodeFromUrl } from '../voteUrl'
import { pollIntervalFor, watchAction, type WatchedPhase } from '../voteWatch'

// The three screens in the middle are the ones the watcher has rules for, and
// they are named there rather than here so the rules and the screens cannot
// drift apart.
type Phase = 'loading' | WatchedPhase | 'results'

type Results = {
  event: { name: string }
  tally: TallyRow[]
  ballots: number
  maxScore: number
}

const CODE_LENGTH = 8

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

  /**
   * Everything between "voting is live" and a screen the voter can act on.
   *
   * Called twice over the life of a page, from two quite different places: once
   * on load, and again if voting opens while somebody is sitting here waiting
   * for it. Both need the same three steps in the same order — an existing
   * session, then a scanned code, then the entry screen as the fallback — and
   * the second caller is the reason this is a function rather than being written
   * out inside boot. A phone that scanned its slip before the doors opened is
   * holding a code that appears nowhere else: the slip carries it in the QR
   * only, so landing that person on the entry screen with nothing to type is a
   * dead end, and redeeming what is already in the address bar is the whole
   * difference between the two.
   *
   * `cancelled` is passed in rather than captured because the callers own
   * different lifetimes: boot is cancelled when the event id changes, the
   * watcher when its interval is torn down.
   */
  const enterVoting = useCallback(
    async (forEventId: string, cancelled: () => boolean) => {
      // Cleared up front. This runs a second time when voting opens under a
      // phone that has been waiting, and whatever that phone was told while it
      // was waiting has just stopped being true.
      setError(null)

      const existing = await loadBallot(forEventId)
      if (cancelled()) return
      if (existing.ok) {
        stripCodeFromUrl()
        return
      }

      // Scanned a personal QR code: redeem it and go straight to the ballot,
      // with no typing at all. The manual entry screen stays as the fallback,
      // because a scanner that mangles the query string, a slip that failed to
      // print, and a code read aloud by a steward all end up there.
      const scanned = codeFromSearch(window.location.search)
      if (scanned) {
        const redeemed = await api.post('/api/session', { eventId: forEventId, code: scanned })
        if (cancelled()) return

        // Cleared whether or not it worked. A code that failed will fail again
        // on every reload, and leaving it in the address bar turns one bad slip
        // into a page that cannot be recovered by refreshing.
        stripCodeFromUrl()

        if (redeemed.ok) {
          const scannedBallot = await loadBallot(forEventId)
          if (cancelled()) return
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
    },
    [loadBallot],
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

      // An existing session wins over a scanned code, and is checked first on
      // purpose — which is the first thing enterVoting does. Someone re-scanning
      // their own slip mid-ballot should land back on the ballot rather than
      // spend a request redeeming a code the cookie already speaks for. A
      // session for a *different* event answers 401 there, so the scanned code
      // still gets its turn — which is what makes a second event's QR work for
      // somebody still holding the first one's.
      //
      // Checked before the closed screen, and deliberately: a session survives
      // the window it was issued under, so somebody who scored and then reloaded
      // after voting closed should see their own receipt rather than a bare
      // "voting has closed".
      const ballotResult = await api.get<Ballot>(
        `/api/ballot?eventId=${encodeURIComponent(eventResult.data.id)}`,
      )
      if (cancelled) return

      if (ballotResult.ok) {
        stripCodeFromUrl()
        applyBallot(ballotResult.data)
        return
      }

      // Nothing to do here yet — including on a draft, where the watcher below
      // now waits for the organiser to open voting and runs enterVoting itself.
      // The scanned code stays in the address bar until then, which is what lets
      // somebody who scanned early go straight to their ballot.
      if (!eventResult.data.votingLive) {
        setPhase('unavailable')
        return
      }

      await enterVoting(eventResult.data.id, () => cancelled)
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [eventId, applyBallot, enterVoting])

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
  // A draft used to be excluded on the grounds that it cannot be revealed
  // without being opened first. That is true and it was the wrong conclusion:
  // being opened is itself the transition a phone on a draft is waiting for, and
  // excluding it meant everybody who opened the page before the doors — which is
  // everybody handed a slip at check-in — sat on "not open yet" until they
  // thought to refresh. A draft is watched, more slowly. See voteWatch.ts.
  const watching =
    results === null &&
    event !== null &&
    (phase === 'entry' || phase === 'ballot' || phase === 'unavailable')

  const pollMs = pollIntervalFor(event?.status ?? 'draft')

  // Held across renders because entering takes two requests and the phase it
  // sets only lands on the next one. Without it a `visibilitychange` arriving
  // alongside the interval would start a second redemption of the same code
  // while the first is still in flight.
  const entering = useRef(false)

  /**
   * Watches the event this phone is on, and follows it from end to end.
   *
   * Three things can arrive here. The standings, which replace whatever is on
   * screen, so a phone turns into the results by itself rather than telling its
   * owner to go and look elsewhere. The news that voting has opened, which moves
   * a phone that has been waiting since check-in onto a screen it can act on.
   * And the news that voting is no longer live, which matters more now than it
   * did under one-vote-each: a ballot stays editable for the whole window, so a
   * phone left open on it is the normal case, and it has to stop offering
   * changes the server will refuse.
   *
   * Stops on the first set of results and never starts again: ResultsBars
   * animates its rows in, and a re-render landing mid-animation leaves them
   * stranded part-way. Screen.tsx guards the projector against exactly this.
   */
  useEffect(() => {
    if (!watching || !currentEventId) return
    const watchedId = currentEventId
    let cancelled = false

    async function poll() {
      // A locked phone polling costs the venue wifi and tells nobody anything.
      if (document.visibilityState === 'hidden') return

      // The watcher does not run on the loading or results screens, so this only
      // catches a phase that changed between the last render and this tick —
      // a reveal landing while a `visibilitychange` poll is on its way out.
      const watchedPhase = phaseRef.current
      if (watchedPhase === 'loading' || watchedPhase === 'results') return

      const current = await api.get<PublicEvent>(`/api/event/${watchedId}`)
      if (cancelled || !current.ok) return

      // Only on a real change. Replacing the object every eight seconds would
      // re-render this whole screen for the length of the event to say nothing.
      // It has to happen before the branches below: the status is what chooses
      // the interval, so a draft that opened has to be recorded here for the
      // poll to speed up to the live rate.
      setEvent((previous) =>
        previous &&
        previous.status === current.data.status &&
        previous.votingLive === current.data.votingLive
          ? previous
          : current.data,
      )

      switch (watchAction(current.data, watchedPhase)) {
        case 'results': {
          const revealed = await api.get<Results>(`/api/results/${watchedId}`)
          // A 403 here would mean the reveal was undone, which the state machine
          // does not allow. Anything else is a network blip: keep waiting.
          if (cancelled || !revealed.ok) return
          setResults(revealed.data)
          setPhase('results')
          return
        }

        // Opened while this phone was already waiting on it. Where it goes next
        // is not a given, which is why this costs a request rather than being
        // decided in voteWatch.ts: somebody who scanned their personal slip
        // before the doors opened belongs on the ballot, and the entry screen
        // would ask them for a code that is printed nowhere they can read it.
        case 'enter': {
          if (entering.current) return
          entering.current = true
          try {
            await enterVoting(watchedId, () => cancelled)
          } finally {
            entering.current = false
          }
          return
        }

        case 'close': {
          setPhase('unavailable')
          setError(null)
          return
        }

        case 'wait':
          return
      }
    }

    void poll()
    const timer = window.setInterval(poll, pollMs)
    // A phone picked up after the organiser has said something should not have
    // to sit through the rest of an interval before it catches up. This is what
    // keeps the slow draft interval from being felt: the announcement is what
    // makes people look at their phones.
    document.addEventListener('visibilitychange', poll)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [watching, currentEventId, pollMs, enterVoting])

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
                    ? 'Voting has not opened yet. Leave this page open — it takes you to your ballot by itself the moment the organisers open voting.'
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
