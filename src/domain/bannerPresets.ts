/**
 * 프리셋을 고칠 수 있게 한다 (프리셋 관리 Patch).
 *
 * `bannerSpec.ts`의 다섯은 작업자가 직접 적어 준 크기다. 다만 쇼핑몰이 개편되면
 * 그 크기가 바뀌고, 새 자리가 생기면 여섯째가 필요해진다 — "이 프리셋 사이즈는
 * 수정 변경 저장 가능하게."
 *
 * 그래서 화면이 쓰는 목록은 **저장된 것이 있으면 그것**, 없으면 기본값이다.
 * 저장된 목록을 비우면 기본값으로 돌아온다 — 되돌릴 길이 없는 편집은 만들지 않는다.
 *
 * 사람이 손으로 적는 값이 그대로 들어오므로 여기서 다 막는다. 크기가 0이거나
 * 음수이거나 글자면 그 줄은 없는 것으로 본다. 이름이 비면 크기가 곧 이름이다.
 *
 * 순수 모듈이다. `localStorage`도 화면도 모르고, 읽고 쓰는 일은 부르는 쪽이 한다.
 */

import { BANNER_SPECS, type BannerSpec } from './bannerSpec'

export const MAX_BANNER_SIDE = 8000

/** 한 줄이 편집 중에 갖는 모양 — 전부 글자다. 사람이 지우는 도중에도 살아 있어야 한다. */
export interface PresetDraft {
  id: string
  label: string
  width: string
  height: string
  /** `840×78, 500x387`처럼 적는다. `×`도 `x`도 받는다. */
  siblings: string
}

/** 규격을 편집 줄로 편다. */
export function toDraft(spec: BannerSpec): PresetDraft {
  return {
    id: spec.id,
    label: spec.label,
    width: String(spec.width),
    height: String(spec.height),
    siblings: spec.siblings.map((s) => `${String(s.width)}×${String(s.height)}`).join(', '),
  }
}

function readSize(text: string): { width: number; height: number } | null {
  const match = /^\s*(\d+)\s*[x×X]\s*(\d+)\s*$/.exec(text)
  if (match === null) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 1 || height < 1 || width > MAX_BANNER_SIDE || height > MAX_BANNER_SIDE) return null
  return { width, height }
}

/**
 * 편집 줄을 규격으로 되돌린다. 크기가 말이 안 되면 `null`.
 *
 * 번호는 크기에서 만든다 — 크기를 고치면 번호도 따라 바뀌고, 그래야 이미 뽑아 둔
 * 배너 페이지가 **바뀐 크기를 자기 것인 양** 쓰지 않는다.
 */
export function fromDraft(draft: PresetDraft): BannerSpec | null {
  const size = readSize(`${draft.width}x${draft.height}`)
  if (size === null) return null
  const label = draft.label.trim()
  return {
    id: `${String(size.width)}x${String(size.height)}`,
    label: label.length === 0 ? `${String(size.width)}×${String(size.height)}` : label,
    width: size.width,
    height: size.height,
    siblings: draft.siblings
      .split(',')
      .map(readSize)
      .filter((s): s is { width: number; height: number } => s !== null),
    edgeReport: ['left', 'right'],
  }
}

/**
 * 저장해 둔 목록을 읽는다.
 *
 * 한 줄이라도 모양이 어긋나면 그 줄만 버린다 — 전부 버리면 손으로 적어 둔 다섯 중
 * 하나의 오타 때문에 넷까지 사라진다. 남는 줄이 하나도 없으면 기본값을 쓴다.
 */
export function readPresets(raw: unknown): readonly BannerSpec[] {
  if (!Array.isArray(raw)) return BANNER_SPECS
  const kept: BannerSpec[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const spec = fromDraft({
      id: '',
      label: typeof row.label === 'string' ? row.label : '',
      width: String(row.width ?? ''),
      height: String(row.height ?? ''),
      siblings: Array.isArray(row.siblings)
        ? row.siblings
            .map((s) => (typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {}))
            .map((s) => `${String(s.width ?? '')}x${String(s.height ?? '')}`)
            .join(',')
        : '',
    })
    // 같은 크기를 두 번 적으면 버튼이 둘 다 같은 배너를 가리킨다.
    if (spec !== null && !kept.some((k) => k.id === spec.id)) kept.push(spec)
  }
  return kept.length === 0 ? BANNER_SPECS : kept
}

/** 저장할 모양 — 화면의 말이 아니라 값만. */
export function writePresets(specs: readonly BannerSpec[]): unknown {
  return specs.map((spec) => ({
    label: spec.label,
    width: spec.width,
    height: spec.height,
    siblings: spec.siblings.map((s) => ({ width: s.width, height: s.height })),
  }))
}
