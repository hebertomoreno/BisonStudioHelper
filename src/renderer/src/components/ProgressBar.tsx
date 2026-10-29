// A bar of square cells, filled in proportion to `value` (0 to 1), in the pixel style of the
// Focus stage (SPEC 8c).
export function ProgressBar({
  value,
  label,
  cells = 20,
  size = 'large'
}: {
  value: number
  // What the bar measures, for screen readers, e.g. "Song progress".
  label: string
  cells?: number
  size?: 'large' | 'small'
}): JSX.Element {
  const clamped = Math.max(0, Math.min(1, value))
  const filled = Math.round(clamped * cells)
  return (
    <span
      className={`pixel-bar ${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={i < filled ? 'cell on' : 'cell'} />
      ))}
    </span>
  )
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}
