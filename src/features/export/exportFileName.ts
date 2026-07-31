/**
 * The name a saved brief file gets (v1 마감 §4).
 *
 * The planner types what they want to find later — "아크웨이브 신상 발매 기념
 * 이벤트" — and that is exactly what lands in their downloads folder. Only what
 * a file system genuinely cannot take is changed, and the brief's own title is
 * never touched by any of it.
 */

export const EVENTBRIEF_EXTENSION = '.eventbrief'

/** Used when the name is left empty — a file still needs to be called something. */
export const FALLBACK_FILE_NAME = '새 기획서'

/**
 * Characters Windows refuses in a file name. Replaced with a space rather than
 * dropped, so "50%↓/오늘만" does not become one run-on word.
 */
const FORBIDDEN = /[<>:"/\\|?*]/g

/**
 * Cleans a typed name into one a file system will accept, keeping Korean (and
 * every other ordinary character) exactly as typed.
 *
 * Trailing dots and spaces go: Windows silently strips them, which would make
 * "여름 이벤트 ." and "여름 이벤트" the same file under a name nobody chose.
 */
export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned.length > 0 ? cleaned : FALLBACK_FILE_NAME
}

/**
 * The full download name for a typed base name. Typing the extension yourself
 * is fine — it is not added twice.
 */
export function eventBriefFileName(input: string): string {
  const withoutExt = input.replace(new RegExp(`${EVENTBRIEF_EXTENSION}$`, 'i'), '')
  return `${sanitizeFileName(withoutExt)}${EVENTBRIEF_EXTENSION}`
}
