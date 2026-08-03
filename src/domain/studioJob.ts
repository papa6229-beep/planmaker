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
import type { GeneratedPageResult } from './imageGeneration'
import type { BriefDocument } from './pageSchema'

export const STUDIO_JOB_VERSION = '0.1.0'

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

/** 이 페이지의 최신 결과. */
export function pageResultOf(job: StudioJob | null, pageId: string): GeneratedPageResult | undefined {
  return jobResults(job)[pageId]
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
export function withSource(job: StudioJob, doc: BriefDocument, now: number, fileName?: string): StudioJob {
  const source: StudioSource = {
    doc,
    fingerprint: documentFingerprint(doc),
    importedAt: now,
    ...(fileName === undefined ? {} : { fileName }),
  }
  return { ...job, source, doc, productImages: {}, updatedAt: now }
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
      ...Object.values(jobResults(job)).map((r) => r.assetId),
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
