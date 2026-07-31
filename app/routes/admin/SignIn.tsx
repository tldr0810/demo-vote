import { useEffect, useRef } from 'react'
import { shake } from '../../motion'

export function SignIn({
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
  const fieldRef = useRef<HTMLDivElement>(null)

  // The ballot's entry screen has always done this and this one did nothing at
  // all, so the same kind of failure — a credential that was not accepted —
  // felt like two different applications depending on which end of the event
  // you were standing at.
  useEffect(() => {
    if (error) shake(fieldRef.current)
  }, [error])

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

        <div className="field" ref={fieldRef}>
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
