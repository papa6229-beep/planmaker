/**
 * 쓸 수 있는 글꼴의 목록 (문구 판 Patch).
 *
 * ## 왜 글꼴이 중요해졌나
 *
 * 로컬 엔진은 한글을 쓰지 못한다. 그래서 글자는 브라우저가 그리고, 모델은 재질만
 * 입힌다 (`domain/textPlate.ts`). 그 구조에서 **디자인의 폭은 글꼴이 정한다** —
 * 모델은 글자꼴을 바꾸지 못하고, 바꾸게 두면 한글이 틀리기 때문이다.
 *
 * ## 왜 목록을 파일로 두는가
 *
 * 글꼴 파일은 한글 한 벌이 수백 KB다. 전부 받아 두면 화면이 열리지 않는다. 그래서
 * 목록(이름·굵기·파일 이름)만 먼저 읽고, **고른 글꼴 하나만** 그때 내려받는다.
 * 목록은 빌드에 포함되는 `fonts/fonts.json`이고, 파일은 그 옆에 있다.
 *
 * 순수 모듈이다. 네트워크도 캔버스도 모른다 — 받아 오는 일은 `services/fontLoader.ts`.
 */

/** 화면에서 갈래를 묶는 이름. 목록 파일이 정하는 값을 그대로 쓴다. */
export type FontGroup = string

/**
 * 한글 글꼴인가, 외국어 글꼴인가 (글꼴 전체 Patch, 2026-09-17).
 *
 * 한글 음절을 2000자 넘게 가진 글꼴만 `ko`다. 영문 글꼴로 한글 문구를 고르면
 * 모자란 글자가 다른 글꼴로 섞여 나온다 — 그래서 화면에서 따로 보인다.
 */
export type FontScript = 'ko' | 'latin'
export const FONT_SCRIPTS: readonly { script: FontScript; label: string }[] = [
  { script: 'ko', label: '한글' },
  { script: 'latin', label: '외국어' },
]

export interface FontFile {
  /** `fonts/` 아래의 파일 이름. */
  file: string
  /** 사람이 읽는 글꼴 이름 — 같은 이름의 여러 굵기가 한 패밀리다. */
  family: string
  /** 100(가늘게) ~ 900(굵게). */
  weight: number
  group: FontGroup
  script: FontScript
  bytes: number
  /** 파일이 스스로 밝힌 저작권 문구. 나중에 확인할 일이 생긴다. */
  copyright?: string
  licenseUrl?: string
}

export interface FontFamily {
  family: string
  group: FontGroup
  script: FontScript
  /** 가는 것부터 굵은 것 순서. */
  weights: FontFile[]
}

/** 목록에 없는 글꼴을 고르면 여기로 돌아온다 — 화면 기본 글꼴이다. */
export const FALLBACK_FAMILY = 'Pretendard'

/**
 * 그릴 글꼴 — 고르지 않았으면 기본 글꼴 (2026-09-17). 문구는 생성한 뒤에도 브라우저가
 * 다시 그리므로 글꼴을 나중에 골라도 된다. 고르지 않았다고 문구를 빼지 않는다.
 */
export function fontOrDefault(family: string | undefined): string {
  return family === undefined || family.length === 0 ? FALLBACK_FAMILY : family
}
/** 굵기를 고르지 않았을 때. 문구는 굵은 쪽이 기본이다 — 이벤트 페이지의 문구는 제목이 많다. */
export const DEFAULT_WEIGHT = 700

/** 목록 파일을 읽어 패밀리로 묶는다. 모르는 줄은 조용히 버린다 — 목록 하나가 화면을 막지 않는다. */
export function parseFontCatalog(raw: unknown): FontFamily[] {
  if (!Array.isArray(raw)) return []
  const files: FontFile[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    if (typeof r.file !== 'string' || typeof r.family !== 'string') continue
    const weight = typeof r.weight === 'number' && r.weight >= 100 && r.weight <= 950 ? r.weight : DEFAULT_WEIGHT
    files.push({
      file: r.file,
      family: r.family,
      weight,
      group: typeof r.group === 'string' ? r.group : '기타',
      // 예전 목록에는 이 칸이 없었고, 그때 실린 것은 전부 한글 글꼴이었다.
      script: r.script === 'latin' ? 'latin' : 'ko',
      bytes: typeof r.bytes === 'number' ? r.bytes : 0,
      ...(typeof r.copyright === 'string' ? { copyright: r.copyright } : {}),
      ...(typeof r.licenseUrl === 'string' && r.licenseUrl.length > 0 ? { licenseUrl: r.licenseUrl } : {}),
    })
  }

  const byFamily = new Map<string, FontFamily>()
  for (const file of files) {
    const found = byFamily.get(file.family)
    if (found === undefined) byFamily.set(file.family, { family: file.family, group: file.group, script: file.script, weights: [file] })
    else found.weights.push(file)
  }
  for (const family of byFamily.values()) family.weights.sort((a, b) => a.weight - b.weight)
  return [...byFamily.values()]
}

/**
 * 이 패밀리에서 원하는 굵기에 **가장 가까운** 파일.
 *
 * 없는 굵기를 골랐다고 글자가 안 나오면 안 된다. 굵기가 하나뿐인 글꼴이 많고,
 * 그런 글꼴에도 "굵게"를 고를 수 있어야 한다.
 */
export function pickWeight(family: FontFamily, want: number = DEFAULT_WEIGHT): FontFile | null {
  if (family.weights.length === 0) return null
  return family.weights.reduce((best, file) =>
    Math.abs(file.weight - want) < Math.abs(best.weight - want) ? file : best,
  )
}

/** 갈래 순서를 목록에 나온 차례대로 지키며 묶는다. */
export function groupFamilies(families: readonly FontFamily[]): { group: FontGroup; families: FontFamily[] }[] {
  const out: { group: FontGroup; families: FontFamily[] }[] = []
  for (const family of families) {
    const found = out.find((g) => g.group === family.group)
    if (found === undefined) out.push({ group: family.group, families: [family] })
    else found.families.push(family)
  }
  return out
}

/**
 * 화면에 보일 패밀리만 (글꼴 전체 Patch).
 *
 * 글꼴이 백 가지를 넘으면 목록만으로는 고를 수 없다. 글자 갈래(한글/외국어)로
 * 먼저 나누고, 이름 일부로 좁힌다. 대소문자와 띄어쓰기는 가리지 않는다.
 */
export function filterFamilies(
  families: readonly FontFamily[],
  script: FontScript,
  query: string,
): FontFamily[] {
  const q = query.replace(/\s+/g, '').toLowerCase()
  return families.filter(
    (f) => f.script === script && (q.length === 0 || f.family.replace(/\s+/g, '').toLowerCase().includes(q)),
  )
}
