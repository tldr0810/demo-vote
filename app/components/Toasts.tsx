import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Short confirmations for actions whose effect is invisible.
 *
 * Copying the vote link wrote to the clipboard and said nothing; generating a
 * batch of codes grew a grid further down a page the organiser may not have
 * been looking at. Both are taps that succeed in complete silence, and silence
 * after a tap is indistinguishable from a tap that missed — which is how an
 * organiser ends up generating three hundred codes when they wanted a hundred.
 *
 * Deliberately not an error channel. A failed action leaves the organiser with
 * something to do about it, so it belongs in the error line on the page where
 * it stays put and can be read twice. The one exception is a failure that
 * follows an action whose success would also have been a toast, so the tone is
 * here for those.
 */

export type ToastTone = 'ok' | 'error'

export type Toast = {
  id: number
  /** The uppercase word: what happened. "Copied", "Generated". */
  label: string
  /** The sentence: what it means. Optional — some events are their own message. */
  detail?: string
  tone: ToastTone
}

const DISMISS_MS = 4000

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Monotonic, so two identical messages are still two rows rather than one
  // React reuses and never animates the second time.
  const nextId = useRef(1)
  const timers = useRef<number[]>([])

  const push = useCallback((label: string, detail?: string, tone: ToastTone = 'ok') => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, label, detail, tone }])
    timers.current.push(
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, DISMISS_MS),
    )
  }, [])

  // Every pending dismissal is cancelled on unmount. Without this, signing out
  // while a toast is up sets state on a component that no longer exists.
  useEffect(() => {
    const pending = timers
    return () => {
      for (const timer of pending.current) window.clearTimeout(timer)
      pending.current = []
    }
  }, [])

  return { toasts, push }
}

/**
 * The stack itself.
 *
 * `aria-live="polite"` rather than `assertive`: these announce something that
 * already worked, and interrupting somebody mid-sentence to tell them a link
 * copied is worse than waiting for a gap.
 */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} data-tone={toast.tone}>
          <span className="label toast__label">{toast.label}</span>
          {toast.detail ? <span>{toast.detail}</span> : null}
        </div>
      ))}
    </div>
  )
}
