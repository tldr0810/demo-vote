/**
 * A block the size of the thing that has not arrived yet.
 *
 * Every screen in this app answered its first render with the word "Loading" in
 * 11px uppercase and nothing else, which on a phone is a blank page with a
 * caption. During an event a blank page is read as a broken one, and the person
 * reading it is standing in a room being told to scan something.
 *
 * `aria-hidden`, always. The shapes are for the eye; the screen reader is told
 * what is happening by the live region on the screen that owns them, and a row
 * of empty boxes announced one by one is worse than silence.
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  radius,
}: {
  width?: string
  height?: string
  radius?: string
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ display: 'block', width, height, borderRadius: radius }}
    />
  )
}

/** The stand-in for a stack of demo cards or tally rows, which is most of them. */
export function SkeletonRows({ rows = 4, height = '4.5rem' }: { rows?: number; height?: string }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--step) * 1.5)' }}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} radius="var(--radius-surface)" />
      ))}
    </div>
  )
}
