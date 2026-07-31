/**
 * 작성팀 — which team wrote the brief (v1 마감 §11).
 *
 * Stored in the `Project.requestTeam` field the schema has always had, so no
 * second field means the same thing. The value is a code rather than a label,
 * which is what makes filtering and later machine use possible; documents
 * written before this carry whatever free text they were given, and that text
 * is shown as-is rather than being rewritten or thrown away.
 *
 * Choosing a team is optional. `undefined` — 팀 미지정 — is an ordinary state,
 * never something that blocks saving, loading, or delivering.
 */

export type RequestTeam = 'marketing' | 'product' | 'cs'

export const REQUEST_TEAMS: { value: RequestTeam; label: string }[] = [
  { value: 'marketing', label: '마케팅팀' },
  { value: 'product', label: '상품팀' },
  { value: 'cs', label: 'CS팀' },
]

/** Shown wherever no team was chosen. */
export const NO_TEAM_LABEL = '팀 미지정'

const LABELS: Record<RequestTeam, string> = {
  marketing: '마케팅팀',
  product: '상품팀',
  cs: 'CS팀',
}

/** True for one of the three codes this version writes. */
export function isRequestTeam(value: unknown): value is RequestTeam {
  return value === 'marketing' || value === 'product' || value === 'cs'
}

/**
 * What to show for a stored value: the team's name, the free text an older
 * document already carried, or 팀 미지정 when there is nothing.
 */
export function teamLabel(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return NO_TEAM_LABEL
  return isRequestTeam(value) ? LABELS[value] : value
}

/** The filter key a stored value belongs under: a code, or `none`. */
export function teamFilterKey(value: string | undefined): RequestTeam | 'none' {
  return isRequestTeam(value) ? value : 'none'
}
