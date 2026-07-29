import { useEffect, useRef, useState } from 'react'
import { gsap, motionOk } from '../motion'

const RADIUS = 19
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const WARN_AT = 300 // five minutes
const URGENT_AT = 60

function tone(seconds: number): 'calm' | 'warn' | 'urgent' {
  if (seconds <= URGENT_AT) return 'urgent'
  if (seconds <= WARN_AT) return 'warn'
  return 'calm'
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/**
 * Counts down locally between server readings.
 *
 * `initialSeconds` is authoritative and resets the local clock whenever the
 * server sends a new value, so a phone with a skewed clock or a backgrounded
 * tab re-syncs instead of drifting away from the real deadline. The server
 * rejects late votes regardless, but the number on screen should not lie.
 */
export function CountdownRing({
  initialSeconds,
  totalSeconds,
  onExpire,
}: {
  initialSeconds: number
  totalSeconds: number
  onExpire?: () => void
}) {
  const [seconds, setSeconds] = useState(initialSeconds)
  const progressRef = useRef<SVGCircleElement>(null)
  const expiredRef = useRef(false)

  useEffect(() => {
    setSeconds(initialSeconds)
    expiredRef.current = false
  }, [initialSeconds])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (seconds === 0 && !expiredRef.current) {
      expiredRef.current = true
      onExpire?.()
    }
  }, [seconds, onExpire])

  useEffect(() => {
    const circle = progressRef.current
    if (!circle) return
    const fraction = totalSeconds > 0 ? Math.min(1, Math.max(0, seconds / totalSeconds)) : 0
    const offset = CIRCUMFERENCE * (1 - fraction)
    // Tweened across the full second so the ring sweeps continuously instead of
    // stepping once per tick.
    if (motionOk()) {
      gsap.to(circle, { strokeDashoffset: offset, duration: 1, ease: 'none', overwrite: true })
    } else {
      gsap.set(circle, { strokeDashoffset: offset })
    }
  }, [seconds, totalSeconds])

  return (
    <div className="countdown" data-tone={tone(seconds)}>
      <svg className="countdown__ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle
          className="countdown__track"
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
        />
        <circle
          ref={progressRef}
          className="countdown__progress"
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={0}
        />
      </svg>
      <div>
        <div className="label">Time left</div>
        {/* Polite, not assertive: a screen reader should not interrupt the
            ballot every second. */}
        <div className="countdown__value" role="timer" aria-live="off">
          {clock(seconds)}
        </div>
      </div>
    </div>
  )
}
