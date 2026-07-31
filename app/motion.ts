import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'

// Registered once, at module load, before any component runs a timeline.
gsap.registerPlugin(useGSAP, Flip)

export { Flip, gsap, useGSAP }

/**
 * Whether motion is allowed right now.
 *
 * Deliberately a plain boolean check rather than `gsap.matchMedia`. A matchMedia
 * owns its own gsap context, so tweens created inside one are not the tweens
 * useGSAP reverts on cleanup. Under StrictMode's mount/unmount/mount that split
 * leaves `from` tweens killed halfway and their inline styles frozen, which
 * renders as a half-faded page that never finishes appearing.
 *
 * Keeping every tween directly inside the useGSAP callback means one context
 * owns all of them and cleanup actually reverts them.
 */
export function motionOk(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The shudder a rejected credential gets.
 *
 * Both places somebody types something that can be wrong — a voting code on a
 * phone, an admin password on a laptop — and it lives here because they were
 * not the same: the ballot's entry screen shook and the organiser's sign-in did
 * nothing at all, so the same kind of failure felt like two different kinds of
 * app. A wrong password should be felt before the sentence under it is read.
 *
 * Does nothing under reduced motion, where the error text is the whole message.
 * `clearProps` so the inline transform GSAP writes is gone once it lands.
 */
export function shake(element: Element | null): void {
  if (!element || !motionOk()) return
  gsap.fromTo(
    element,
    { x: -9 },
    { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.32)', clearProps: 'x' },
  )
}

// Dev only. GSAP drives its timelines from requestAnimationFrame, which
// browsers throttle to a standstill in a tab that reports itself hidden (an
// embedded preview pane, a headless screenshot run, a background window).
// Tweens then freeze part-way and the page looks broken when it is not.
// `gsap.globalTimeline.progress(1)` jumps everything to its settled state so
// the layout can be inspected. Stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as { gsap: typeof gsap }).gsap = gsap
}
