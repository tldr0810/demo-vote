import { useEffect, useRef } from 'react'

/**
 * The confirmation for a decision that cannot be undone.
 *
 * Replaces `window.confirm`, for the reason this codebase already gave twice:
 * anything the operating system draws arrives looking like macOS on one laptop
 * and Windows on the next, which is why the event picker is a listbox and the
 * archive toggle is a button rather than a checkbox. The dashboard is run from
 * whichever machine the venue has, so the two most consequential taps in the
 * app were the ones least in our control.
 *
 * The second reason is that `confirm` can only say one line. Opening voting
 * starts a clock for a whole room; closing early takes time away from everybody
 * still scoring. Both have a cost that can be counted, and `facts` is where it
 * gets counted rather than described.
 *
 * A native <dialog> opened with showModal(), not a hand-rolled overlay: the
 * focus trap, Escape, and making the page behind it inert are all things the
 * platform already does correctly and a div does not. Everything visible is
 * still ours, backdrop included.
 */
export function ConfirmDialog({
  open,
  eyebrow,
  title,
  body,
  facts = [],
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: {
  open: boolean
  /** The small line above the heading — usually what makes this irreversible. */
  eyebrow?: string
  title: string
  body: string
  /** The numbers the decision turns on. */
  facts?: { value: string; label: string }[]
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Focus lands here rather than on the confirm button. Whatever is focused
  // when a dialog opens is what a hurried Enter presses, and on this dialog that
  // must never be the irreversible half.
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
      cancelRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Escape and the backdrop both close a modal <dialog> without going through
  // our buttons, so the parent has to hear about it or its `open` state is left
  // saying the dialog is up after it has gone.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const handleCancel = (cancelled: Event) => {
      cancelled.preventDefault()
      onCancel()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onCancel])

  return (
    <dialog className="dialog" ref={ref} aria-labelledby="confirm-title">
      <div>
        {eyebrow ? (
          <span className="label" style={{ color: tone === 'danger' ? 'var(--danger)' : undefined }}>
            {eyebrow}
          </span>
        ) : null}
        <h2 id="confirm-title">{title}</h2>
      </div>

      <p>{body}</p>

      {facts.length > 0 ? (
        <div className="dialog__facts">
          {facts.map((fact) => (
            <div className="dialog__fact" key={fact.label}>
              <strong>{fact.value}</strong>
              <span className="label">{fact.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="dialog__actions">
        <button className="btn btn--ghost" type="button" ref={cancelRef} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          className={tone === 'danger' ? 'btn btn--danger' : 'btn'}
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
