/**
 * `.eventbrief` 안에 남기는 Studio 상태 (Studio 파일 결함 마감 §4.2).
 *
 * 디자인팀이 연결한 실제 사용 제품 이미지는 기획서 문서가 아니라 Studio 작업에만
 * 적힌다. 그것이 원본을 지키는 경계지만, 파일로 저장할 때 그 경계 바깥을 빼고
 * 쓰면 작업을 이어갈 수 없는 파일이 나온다 — 실제로 그랬다. 그래서 파일에
 * `studio.json` 한 장을 더 넣는다.
 *
 * `StudioJob`을 통째로 직렬화하지 않는다. 파일에 남겨야 하는 것만 여기 이름으로
 * 적고, 나머지(작업본 문서는 `document.json`이, 히스토리는 화면이 갖는다)는
 * 들어가지 않는다.
 *
 * 원본 문서 자체는 파일에 두 번 담지 않는다. 남기는 것은 **원본의 지문**이고,
 * 그것으로 "불러온 원본과 지금 작업본이 달라졌는가"를 그대로 판정할 수 있다.
 *
 * 순수 모듈이다. ZIP도 저장소도 화면도 모른다.
 */

import { normalizeEffects, type CompositeEffects } from './compositeEffects'
import type { GenerationMethod, StudioBackground, StudioJob } from './studioJob'
import type { StudioTextObject } from './textObjects'

/**
 * 이 판이 **쓰는** 버전.
 *
 * `0.1.0`에는 제품 이미지 연결만 있었다. `0.2.0`부터 배경·합성 효과·그레인·
 * 생성 방식이 함께 들어가고, `0.3.0`부터 이미지별 종이 컷아웃이, `0.4.0`부터
 * 페이지별 디자인 스타일 레퍼런스가, `0.5.0`부터 종이 테두리 두께가 함께 들어간다.
 *
 * 버전을 올리는 대신 같은 `0.1.0`에 새 칸만 얹는 길도 있었지만, 그러면 예전
 * 빌드가 그 칸을 **말없이 버리고** 저장한다 — 작업자는 배경을 넣어 저장했는데
 * 다시 열면 없는 상태가 되고, 어디서 사라졌는지 아무도 모른다. 버전을 올리면
 * 예전 빌드는 "읽을 수 없다"고 분명히 말한다. 잃는 것이 같다면 소리 내는 쪽이
 * 낫다 (§12 마지막 줄).
 */
export const STUDIO_FILE_VERSION = '0.7.0'

/** 이 판이 **읽을 수 있는** 버전. 예전 파일은 그대로 열린다. */
export const READABLE_STUDIO_FILE_VERSIONS: readonly string[] = ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0']

/** 파일이 기억하는 "이 작업이 어느 원본에서 시작했는가". */
export interface StudioFileSource {
  /** 채택 시점 원본의 지문 (`documentFingerprint`). */
  fingerprint: string
  fileName?: string
  importedAt: number
}

export interface StudioFileState {
  version: string
  /** 아직 어떤 파일도 원본으로 채택하지 않았으면 `null`. */
  source: StudioFileSource | null
  /** 블록 id → 실제 사용 제품 이미지의 자산 id. */
  productImages: Record<string, string>
  /** 페이지 id → 배경 레이어 (0.2.0). 예전 파일에는 없다. */
  backgrounds?: Record<string, StudioBackground>
  /** 블록 id → 합성 효과 세기 (0.2.0). */
  effects?: Record<string, CompositeEffects>
  /** 완성 결과 전체의 그레인 (0.2.0). */
  grain?: number
  /** 이 작업이 고른 생성 방식 (0.2.0). */
  method?: GenerationMethod
  /** 페이지 id → 디자인 스타일 레퍼런스의 자산 id (0.4.0). */
  styleRefs?: Record<string, string>
  /** 페이지 id → 꾸며진 문구 오브젝트들 (0.6.0). */
  textObjects?: Record<string, StudioTextObject[]>
  /** 페이지 id → 이미지 편집 오브젝트 (0.7.0). */
  imageObjects?: Record<string, StudioTextObject[]>
}

/** 지금 작업에서 파일에 남길 것만 추린다. */
export function toStudioFileState(job: StudioJob): StudioFileState {
  const source: StudioFileSource | null =
    job.source === null
      ? null
      : {
          fingerprint: job.source.fingerprint,
          importedAt: job.source.importedAt,
          ...(job.source.fileName === undefined ? {} : { fileName: job.source.fileName }),
        }
  return {
    version: STUDIO_FILE_VERSION,
    source,
    productImages: { ...job.productImages },
    backgrounds: { ...job.backgrounds },
    effects: { ...job.effects },
    styleRefs: { ...job.styleRefs },
    textObjects: { ...job.textObjects },
    imageObjects: { ...job.imageObjects },
    ...(job.grain === undefined ? {} : { grain: job.grain }),
    ...(job.method === undefined ? {} : { method: job.method }),
  }
}

/**
 * 이 상태가 필요로 하는 이미지 자산 id — 같은 이미지는 한 번만.
 *
 * 배경도 여기 든다. 빠뜨리면 파일에 배경 바이트가 담기지 않아, 다른 컴퓨터에서
 * 열었을 때 배경만 사라진 작업이 열린다.
 */
export function studioFileAssetIds(state: StudioFileState): string[] {
  return [
    ...new Set([
      ...Object.values(state.productImages),
      ...Object.values(state.backgrounds ?? {}).map((b) => b.assetId),
      ...Object.values(state.styleRefs ?? {}),
      // 문구 오브젝트의 그림도 파일에 담긴다 — 빼면 다른 컴퓨터에서 열었을 때
      // 문구만 사라진 결과가 열린다.
      ...Object.values(state.textObjects ?? {}).flatMap((list) => list.map((t) => t.assetId)),
      ...Object.values(state.imageObjects ?? {}).flatMap((list) => list.map((t) => t.assetId)),
    ]),
  ]
}

/**
 * 불러오기에서 자산 id가 새로 발급됐을 때, 연결정보도 같은 매핑으로 함께 옮긴다.
 * 기획서 참조만 옮기고 여기를 빼면 연결이 사라진 그림을 가리키게 된다.
 */
export function remapStudioFileState(
  state: StudioFileState,
  mapping: ReadonlyMap<string, string>,
): StudioFileState {
  if (mapping.size === 0) return state
  const productImages: Record<string, string> = {}
  for (const [blockId, assetId] of Object.entries(state.productImages)) {
    productImages[blockId] = mapping.get(assetId) ?? assetId
  }
  const backgrounds: Record<string, StudioBackground> = {}
  for (const [pageId, background] of Object.entries(state.backgrounds ?? {})) {
    backgrounds[pageId] = { ...background, assetId: mapping.get(background.assetId) ?? background.assetId }
  }
  const styleRefs: Record<string, string> = {}
  for (const [pageId, assetId] of Object.entries(state.styleRefs ?? {})) {
    styleRefs[pageId] = mapping.get(assetId) ?? assetId
  }
  const textObjects: Record<string, StudioTextObject[]> = {}
  for (const [pageId, list] of Object.entries(state.textObjects ?? {})) {
    textObjects[pageId] = list.map((t) => ({ ...t, assetId: mapping.get(t.assetId) ?? t.assetId }))
  }
  const imageObjects: Record<string, StudioTextObject[]> = {}
  for (const [pageId, list] of Object.entries(state.imageObjects ?? {})) {
    imageObjects[pageId] = list.map((t) => ({ ...t, assetId: mapping.get(t.assetId) ?? t.assetId }))
  }
  return { ...state, productImages, backgrounds, styleRefs, textObjects, imageObjects }
}

/** 예전 판 파일에는 없다. 모양이 어긋난 항목은 조용히 버린다 — 자리를 모르는
 *  오브젝트를 살려 두면 화면 어딘가에 0×0으로 붙는다. */
function readTextObjects(raw: unknown): Record<string, StudioTextObject[]> {
  if (!isRecord(raw)) return {}
  const out: Record<string, StudioTextObject[]> = {}
  for (const [pageId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const kept: StudioTextObject[] = []
    for (const item of list) {
      if (!isRecord(item)) continue
      const { blockId, assetId, rect, layer } = item
      if (typeof blockId !== 'string' || typeof assetId !== 'string' || assetId.length === 0) continue
      if (!isRecord(rect)) continue
      const nums = ['x', 'y', 'width', 'height'].map((k) => rect[k])
      if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) continue
      kept.push({
        blockId,
        assetId,
        rect: { x: nums[0] as number, y: nums[1] as number, width: nums[2] as number, height: nums[3] as number },
        layer: typeof layer === 'number' ? layer : 0,
      })
    }
    out[pageId] = kept
  }
  return out
}

function readBackgrounds(raw: unknown): Record<string, StudioBackground> | null {
  if (raw === undefined) return {}
  if (!isRecord(raw)) return null
  const backgrounds: Record<string, StudioBackground> = {}
  for (const [pageId, value] of Object.entries(raw)) {
    if (!isRecord(value)) return null
    const assetId = value.assetId
    // 가리키는 곳이 없는 배경은 배경이 아니다 — 조용히 버리지 않고 실패로 본다.
    if (typeof assetId !== 'string' || assetId.length === 0) return null
    backgrounds[pageId] = {
      assetId,
      source: value.source === 'ai' ? 'ai' : 'manual',
      ...(typeof value.createdAt === 'number' ? { createdAt: value.createdAt } : {}),
      ...(typeof value.requestedSize === 'string' ? { requestedSize: value.requestedSize } : {}),
      ...(typeof value.wish === 'string' ? { wish: value.wish } : {}),
    }
  }
  return backgrounds
}

function readEffects(raw: unknown): Record<string, CompositeEffects> {
  if (!isRecord(raw)) return {}
  const effects: Record<string, CompositeEffects> = {}
  // 세기 하나가 이상하다고 작업자가 맞춰 둔 나머지를 잃게 하지 않는다 — 여기서는
  // 좁히고 채운다. 가리키는 자산이 없는 값이 아니므로 잃을 그림도 없다.
  for (const [blockId, value] of Object.entries(raw)) effects[blockId] = normalizeEffects(value)
  return effects
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 신뢰할 수 없는 `studio.json`을 좁힌다. 형태가 어긋나면 `null`.
 *
 * 버전은 이 빌드가 아는 그 하나여야 한다. 모르는 버전을 "문자열이니 통과"로
 * 받아들이면, 뒤 판의 다른 뜻으로 적힌 연결을 이 판의 뜻으로 읽어 엉뚱한 그림을
 * 연결하거나 연결을 잃는다. 읽을 수 없다고 말하는 편이 낫다.
 */
export function parseStudioFileState(raw: unknown): StudioFileState | null {
  if (!isRecord(raw)) return null
  if (typeof raw.version !== 'string' || !READABLE_STUDIO_FILE_VERSIONS.includes(raw.version)) return null

  const links = raw.productImages
  if (!isRecord(links)) return null
  const productImages: Record<string, string> = {}
  for (const [blockId, assetId] of Object.entries(links)) {
    // 값이 문자열이 아닌 연결은 가리키는 곳이 없다 — 조용히 버리지 않고 실패로 본다.
    if (typeof assetId !== 'string' || assetId.length === 0) return null
    productImages[blockId] = assetId
  }

  let source: StudioFileSource | null = null
  if (isRecord(raw.source)) {
    if (typeof raw.source.fingerprint !== 'string') return null
    source = {
      fingerprint: raw.source.fingerprint,
      importedAt: typeof raw.source.importedAt === 'number' ? raw.source.importedAt : 0,
      ...(typeof raw.source.fileName === 'string' ? { fileName: raw.source.fileName } : {}),
    }
  }

  const backgrounds = readBackgrounds(raw.backgrounds)
  if (backgrounds === null) return null

  const styleRefs: Record<string, string> = {}
  if (isRecord(raw.styleRefs)) {
    for (const [pageId, assetId] of Object.entries(raw.styleRefs)) {
      // 가리키는 곳이 없는 레퍼런스는 레퍼런스가 아니다.
      if (typeof assetId !== 'string' || assetId.length === 0) return null
      styleRefs[pageId] = assetId
    }
  }

  return {
    version: STUDIO_FILE_VERSION,
    source,
    productImages,
    backgrounds,
    styleRefs,
    textObjects: readTextObjects(raw.textObjects),
    imageObjects: readTextObjects(raw.imageObjects),
    effects: readEffects(raw.effects),
    ...(typeof raw.grain === 'number' ? { grain: Math.min(1, Math.max(0, raw.grain)) } : {}),
    ...(raw.method === 'background_composite' || raw.method === 'full_ai' ? { method: raw.method } : {}),
  }
}
