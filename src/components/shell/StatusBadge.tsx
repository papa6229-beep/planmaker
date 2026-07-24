/**
 * Small status/count chip (WORK_PLAN Phase 7 §6, §7, §11). Always pairs a text
 * label with the visual — never color alone. `value` is optional; when a count
 * is shown it reflects real state only (0 when there is no data).
 */

export type BadgeTone = 'neutral' | 'info' | 'violet' | 'success' | 'warning'

export function StatusBadge({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value?: number | string
  tone?: BadgeTone
}) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" aria-hidden="true" />
      <span className="badge__label">{label}</span>
      {value !== undefined && <span className="badge__value">{value}</span>}
    </span>
  )
}
