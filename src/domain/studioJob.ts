/**
 * Studio 작업자료 (이미지 생성기 0단계 §3).
 *
 * 작성기가 만든 기획서와, 디자인팀이 그 위에 얹는 작업은 서로 다른 것이다. 이
 * 모듈은 그 경계 자체다.
 *
 *  - `source` — 불러온 그대로의 원본 기획서와 그 지문. 한 번 채택하면 다시
 *    쓰지 않으므로, 작업본이 아무리 편집돼도 원본은 남는다.
 *  - `doc` — 작업판에서 열려 있는 작업본.
 *  - `productImages` — 디자인팀이 이미지 자리마다 연결한 실제 사용 제품 누끼.
 *    블록 id → 자산 id로만 기록되고 기획서 문서에는 절대 쓰이지 않는다. 그래서
 *    연결을 지워도 설명·참고 이미지·링크·좌표가 손상될 길이 없다.
 *
 * 참고 이미지(`block.image.referenceOnly`)를 실사용 자산으로 바꾸는 경로는 이
 * 모듈에 없다. 실사용 제품 이미지는 언제나 여기 따로 연결되는 것이지, 참고
 * 이미지가 승격되는 것이 아니다.
 */

import { createId } from './factory'
import { documentFingerprint } from './documentFingerprint'
import { referencedAssetIds } from './pageOps'
import { normalizeEffects, type CompositeEffects } from './compositeEffects'
import type { GeneratedPageResult, ImageRevision } from './imageGeneration'
import type { StudioTextObject } from './textObjects'
import { NO_TONE, normalizeTone, type ToneAdjust } from './toneAdjust'
import type { BriefDocument } from './pageSchema'

export const STUDIO_JOB_VERSION = '0.1.0'

/**
 * 이미지를 만드는 두 가지 방식 (배경 합성 1차 §6).
 *
 *  - `full_ai` — 기존 `전체 AI 디자인`. 제품 원본과 기획서를 함께 보내고 모델이
 *    완성 이미지 한 장을 만든다.
 *  - `background_composite` — `배경 생성 + 원본 합성`. 모델은 **빈 배경 한 장**만
 *    만들고, 제품·인물·로고는 브라우저에서 원본 그대로 얹는다.
 *
 * 없으면 지금까지의 방식이다 — 예전 작업 행이 조용히 다른 동작으로 바뀌지 않게.
 */
export type GenerationMethod = 'full_ai' | 'background_composite'
export const DEFAULT_GENERATION_METHOD: GenerationMethod = 'full_ai'

/**
 * 한 페이지의 배경 레이어 (§5).
 *
 * 참고 이미지와는 다른 자료다. 참고 이미지는 기획 의도를 확인하려고 잠깐 겹쳐
 * 보는 것이고, 배경은 **최종 결과에 실제로 출력되는** 레이어다. 그래서 저장하는
 * 곳도, 지워지지 않게 지키는 방식도 다르다.
 *
 * 이미지 자체는 여기 들어오지 않는다 — 자산 저장소의 번호뿐이다.
 */
export interface StudioBackground {
  assetId: string
  /** 작업자가 직접 넣었는가, AI가 만들었는가. */
  source: 'manual' | 'ai'
  createdAt?: number
  /** AI 생성이면 그때 모델에게 요청한 크기. */
  requestedSize?: string
  /** AI 생성이면 그때 작업자가 적은 배경 주문. 모델의 응답이 아니다. */
  wish?: string
}

/** 불러온 원본 기획서 — 작업본과 비교할 기준. */
export interface StudioSource {
  doc: BriefDocument
  /** 채택 시점 원본의 지문 (`documentFingerprint`). */
  fingerprint: string
  fileName?: string
  importedAt: number
}

export interface StudioJob {
  id: string
  version: string
  /** 아직 아무 파일도 열지 않았으면 `null`. */
  source: StudioSource | null
  doc: BriefDocument
  /** 블록 id → 실제 사용 제품 이미지의 자산 id. */
  productImages: Record<string, string>
  /**
   * 페이지 id → 그 페이지의 가장 최근 AI 생성 결과 (1단계 §11).
   *
   * 이미지 자체는 들어오지 않는다 — 자산 저장소의 번호와 메타데이터뿐이다.
   * 페이지마다 한 건만 둔다. 이력 관리는 이번 범위가 아니고, 있지도 않은 이력을
   * 흉내 내는 구조를 미리 만들면 다음 단계에서 그것부터 걷어내야 한다.
   */
  results: Record<string, GeneratedPageResult>
  /**
   * 페이지 id → 그 페이지의 배경 레이어 (§5). 페이지당 최대 한 장이다.
   *
   * 예전 판에서 저장된 행에는 없다. 읽는 쪽은 `pageBackgroundOf`를 지나므로
   * 없는 것을 저마다 다르게 해석할 자리가 생기지 않는다.
   */
  backgrounds?: Record<string, StudioBackground>
  /** 블록 id → 그 이미지의 합성 효과 세기 (§9, §12). */
  effects?: Record<string, CompositeEffects>
  /**
   * 페이지 id → 디자인 스타일 레퍼런스의 자산 id (스타일 레퍼런스 Patch).
   *
   * 작성기의 `참고 이미지`와는 다른 자료다. 그쪽은 **배치를 눈으로 맞추려고**
   * 잠깐 겹쳐 보는 것이고 결과에 남지 않는다. 이쪽은 AI에게 **색감·질감·그래픽
   * 분위기**를 보여 주려고 실제로 보내는 한 장이다. 그래서 저장하는 곳도 다르고,
   * 페이지마다 한 장뿐이다.
   */
  styleRefs?: Record<string, string>
  /**
   * 페이지 id → 그 페이지의 꾸며진 문구 오브젝트들 (텍스트 오브젝트 Patch §1).
   *
   * 생성이 끝난 뒤에도 문구를 블록별로 남겨 둔다. 그래야 하나만 옮기거나 하나만
   * 다시 디자인할 수 있다 — 한 장에 합쳐 버리면 픽셀이 배경과 섞여 되돌릴 수
   * 없다. 그림 자체는 자산 저장소에 있고 여기에는 번호와 자리만 있다.
   */
  textObjects?: Record<string, StudioTextObject[]>
  /**
   * 페이지 id → 그 페이지의 이미지 편집 오브젝트 (블록 연결 Patch).
   *
   * 기획서의 이미지·컷아웃 블록 하나당 하나다. 결과 화면에서 옮기고 크기를
   * 바꾸는 것은 이 값이고, 기획서 블록의 좌표는 건드리지 않는다 — 결과를 손본
   * 일이 기획서를 고친 일이 되면 안 된다.
   */
  imageObjects?: Record<string, StudioTextObject[]>
  /**
   * 페이지 id → 레퍼런스의 배경 구성을 그대로 살릴 것인가 (배경 색맞춤 Patch).
   *
   * 없거나 거짓이면 지금까지처럼 색감과 결만 참고한다.
   */
  keepReferenceBg?: Record<string, boolean>
  /**
   * 블록 id → 생성 **전에** 그 블록에만 붙이는 주문 (블록별 주문 Patch).
   *
   * 완성 뒤의 부분수정과 목적이 다르다. 저쪽은 이미 만들어진 것을 고치는 일이고,
   * 이쪽은 처음 만들 때 "이 문구는 이런 느낌으로"라고 미리 말해 두는 일이다.
   * 그래서 고르지 않은 블록을 고정할 이유도 없다 — 아직 아무것도 없다.
   */
  blockOrders?: Record<string, BlockOrder>
  /** 완성 결과 전체에 얹는 그레인 (§9.5). */
  grain?: number
  /** 페이지 id → 완성 결과 전체의 톤 조절 (톤 조절 Patch). */
  tones?: Record<string, ToneAdjust>
  /**
   * 블록 id → **그 오브젝트 하나에만** 거는 톤 (블록별 톤 Patch).
   *
   * 페이지 전체 톤과 따로 산다. 사진 하나만 어둡게 깔고 페이지 전체를 밝히는 일은
   * 한 벌의 값으로는 되지 않기 때문이다. 그리는 차례는 블록별이 먼저, 전체가
   * 나중이다.
   *
   * 효과·블록 주문과 같이 블록 id 하나로 센다 — 블록은 페이지 하나에만 속한다.
   */
  objectTones?: Record<string, ToneAdjust>
  /** 이 작업이 고른 생성 방식 (§6). */
  method?: GenerationMethod
  createdAt: number
  updatedAt: number
}

export function createStudioJob(doc: BriefDocument, now: number, id?: string): StudioJob {
  return {
    id: id ?? createId('studio'),
    version: STUDIO_JOB_VERSION,
    source: null,
    doc,
    productImages: {},
    results: {},
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 예전 판에서 저장된 작업 행에는 `results`가 없다. 읽는 쪽마다 `?? {}`를 흩뿌리는
 * 대신 여기 한 번에 좁힌다 — 빠뜨린 곳 하나가 결과를 잃는 길이 되기 때문이다.
 */
export function jobResults(job: StudioJob | null): Record<string, GeneratedPageResult> {
  return job?.results ?? {}
}

/** 이 작업이 고른 생성 방식. 고른 적이 없으면 지금까지의 방식이다. */
export function methodOf(job: StudioJob | null): GenerationMethod {
  return job?.method === 'background_composite' ? 'background_composite' : DEFAULT_GENERATION_METHOD
}

export function withMethod(job: StudioJob, method: GenerationMethod, now: number): StudioJob {
  return { ...job, method, updatedAt: now }
}

/** 이 페이지의 스타일 레퍼런스. 없으면 `undefined`. */
export function styleReferenceOf(job: StudioJob | null, pageId: string): string | undefined {
  return job?.styleRefs?.[pageId]
}

/**
 * 스타일 레퍼런스를 넣거나 갈아 끼운다.
 *
 * 페이지당 한 장이므로 "추가"가 아니라 언제나 **대체**다. 여러 장을 참고하게
 * 하는 것은 이번 범위가 아니고, 자리를 미리 늘려 두면 다음 사람이 그것을 이미
 * 지원되는 기능으로 읽는다.
 */
export function withStyleReference(job: StudioJob, pageId: string, assetId: string, now: number): StudioJob {
  return { ...job, styleRefs: { ...job.styleRefs, [pageId]: assetId }, updatedAt: now }
}

/** 레퍼런스를 걷어낸다. 자산 자체는 다른 곳에서 아직 쓸 수 있으므로 지우지 않는다. */
export function withoutStyleReference(job: StudioJob, pageId: string, now: number): StudioJob {
  const next = { ...job.styleRefs }
  delete next[pageId]
  return { ...job, styleRefs: next, updatedAt: now }
}

/** 이 페이지의 배경. 없으면 `undefined` — 배경 없이도 작업은 성립한다. */
export function pageBackgroundOf(job: StudioJob | null, pageId: string): StudioBackground | undefined {
  return job?.backgrounds?.[pageId]
}

/**
 * 한 페이지의 배경을 넣거나 갈아 끼운다.
 *
 * 페이지당 한 장이므로 "추가"가 아니라 언제나 **대체**다. 다른 페이지의 배경은
 * 건드리지 않는다 (§5 페이지별 독립 보존).
 */
export function withPageBackground(
  job: StudioJob,
  pageId: string,
  background: StudioBackground,
  now: number,
): StudioJob {
  return {
    ...job,
    backgrounds: { ...job.backgrounds, [pageId]: { createdAt: now, ...background } },
    updatedAt: now,
  }
}

/** 배경을 걷어낸다. 자산 자체는 다른 곳에서 아직 쓸 수 있으므로 지우지 않는다. */
export function withoutPageBackground(job: StudioJob, pageId: string, now: number): StudioJob {
  const next = { ...job.backgrounds }
  delete next[pageId]
  return { ...job, backgrounds: next, updatedAt: now }
}

/** 이 이미지의 합성 효과. 정한 적이 없으면 기본값이다. */
export function blockEffectsOf(job: StudioJob | null, blockId: string): CompositeEffects {
  return normalizeEffects(job?.effects?.[blockId])
}

/**
 * 이 이미지에 종이 컷아웃이 걸려 있는가 (Studio Patch §2).
 *
 * 저장된 적 없는 블록은 꺼짐이다. 작업 전체를 받지 않고 `effects`만 보는 이유는,
 * 화면과 합성 계획과 파일이 같은 판정을 쓰기 위해서다.
 */
export function paperCutoutOf(
  job: { effects?: Record<string, Partial<CompositeEffects>> | undefined } | null,
  blockId: string,
): boolean {
  return job?.effects?.[blockId]?.paperCutout === true
}

/** 이 블록의 설정을 그대로 다른 블록으로 (복제, §4). */
export function withClonedBlock(job: StudioJob, from: string, to: string, now: number): StudioJob {
  const effects = job.effects?.[from]
  const product = job.productImages[from]
  const order = job.blockOrders?.[from]
  const tone = job.objectTones?.[from]
  if (effects === undefined && product === undefined && order === undefined && tone === undefined) return job
  return {
    ...job,
    ...(effects === undefined ? {} : { effects: { ...job.effects, [to]: { ...effects } } }),
    // **연결한 제품 이미지도 따라온다** (복제 설정 Patch). 앞선 판은 효과만
    // 옮겼다. 그래서 이미지 블록을 복제하면 사본은 연결이 빈 채로 생겼고,
    // 생성은 "연결되지 않은 자리가 있습니다"로 막혔다 — 사람은 방금 복제한
    // 것이 왜 비었는지 알 길이 없다.
    ...(product === undefined ? {} : { productImages: { ...job.productImages, [to]: product } }),
    ...(order === undefined ? {} : { blockOrders: { ...job.blockOrders, [to]: { ...order } } }),
    ...(tone === undefined ? {} : { objectTones: { ...job.objectTones, [to]: { ...tone } } }),
    updatedAt: now,
  }
}

/**
 * 사라진 블록의 설정을 정리한다 (삭제, §4).
 *
 * 남겨 두면 어디에도 닿지 않는 값이 파일에 쌓이고, 같은 id가 다시 생기는 날
 * 켠 적 없는 효과가 켜진 채로 나타난다.
 */
export function withOnlyBlocks(job: StudioJob, liveBlockIds: ReadonlySet<string>, now: number): StudioJob {
  const effects = job.effects ?? {}
  const kept = Object.keys(effects).filter((id) => liveBlockIds.has(id))
  if (kept.length === Object.keys(effects).length) return job
  const next: Record<string, CompositeEffects> = {}
  for (const id of kept) next[id] = effects[id]!
  return { ...job, effects: next, updatedAt: now }
}

/** 한 이미지의 효과 세기를 바꾼다. 준 항목만 갈아 끼운다. */
export function withBlockEffects(
  job: StudioJob,
  blockId: string,
  patch: Partial<CompositeEffects>,
  now: number,
): StudioJob {
  const merged = normalizeEffects({ ...blockEffectsOf(job, blockId), ...patch })
  return { ...job, effects: { ...job.effects, [blockId]: merged }, updatedAt: now }
}

/** 이 페이지의 최신 결과. */
export function pageResultOf(job: StudioJob | null, pageId: string): GeneratedPageResult | undefined {
  return jobResults(job)[pageId]
}

/**
 * 이 결과의 줄 — 최초 생성본부터 지금까지.
 *
 * 저장된 줄이 있으면 그대로 쓰고, 없으면 예전 판의 세 값에서 만들어 낸다. 그래서
 * 이미 저장된 작업도 옮겨 쓰는 절차 없이 그대로 열리고, 현재 결과를 잃지 않는다.
 * 같은 자산이 두 번 들어가지 않고, 없는 자산을 지어내지도 않는다.
 */
export function revisionsOf(result: GeneratedPageResult): ImageRevision[] {
  if (result.revisions !== undefined && result.revisions.length > 0) return result.revisions

  const ordered = [result.originalAssetId, result.previousAssetId, result.assetId]
  const seen = new Set<string>()
  const revisions: ImageRevision[] = []
  for (const assetId of ordered) {
    if (assetId === undefined || seen.has(assetId)) continue
    seen.add(assetId)
    revisions.push({ assetId, kind: revisions.length === 0 ? 'initial' : 'edit' })
  }
  // 아무것도 만들 수 없으면 지금 보고 있는 것 한 장이 줄의 시작이다.
  return revisions.length > 0 ? revisions : [{ assetId: result.assetId, kind: 'initial' }]
}

/** 지금 보고 있는 자리. 저장된 값이 줄 밖을 가리키면 현재 자산의 자리로 본다. */
export function cursorOf(result: GeneratedPageResult): number {
  const revisions = revisionsOf(result)
  if (result.cursor !== undefined && result.cursor >= 0 && result.cursor < revisions.length) {
    return result.cursor
  }
  const found = revisions.findIndex((r) => r.assetId === result.assetId)
  return found >= 0 ? found : 0
}

/** 결과 한 건을 남긴다. 다른 페이지의 결과는 건드리지 않는다. */
export function withPageResult(job: StudioJob, result: GeneratedPageResult, now: number): StudioJob {
  return {
    ...job,
    results: { ...jobResults(job), [result.pageId]: result },
    updatedAt: now,
  }
}

/**
 * 이 결과가 지금 기획서보다 이전 것인가.
 *
 * 지우지 않고 표시만 하기 위한 판정이다. 결과를 만든 뒤 문구·좌표·메모·연결이
 * 하나라도 바뀌면 참이 된다 — 지문은 그 전부를 담고 있다.
 */
export function pageResultIsStale(job: StudioJob | null, doc: BriefDocument, pageId: string): boolean {
  const result = pageResultOf(job, pageId)
  if (result === undefined) return false
  return result.sourceFingerprint !== documentFingerprint(doc)
}

/**
 * 파일을 이 작업의 원본으로 채택한다. 원본과 작업본은 이 순간 같은 내용이고,
 * 이후 작업본만 움직인다. 이전에 연결해 둔 제품 이미지는 다른 기획서의 자리를
 * 가리키게 되므로 함께 비운다.
 */
/**
 * 파일을 이 작업의 원본으로 채택한다.
 *
 * 이전 작업의 배경·효과도 함께 비운다 — 배경은 페이지 id로, 효과는 블록 id로
 * 매달려 있는데, 새 기획서에는 그 id가 없다. 남겨 두면 어디에도 닿지 않는
 * 설정이 자산 정리만 붙들고 있게 된다.
 */
export function withSource(job: StudioJob, doc: BriefDocument, now: number, fileName?: string): StudioJob {
  const source: StudioSource = {
    doc,
    fingerprint: documentFingerprint(doc),
    importedAt: now,
    ...(fileName === undefined ? {} : { fileName }),
  }
  return {
    ...job,
    source,
    doc,
    productImages: {},
    backgrounds: {},
    effects: {},
    styleRefs: {},
    textObjects: {},
    imageObjects: {},
    updatedAt: now,
  }
}

/** 작업본만 교체한다 (자동저장 경로). 원본과 연결 정보는 그대로. */
export function withWorkingDoc(job: StudioJob, doc: BriefDocument, now: number): StudioJob {
  return { ...job, doc, updatedAt: now }
}

/** 이미지 자리에 실제 사용 제품 이미지를 연결하거나 교체한다. */
export function linkProductImage(job: StudioJob, blockId: string, assetId: string): StudioJob {
  return { ...job, productImages: { ...job.productImages, [blockId]: assetId } }
}

/** 연결을 제거한다. 기획서 문서는 건드리지 않는다. */
export function unlinkProductImage(job: StudioJob, blockId: string): StudioJob {
  const next = { ...job.productImages }
  delete next[blockId]
  return { ...job, productImages: next }
}

export function productImageOf(job: StudioJob | null, blockId: string): string | undefined {
  return job?.productImages[blockId]
}

/** 디자인팀이 연결한 자산 id 전부 — 기획서 문서가 지니지 않는 것들. */
export function studioAssetIds(job: StudioJob): string[] {
  return [...new Set(Object.values(job.productImages))]
}

/**
 * 이 작업이 아직 쓰고 있는 자산 id 전부 — 자산 정리가 지우면 안 되는 것들.
 *
 * 연결한 제품 누끼만이 아니라 작업본 문서가 쓰는 이미지와 AI 생성 결과까지 함께
 * 센다. 작업본은 작성기 보관함의 어느 행도 아니고, 생성 결과는 어떤 기획서도
 * 참조하지 않는다 — 여기서 말하지 않으면 그 이미지를 아무도 대신 지켜 주지
 * 않는다. 앞의 목록만 지키면 하던 작업의 참고 이미지와 방금 만든 결과가 정리에
 * 쓸려 나간다.
 */
export function studioLiveAssetIds(job: StudioJob): string[] {
  return [
    ...new Set([
      ...referencedAssetIds(job.doc),
      ...Object.values(job.productImages),
      // 지금 것만이 아니라 최초 생성본과 직전 결과까지 — 되돌리기가 가리키는
      // 그림을 정리가 고아로 오판해 지우면 되돌릴 곳이 사라진다 (부분수정 §4).
      // 줄에 있는 모든 결과 — 앞뒤로 오갈 수 있으므로 어느 하나도 고아가 아니다.
      ...Object.values(jobResults(job)).flatMap((r) => [
        r.assetId,
        ...revisionsOf(r).map((rev) => rev.assetId),
      ]),
      // 배경은 어떤 기획서도 참조하지 않는다 — 여기서 말하지 않으면 정리가
      // 작업자가 넣거나 결제해서 만든 배경을 고아로 오판해 지운다 (§5, §12).
      ...Object.values(job.backgrounds ?? {}).map((b) => b.assetId),
      // 스타일 레퍼런스도 같다. 기획서 문서는 이 그림을 모른다.
      ...Object.values(job.styleRefs ?? {}),
      // 블록별 참고 그림도 같다. 기획서 문서는 이 그림을 모른다.
      ...Object.values(job.blockOrders ?? {})
        .map((o) => o.referenceAssetId)
        .filter((id): id is string => id !== undefined),
      // 꾸며진 문구 오브젝트도 같다. 합쳐진 결과 안에만 있는 것이 아니라 따로
      // 남아 있고, 옮기거나 다시 디자인할 때마다 이 그림을 다시 그린다.
      ...Object.values(job.textObjects ?? {}).flatMap((list) => list.map((t) => t.assetId)),
      ...Object.values(job.imageObjects ?? {}).flatMap((list) => list.map((t) => t.assetId)),
    ]),
  ]
}

/**
 * 원본 기획서가 작업본과 달라졌는가.
 *
 * 0단계에서는 자동 병합을 하지 않는다. 달라졌다는 사실만 정확히 판정해서
 * 화면에 알린다.
 */
export function sourceChanged(job: StudioJob): boolean {
  if (job.source === null) return false
  return documentFingerprint(job.doc) !== job.source.fingerprint
}

// ── 꾸며진 문구 오브젝트 (텍스트 오브젝트 Patch §1) ──────────────────────────

/** 이 페이지의 이미지 오브젝트. 없으면 빈 배열 — 예전 판 작업이 그렇다. */
/** 이 페이지가 레퍼런스 배경을 그대로 살리기로 했는가. */
export function keepReferenceBgOf(job: StudioJob | null, pageId: string): boolean {
  return job?.keepReferenceBg?.[pageId] === true
}

export function withKeepReferenceBg(job: StudioJob, pageId: string, keep: boolean, now: number): StudioJob {
  return { ...job, keepReferenceBg: { ...job.keepReferenceBg, [pageId]: keep }, updatedAt: now }
}

/** 그 블록 하나에만 붙는 주문. 둘 다 없으면 지금까지와 같은 주문이 나간다. */
export interface BlockOrder {
  /** 작업자가 적은 말. 비어 있으면 없는 것으로 본다. */
  note?: string
  /** 이 블록만 참고할 그림. 말로 설명하기 어려운 모양을 위해서다. */
  referenceAssetId?: string
}

export function blockOrderOf(job: StudioJob | null, blockId: string): BlockOrder {
  return job?.blockOrders?.[blockId] ?? {}
}

export function withBlockOrder(
  job: StudioJob,
  blockId: string,
  patch: BlockOrder,
  now: number,
): StudioJob {
  const next: BlockOrder = { ...blockOrderOf(job, blockId), ...patch }
  // 빈 값은 지운다 — 없는 것과 빈 문자열이 다른 뜻이 되면 안 된다.
  if ((next.note ?? '').trim().length === 0) delete next.note
  if (next.referenceAssetId === undefined || next.referenceAssetId.length === 0) delete next.referenceAssetId
  const orders = { ...job.blockOrders }
  if (next.note === undefined && next.referenceAssetId === undefined) delete orders[blockId]
  else orders[blockId] = next
  return { ...job, blockOrders: orders, updatedAt: now }
}

/** 이 페이지의 톤 조절. 없으면 손대지 않은 상태다. */
export function toneOf(job: StudioJob | null, pageId: string): ToneAdjust {
  return job === null ? NO_TONE : normalizeTone(job.tones?.[pageId])
}

export function objectToneOf(job: StudioJob | null, blockId: string): ToneAdjust {
  return job === null ? NO_TONE : normalizeTone(job.objectTones?.[blockId])
}

export function withObjectTone(
  job: StudioJob,
  blockId: string,
  patch: Partial<ToneAdjust>,
  now: number,
): StudioJob {
  const next = normalizeTone({ ...objectToneOf(job, blockId), ...patch })
  return { ...job, objectTones: { ...job.objectTones, [blockId]: next }, updatedAt: now }
}

export function withTone(job: StudioJob, pageId: string, patch: Partial<ToneAdjust>, now: number): StudioJob {
  const next = normalizeTone({ ...toneOf(job, pageId), ...patch })
  return { ...job, tones: { ...job.tones, [pageId]: next }, updatedAt: now }
}

export function imageObjectsOf(job: StudioJob | null, pageId: string): StudioTextObject[] {
  return job?.imageObjects?.[pageId] ?? []
}

export function withImageObjects(
  job: StudioJob,
  pageId: string,
  objects: readonly StudioTextObject[],
  now: number,
): StudioJob {
  return { ...job, imageObjects: { ...job.imageObjects, [pageId]: [...objects] }, updatedAt: now }
}

export function withImageObject(
  job: StudioJob,
  pageId: string,
  blockId: string,
  patch: Partial<Omit<StudioTextObject, 'blockId'>>,
  now: number,
): StudioJob {
  const list = imageObjectsOf(job, pageId)
  const index = list.findIndex((t) => t.blockId === blockId)
  if (index < 0) return job
  const next = [...list]
  next[index] = { ...list[index]!, ...patch }
  return { ...job, imageObjects: { ...job.imageObjects, [pageId]: next }, updatedAt: now }
}

/** 이 페이지의 문구 오브젝트. 없으면 빈 배열 — 예전 판 작업이 그렇다. */
export function textObjectsOf(job: StudioJob | null, pageId: string): StudioTextObject[] {
  return job?.textObjects?.[pageId] ?? []
}

/** 생성이 끝난 뒤 한 번에 갈아 끼운다. */
export function withTextObjects(
  job: StudioJob,
  pageId: string,
  objects: readonly StudioTextObject[],
  now: number,
): StudioJob {
  return {
    ...job,
    textObjects: { ...job.textObjects, [pageId]: [...objects] },
    updatedAt: now,
  }
}

/**
 * 한 오브젝트만 바꾼다 — 옮기기·크기 변경·다시 디자인이 모두 이 길을 지난다.
 *
 * 나머지 오브젝트는 **같은 객체 그대로** 남는다. 하나를 손대는 일이 옆의 값을
 * 건드릴 자리를 만들지 않는다.
 */
export function withTextObject(
  job: StudioJob,
  pageId: string,
  blockId: string,
  patch: Partial<Omit<StudioTextObject, 'blockId'>>,
  now: number,
): StudioJob {
  const list = textObjectsOf(job, pageId)
  const index = list.findIndex((t) => t.blockId === blockId)
  if (index < 0) return job
  const next = [...list]
  next[index] = { ...list[index]!, ...patch }
  return { ...job, textObjects: { ...job.textObjects, [pageId]: next }, updatedAt: now }
}
