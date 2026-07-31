/**
 * When a brief was written, in the user's own calendar (손검수 2 §6).
 *
 * One rule, used by the list and by the month filter alike, so a brief written
 * at 9pm on the 31st is never filed under the 1st because UTC had already
 * rolled over. Everything here works from the local date of the *creation*
 * time: the last edit is shown on the card, but it never moves a brief into
 * another month.
 */

/** Local calendar day of a timestamp, as `YYYY-MM-DD`. */
export function localDayKey(at: number): string {
  const d = new Date(at)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Local calendar month of a timestamp, as `YYYY-MM`. */
export function localMonthKey(at: number): string {
  return localDayKey(at).slice(0, 7)
}

/** `2026-07` → `2026년 7월`. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${year}년 ${Number(month)}월`
}

/** `2026-07-31` → `7월 31일`. */
export function dayLabel(key: string): string {
  const [, month, day] = key.split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

export interface DatedBrief {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface DayGroup<T extends DatedBrief> {
  /** `YYYY-MM-DD` of the day these briefs were created on. */
  key: string
  label: string
  briefs: T[]
}

/** Months that have briefs in them, newest first. */
export function createdMonths<T extends DatedBrief>(briefs: readonly T[]): string[] {
  return [...new Set(briefs.map((b) => localMonthKey(b.createdAt)))].toSorted((a, b) => b.localeCompare(a))
}

/**
 * Groups briefs by the day they were written, newest day first, and within a
 * day the most recently edited first.
 */
export function groupByCreatedDay<T extends DatedBrief>(briefs: readonly T[]): DayGroup<T>[] {
  const days = new Map<string, T[]>()
  for (const brief of briefs) {
    const key = localDayKey(brief.createdAt)
    const bucket = days.get(key)
    if (bucket) bucket.push(brief)
    else days.set(key, [brief])
  }
  return [...days.entries()]
    .toSorted(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({
      key,
      label: dayLabel(key),
      briefs: list.toSorted((a, b) => b.updatedAt - a.updatedAt),
    }))
}
