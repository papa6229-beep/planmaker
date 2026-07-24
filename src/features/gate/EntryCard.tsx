/**
 * A role entry card on the gate (WORK_PLAN Phase 7 §3C, §4). The whole card is a
 * single link (keyboard focusable, one accessible name via aria-label).
 *
 * `stats` is an optional slot for future KPI injection (신규/작업 중/완료/전체)
 * once a RequestRepository exists — the gate does NOT depend on any store now,
 * and passes no stats, so no fake numbers are shown. When stats are absent a
 * neutral `note` is displayed instead.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ArrowRightIcon } from '../../components/shell/icons'

export interface EntryCardStat {
  label: string
  value: number
}

export function EntryCard({
  to,
  accent,
  icon,
  audience,
  title,
  description,
  cta,
  stats,
  note,
}: {
  to: string
  accent: 'brief' | 'image'
  icon: ReactNode
  audience: string
  title: string
  description: string
  cta: string
  stats?: EntryCardStat[]
  note?: string
}) {
  return (
    <Link to={to} className={`entry-card entry-card--${accent}`} aria-label={`${title}: ${cta}`}>
      <span className="entry-card__icon" aria-hidden="true">{icon}</span>
      <span className="entry-card__audience">{audience}</span>
      <h2 className="entry-card__title">{title}</h2>
      <p className="entry-card__desc">{description}</p>

      {stats && stats.length > 0 ? (
        <ul className="entry-card__stats">
          {stats.map((s) => (
            <li key={s.label} className="entry-card__stat">
              <span className="entry-card__stat-value">{s.value}</span>
              <span className="entry-card__stat-label">{s.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        note && <p className="entry-card__note">{note}</p>
      )}

      <span className="entry-card__cta">
        {cta}
        <ArrowRightIcon size={18} />
      </span>
    </Link>
  )
}
