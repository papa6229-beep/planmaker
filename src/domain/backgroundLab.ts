/**
 * 배경 후보 (배경 후보 Patch, 2026-09-17).
 *
 * 사용자: "이미지블록의 제품을 보고, 그것과 어울리게 자연어로 요청 … 제품이 왜곡된 합성
 * 이미지가 나올 거 아냐? 거기서 제품 이미지만을 자동으로 삭제한 이미지가 출력되서 요청할
 * 때마다 하나씩 쌓이는 거야. 그다음에 적용하기 하면 기존 배경화면과 교체."
 *
 * 기존 배경 판과 **다른 길**이다 (사용자: "여기는 별도의 방식"). 여기서는 제품 사진을
 * 일부러 보여 주고(`scene`), 받은 장면에서 제품만 지운다(`scene-clean`) — 후보 한 장에
 * AI 호출 두 번. 다시 그려진 제품은 지워지고, 진짜 제품은 지금처럼 브라우저가 원본을
 * 얹는다. 배경 판의 "제품은 색만, 숫자로" 규칙은 그대로다.
 *
 * 분위기 그림: 이 칸에 따로 첨부한 그림이 있으면 그것, 없으면 페이지의 스타일
 * 레퍼런스, 둘 다 없으면 제품만 (사용자 3번).
 *
 * 순수 모듈이다. 후보는 작업 파일에 남는다 — 다시 열어도 비교를 이어 간다.
 */

import type { BriefPage } from './pageSchema'
import { isImageBlock } from './blockTypes'

/** 어댑터가 받는 이름 — 이름이 곧 역할이다 (`converter.py`의 SCENE_*). */
export const SCENE_PRODUCT_FILE = (n: number): string => `product-${String(n)}.png`
export const SCENE_REFERENCE_FILE = 'scene-reference.png'
export const SCENE_IMAGE_FILE = 'scene.png'
/** 어댑터의 그림 칸은 셋이다 — 분위기 그림 한 장을 남기고 제품은 둘까지. */
export const SCENE_MAX_PRODUCTS = 2
/** 한 페이지에 남기는 후보 수. 넘으면 오래된 것부터 뺀다 (적용 중인 것은 빼지 않는다). */
export const SCENE_CANDIDATE_LIMIT = 30
/** 말을 비워 두었을 때 보내는 말. 서버는 빈 프롬프트를 받지 않는다. */
export const SCENE_DEFAULT_NOTE = '제품과 어울리는 배경'
/** 지우기 요청의 프롬프트 칸. 어댑터는 이 칸을 읽지 않고 고정 문장을 쓴다. */
export const SCENE_CLEAN_NOTE = '제품을 지우고 나머지는 그대로'

/** 이 후보를 만들 때 분위기를 어디서 가져왔는가. `previous`는 적용하며 밀려난 배경. */
export type SceneBasis = 'attached' | 'style' | 'none' | 'previous'

export interface SceneCandidate {
  id: string
  assetId: string
  /** 작업자가 적은 말 그대로. 밀려난 배경이면 빈 문자열. */
  note: string
  basis: SceneBasis
  createdAt: number
  requestedSize?: string
}

export interface BackgroundLab {
  /** 이 칸에만 첨부한 분위기 그림. 없으면 스타일 레퍼런스를 쓴다. */
  referenceAssetId?: string
  candidates: SceneCandidate[]
}

export const EMPTY_LAB: BackgroundLab = { candidates: [] }

export const SCENE_BASIS_LABEL: Record<SceneBasis, string> = {
  attached: '첨부 그림',
  style: '스타일 레퍼런스',
  none: '제품만',
  previous: '이전 배경',
}

/**
 * 보여 줄 제품 — 제품이 연결된 이미지 블록을 **큰 것부터** 둘까지. 같은 그림은 한 번.
 * 가장 넓은 자리를 차지하는 제품이 장면의 기준이 되어야 한다.
 */
export function pickSceneProducts(page: BriefPage, productImages: Readonly<Record<string, string>>): string[] {
  const linked = page.blocks
    .filter((b) => isImageBlock(b.type) && b.aiVisibility !== 'publishing' && productImages[b.id] !== undefined)
    .map((b) => ({ assetId: productImages[b.id]!, area: b.position.width * b.position.height }))
    .sort((a, b) => b.area - a.area)
  const out: string[] = []
  for (const item of linked) {
    if (!out.includes(item.assetId)) out.push(item.assetId)
    if (out.length === SCENE_MAX_PRODUCTS) break
  }
  return out
}

/** 분위기 그림 — 첨부한 것, 없으면 스타일 레퍼런스. */
export function sceneReference(
  lab: BackgroundLab,
  styleReferenceAssetId: string | undefined,
): { assetId: string; basis: 'attached' | 'style' } | null {
  if (lab.referenceAssetId !== undefined) return { assetId: lab.referenceAssetId, basis: 'attached' }
  if (styleReferenceAssetId !== undefined) return { assetId: styleReferenceAssetId, basis: 'style' }
  return null
}

/** 새 후보를 맨 앞에. 한도를 넘으면 오래된 것부터 — 지금 배경은 남긴다. */
export function withCandidate(lab: BackgroundLab, candidate: SceneCandidate, keepAssetId?: string): BackgroundLab {
  const list = [candidate, ...lab.candidates.filter((c) => c.assetId !== candidate.assetId)]
  while (list.length > SCENE_CANDIDATE_LIMIT) {
    const at = list.map((c) => c.assetId !== keepAssetId).lastIndexOf(true)
    if (at <= 0) break
    list.splice(at, 1)
  }
  return { ...lab, candidates: list }
}

export function withoutCandidate(lab: BackgroundLab, candidateId: string): BackgroundLab {
  return { ...lab, candidates: lab.candidates.filter((c) => c.id !== candidateId) }
}

export function labAssetIds(labs: Readonly<Record<string, BackgroundLab>> | undefined): string[] {
  return Object.values(labs ?? {}).flatMap((lab) => [
    ...(lab.referenceAssetId === undefined ? [] : [lab.referenceAssetId]),
    ...lab.candidates.map((c) => c.assetId),
  ])
}

// ── 작업 파일 ──────────────────────────────────────────────────────────────

const BASES: readonly SceneBasis[] = ['attached', 'style', 'none', 'previous']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 믿을 수 없는 값을 좁힌다. 가리키는 곳이 없는 후보는 버린다 — 적어 둔 말만 남는 후보는 쓸 데가 없다. */
export function readBackgroundLabs(raw: unknown): Record<string, BackgroundLab> {
  if (!isRecord(raw)) return {}
  const out: Record<string, BackgroundLab> = {}
  for (const [pageId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const candidates: SceneCandidate[] = []
    for (const c of Array.isArray(value.candidates) ? value.candidates : []) {
      if (!isRecord(c) || typeof c.assetId !== 'string' || c.assetId.length === 0) continue
      candidates.push({
        id: typeof c.id === 'string' && c.id.length > 0 ? c.id : `cand_${c.assetId}`,
        assetId: c.assetId,
        note: typeof c.note === 'string' ? c.note : '',
        basis: BASES.includes(c.basis as SceneBasis) ? (c.basis as SceneBasis) : 'none',
        createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
        ...(typeof c.requestedSize === 'string' ? { requestedSize: c.requestedSize } : {}),
      })
    }
    out[pageId] = {
      candidates: candidates.slice(0, SCENE_CANDIDATE_LIMIT),
      ...(typeof value.referenceAssetId === 'string' && value.referenceAssetId.length > 0
        ? { referenceAssetId: value.referenceAssetId }
        : {}),
    }
  }
  return out
}

/** 사라진 그림을 가리키는 후보·첨부를 뺀다. `gone`이 뺀 것을 적는다. */
export function dropMissingLabAssets(
  labs: Readonly<Record<string, BackgroundLab>> | undefined,
  gone: (kind: 'sceneCandidate' | 'sceneReference', assetId: string, pageId: string) => boolean,
): Record<string, BackgroundLab> {
  const out: Record<string, BackgroundLab> = {}
  for (const [pageId, lab] of Object.entries(labs ?? {})) {
    const keepRef = lab.referenceAssetId !== undefined && !gone('sceneReference', lab.referenceAssetId, pageId)
    out[pageId] = {
      candidates: lab.candidates.filter((c) => !gone('sceneCandidate', c.assetId, pageId)),
      ...(keepRef ? { referenceAssetId: lab.referenceAssetId } : {}),
    }
  }
  return out
}

export function remapLabs(
  labs: Readonly<Record<string, BackgroundLab>> | undefined,
  mapping: ReadonlyMap<string, string>,
): Record<string, BackgroundLab> {
  const out: Record<string, BackgroundLab> = {}
  for (const [pageId, lab] of Object.entries(labs ?? {})) {
    out[pageId] = {
      candidates: lab.candidates.map((c) => ({ ...c, assetId: mapping.get(c.assetId) ?? c.assetId })),
      ...(lab.referenceAssetId === undefined
        ? {}
        : { referenceAssetId: mapping.get(lab.referenceAssetId) ?? lab.referenceAssetId }),
    }
  }
  return out
}
