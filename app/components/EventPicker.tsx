import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

type PickerOption = { id: string; label: string }

/** The app bar's inline padding: the closest the popup may come to the edge. */
const EDGE_GUTTER = 16

/**
 * The event picker: a listbox rather than a native `<select>`.
 *
 * A closed `<select>` can be styled to match the page, but its open list is
 * drawn by the operating system and cannot be reached from CSS at all, so it
 * arrives as a macOS menu on one machine and a Windows one on the next. This is
 * the only control in the app that opens something, and it has to look like the
 * rest of the app rather than like the laptop it happens to be running on.
 *
 * Follows the ARIA select-only combobox pattern: focus stays on the button and
 * `aria-activedescendant` points at the highlighted row, so nothing inside the
 * popup is ever focused and dismissing it cannot lose the focus ring. The popup
 * exists in the DOM only while open, which is also why its entrance is a CSS
 * animation: a GSAP `from` tween that dies mid-flight leaves its inline styles
 * frozen, and on this element that would mean a list that is permanently
 * invisible. See app/motion.ts for the longer version of that hazard.
 */
export function EventPicker({
  label,
  options,
  value,
  onChange,
  compact = false,
}: {
  label: string
  options: PickerOption[]
  value: string
  onChange: (id: string) => void
  /**
   * Drops the visible label and the full-width box, for the copy that lives in
   * the dashboard's top bar next to the sign-out button. The label becomes the
   * button's accessible name instead of a line of text above it, so the control
   * is named exactly as loudly as before and takes a fraction of the room.
   */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const baseId = useId()
  const labelId = `${baseId}-label`
  const buttonId = `${baseId}-button`
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const selected = options.find((option) => option.id === value)
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  )

  /** Opening lands on the current choice, not on the top of the list. */
  function openList() {
    setActive(currentIndex)
    setOpen(true)
  }

  function choose(index: number) {
    const option = options[index]
    if (option) onChange(option.id)
    setOpen(false)
  }

  // A press anywhere outside is a dismissal. pointerdown rather than click, so
  // the list is gone before whatever is underneath reacts to being hit.
  useEffect(() => {
    if (!open) return

    function onPointerDown(pressed: PointerEvent) {
      if (!wrapRef.current?.contains(pressed.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // The compact popup is as wide as its longest label rather than as wide as the
  // button, which is the one shrinkable item in the app bar and shows its own
  // label ellipsised — sizing the open list to that measurement was what wrapped
  // every row onto two lines. Growing to fit needs a limit, though, and the
  // limit is the room between the popup's right edge and the left edge of the
  // window: the popup hangs off a control near the right of the bar, so it grows
  // leftwards, and CSS has no length for that gap. Measured here, capped in CSS.
  // Layout effect rather than effect: this runs before the browser paints, so
  // the list is never seen at the wrong width.
  useLayoutEffect(() => {
    if (!open || !compact) return

    const list = listRef.current
    const wrap = wrapRef.current
    if (!list || !wrap) return

    function fit() {
      if (!list || !wrap) return
      const room = Math.round(wrap.getBoundingClientRect().right) - EDGE_GUTTER
      list.style.setProperty('--picker-room', `${Math.max(0, room)}px`)
    }

    fit()
    // Rotating a phone moves the anchor without remounting the list.
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open, compact])

  // Arrowing past the fold has to bring the row with it.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function onKeyDown(pressed: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(pressed.key)) {
        pressed.preventDefault()
        openList()
      }
      return
    }

    switch (pressed.key) {
      case 'ArrowDown':
        pressed.preventDefault()
        setActive((index) => Math.min(options.length - 1, index + 1))
        break
      case 'ArrowUp':
        pressed.preventDefault()
        setActive((index) => Math.max(0, index - 1))
        break
      case 'Home':
        pressed.preventDefault()
        setActive(0)
        break
      case 'End':
        pressed.preventDefault()
        setActive(options.length - 1)
        break
      // A button fires click on both of these, so the default has to go or the
      // choice would be made twice.
      case 'Enter':
      case ' ':
        pressed.preventDefault()
        choose(active)
        break
      case 'Escape':
        pressed.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <div className={compact ? 'picker-wrap' : 'field'} ref={wrapRef}>
      {/* A button is a labelable element, so this is a real label rather than
          text that merely sits above the control. Hidden rather than dropped in
          the compact copy: the name is still needed, just not on screen. */}
      <label id={labelId} htmlFor={buttonId} className={compact ? 'visually-hidden' : undefined}>
        {label}
      </label>

      <div className="picker">
        <button
          type="button"
          id={buttonId}
          className={compact ? 'picker__button picker__button--compact' : 'input picker__button'}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          // Names the control "Event" and then reads the current choice, rather
          // than letting the button's own text become the whole name.
          aria-labelledby={`${labelId} ${buttonId}`}
          aria-activedescendant={open ? optionId(active) : undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
        >
          {selected?.label ?? ''}
        </button>

        {open ? (
          <ul className="picker__list" id={listId} role="listbox" aria-labelledby={labelId} ref={listRef}>
            {options.map((option, index) => (
              <li
                key={option.id}
                id={optionId(index)}
                role="option"
                className="picker__option"
                aria-selected={option.id === value}
                data-active={index === active}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="picker__tick" aria-hidden="true" />
                <span>{option.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
