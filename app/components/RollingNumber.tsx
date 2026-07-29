import { useRef } from 'react'
import { gsap, motionOk, useGSAP } from '../motion'

/**
 * A number that counts to its new value instead of jumping to it.
 *
 * This is a scoreboard, and on a scoreboard a count that goes from 7 to 12 rolls
 * through the numbers in between. The elements this replaces all carry
 * `font-variant-numeric: tabular-nums` already, so every intermediate value
 * occupies exactly the same width and nothing reflows while it runs.
 *
 * The tween writes textContent directly rather than driving React state: at one
 * frame per repaint, a setState per frame would re-render the whole standings
 * sixty times a second. React still owns the final value, which it renders as
 * the child below, so the two never disagree once the tween lands.
 */
export function RollingNumber({
  value,
  className,
  suffix = '',
}: {
  value: number
  className?: string
  suffix?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  // What the element is currently showing. Not derived from props: mid-tween the
  // displayed number is neither the old prop nor the new one, and a second
  // change arriving during the roll has to continue from what is on screen.
  const shown = useRef(0)

  useGSAP(
    () => {
      const element = ref.current
      if (!element) return

      const write = (n: number) => {
        element.textContent = `${n}${suffix}`
      }

      if (!motionOk()) {
        shown.current = value
        write(value)
        return
      }

      const counter = { n: shown.current }
      gsap.to(counter, {
        n: value,
        duration: 0.6,
        ease: 'power2.out',
        // A poll landing mid-roll retargets rather than stacking a second tween
        // on the same object.
        overwrite: true,
        onUpdate: () => {
          shown.current = Math.round(counter.n)
          write(shown.current)
        },
        onComplete: () => {
          shown.current = value
          write(value)
        },
      })
    },
    { dependencies: [value, suffix] },
  )

  return (
    <span ref={ref} className={className}>
      {value}
      {suffix}
    </span>
  )
}
