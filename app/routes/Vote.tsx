import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Ballot, type PublicEvent } from '../api'
import { CountdownRing } from '../components/CountdownRing'
import { DemoCard } from '../components/DemoCard'
import { messageFor } from '../messages'
import { gsap, motionOk, useGSAP } from '../motion'

type Phase = 'loading' | 'entry' | 'ballot' | 'done' | 'unavailable'

const CODE_LENGTH = 8

export function Vote({ eventId }: { eventId: string | null }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [event, setEvent] = useState<PublicEvent | null>(null)
  const [ballot, setBallot] = useState<Ballot | null>(null)
  const [code, setCode] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [votedFor, setVotedFor] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const entryCardRef = useRef<HTMLDivElement>(null)

  // Always asked for by event. A cookie left over from another event is refused
  // rather than answered, which is what stops a voter holding a live session
  // elsewhere from being dropped into that event instead of this one.
  const loadBallot = useCallback(async (forEventId: string) => {
    const result = await api.get<Ballot>(`/api/ballot?eventId=${encodeURIComponent(forEventId)}`)
    if (!result.ok) return result
    setBallot(result.data)
    setPhase(result.data.hasVoted ? 'done' : 'ballot')
    return result
  }, [])

  // Resolve which event this is, then find out whether this browser already
  // holds a session. Someone who refreshes mid-ballot should land back on the
  // ballot, and someone who already voted should land on their receipt.
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

      const ballotResult = await api.get<Ballot>(
        `/api/ballot?eventId=${encodeURIComponent(eventResult.data.id)}`,
      )
      if (cancelled) return

      if (ballotResult.ok) {
        setBallot(ballotResult.data)
        setPhase(ballotResult.data.hasVoted ? 'done' : 'ballot')
        return
      }
      setPhase(eventResult.data.votingLive ? 'entry' : 'unavailable')
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [eventId])

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

  async function submitVote() {
    if (busy || !selected || !ballot) return
    setBusy(true)
    setError(null)

    const chosen = ballot.demos.find((demo) => demo.id === selected)
    const result = await api.post<{ demoName: string }>('/api/vote', { demoId: selected })
    setBusy(false)

    if (!result.ok) {
      setError(messageFor(result.error))
      // ALREADY_VOTED means another tab got there first: show the receipt
      // rather than leaving a dead ballot on screen.
      if (result.error === 'ALREADY_VOTED') setPhase('done')
      return
    }

    setVotedFor(chosen?.name ?? result.data.demoName)
    setPhase('done')
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
      if (phase === 'done') {
        gsap
          .timeline()
          .from('.receipt', {
            y: 16,
            opacity: 0,
            duration: 0.45,
            ease: 'power2.out',
            clearProps: 'all',
          })
          .from(
            '.receipt__mark',
            { scale: 0.7, opacity: 0, duration: 0.5, ease: 'back.out(2.2)', clearProps: 'all' },
            '-=0.2',
          )
      }
    },
    { dependencies: [phase], scope: rootRef },
  )

  // The confirm bar only exists once something is selected, so it animates in
  // on its own dependency rather than on phase.
  useGSAP(
    () => {
      if (!selected || !motionOk()) return
      gsap.from('.confirmbar', { y: '100%', duration: 0.38, ease: 'power3.out', clearProps: 'all' })
    },
    { dependencies: [selected !== null], scope: rootRef },
  )

  return (
    <div className="shell" ref={rootRef}>
      {phase === 'loading' ? <p className="label">Loading</p> : null}

      {phase === 'unavailable' ? (
        <div className="stack">
          <div className="eyebrow">
            <span className="label">Demo Vote</span>
          </div>
          <h1>{event?.name ?? 'Vote'}</h1>
          <p>
            {error ??
              (event?.status === 'draft'
                ? 'Voting has not opened yet. Wait for the organisers to announce it, then refresh this page.'
                : 'Voting has closed. Thanks for taking part.')}
          </p>
        </div>
      ) : null}

      {phase === 'entry' && event ? (
        <form className="stack" onSubmit={submitCode}>
          <div className="eyebrow" data-anim="entry">
            <span className="label">Demo Vote</span>
            <span className="label">{event.name}</span>
          </div>

          <h1 data-anim="entry">Enter your voting code</h1>
          <p data-anim="entry">
            Your code is on the slip you were given at check-in. {CODE_LENGTH} characters, good
            for one vote.
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
          >
            {busy ? 'Checking' : 'Start voting'}
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
              onExpire={() => {
                setPhase('unavailable')
                setError(messageFor('VOTING_CLOSED'))
              }}
            />
          </div>

          <h1 data-anim="ballot-head">Pick the best demo</h1>
          <p data-anim="ballot-head">One vote each. It cannot be changed once submitted.</p>

          <ul className="ballot" data-has-selection={selected !== null}>
            {ballot.demos.map((demo) => (
              <DemoCard
                key={demo.id}
                demo={demo}
                selected={selected === demo.id}
                onSelect={setSelected}
              />
            ))}
          </ul>

          <div className="error" role="alert">
            {error}
          </div>

          {selected ? (
            <div className="confirmbar">
              <div className="confirmbar__inner">
                <div className="confirmbar__warning">
                  You have chosen{' '}
                  <strong style={{ color: 'var(--text)' }}>
                    {ballot.demos.find((demo) => demo.id === selected)?.name}
                  </strong>
                  . This cannot be undone.
                </div>
                <div className="row">
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => setSelected(null)}
                    disabled={busy}
                  >
                    Go back
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={submitVote}
                    disabled={busy}
                    style={{ flex: 1 }}
                  >
                    {busy ? 'Submitting' : 'Cast my vote'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'done' ? (
        <div className="stack">
          <div className="eyebrow">
            <span className="label">Demo Vote</span>
            <span className="label">{ballot?.event.name ?? event?.name}</span>
          </div>
          <div className="receipt">
            <div className="receipt__mark" aria-hidden="true">
              ✓
            </div>
            <h2>Your vote is in</h2>
            {votedFor ? <p style={{ margin: '0 auto' }}>You voted for {votedFor}</p> : null}
            <p style={{ margin: '0 auto' }}>
              The results go up on the big screen once voting closes. You can close this page.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
