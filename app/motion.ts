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

// Dev only. GSAP drives its timelines from requestAnimationFrame, which
// browsers throttle to a standstill in a tab that reports itself hidden (an
// embedded preview pane, a headless screenshot run, a background window).
// Tweens then freeze part-way and the page looks broken when it is not.
// `gsap.globalTimeline.progress(1)` jumps everything to its settled state so
// the layout can be inspected. Stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as { gsap: typeof gsap }).gsap = gsap
}
