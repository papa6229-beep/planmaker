/**
 * GPT 제작 요청 해석 경계 (이미지 생성기 0단계 §5).
 *
 * `BriefDocument + Studio 작업자료 → GenerationRequest`.
 *
 * 원본 `.eventbrief`를 설명 없이 통째로 보내는 대신, 한 페이지가 무엇을
 * 요구하는지 명시적으로 적은 요청 하나를 만든다. 해석은 이 모듈에서만 일어나며,
 * 화면(미리보기)도 나중의 API 연결도 같은 함수를 읽는다 — 해석기가 둘로 갈리면
 * "사람이 본 것"과 "GPT가 받은 것"이 달라지기 때문이다.
 *
 * 구조는 두 덩이로 나뉜다.
 *
 *  - `design` — 이미지 제작 입력. 문구·자리·버튼 문구·참고자료·제약이 들어간다.
 *    연결 주소(URL) 문자열은 여기에 절대 들어가지 않는다.
 *  - `publishing` — 주소와 퍼블리싱 메모. 보관은 하되 이미지 입력이 아니다.
 *
 * 문구·기하·강조·이미지 자리·`hasLink` 판정은 이미 규칙 기반으로 존재하는
 * `buildDesignSummary`를 그대로 쓴다. 같은 해석을 두 벌 만들지 않기 위해서다.
 * 이 모듈이 더하는 것은 페이지 단위 캔버스 크기와 상대 비율, 정렬, 디자인팀이
 * 연결한 실제 제품 이미지, 그리고 사람이 읽을 수 있는 제약 문장이다.
 */

import { buildDesignSummary, buildPublishingInfo, isReferenceCapture } from './summaryBuilder'
import { pageAsEventBrief } from './briefMigration'
import { documentDigest, documentFingerprint } from './documentFingerprint'
import { linkUrlOf, textAlignOf, type TextAlign } from './simpleBlocks'
import { productImageOf, type StudioJob } from './studioJob'
import type { Asset, LayoutEmphasis, PublishingInfo, SummaryInstruction } from './briefSchema'
import type { BriefDocument, BriefPage, ReferenceFit } from './pageSchema'

export const GENERATION_REQUEST_VERSION = '0.1.0'

/** GPT가 지켜야 할 것 — 사람이 읽는 문장 그대로 요청에 실린다 (§5.1, §5.5). */
export const GENERATION_CONSTRAINTS: readonly string[] = [
  '모든 문구는 원문 그대로 사용합니다. 고쳐 쓰거나 줄이거나 맞춤법을 바꾸지 않습니다.',
  '참고 이미지는 배경·분위기·구성을 참고하기 위한 자료이며, 최종 이미지에 그대로 넣는 자산이 아닙니다.',
  '실제 사용 제품 이미지는 제품의 형태·색상·상표를 임의로 바꾸지 않습니다.',
  '기획서에 없는 가격·할인율·상품·문구를 지어내지 않습니다.',
  '전체 컨셉과 요청 메모는 방향 설명입니다. 이미지에 인쇄하지 않습니다.',
  '연결 주소(URL)는 이미지 제작 입력에 포함되지 않으며, 이미지에 인쇄하지 않습니다.',
]

export interface GenerationBox {
  x: number
  y: number
  width: number
  height: number
}

/** 같은 상자를 페이지 크기에 대한 0~1 비율로도 준다 (§5.2). */
export type GenerationRatio = GenerationBox

export interface GenerationDocumentInfo {
  /** 원본 문서 식별자 — 파일이 지니고 있던 것. 없을 수도 있다. */
  documentId?: string
  /**
   * 작업본의 지문. 같은 작업물인지 판정하는 값이며, 내용을 담지 않는 짧은
   * 다이제스트다 — 전체 지문은 문서의 모든 문구(주소 포함)를 그대로 담고 있어
   * 이미지 제작 입력에 실을 수 없다.
   */
  fingerprint: string
  title: string
  requestTeam?: string
  concept?: string
  pageCount: number
  pageId: string
  pageTitle: string
  /** 출력 캔버스 크기 — 페이지마다 다르다. */
  canvas: { width: number; height: number }
}

export interface GenerationTextEntry {
  blockId: string
  /** 원문 그대로. */
  content: string
  verbatim: true
  /** 이미지에 실제로 인쇄할 문구인지 — 문구 블록은 언제나 인쇄 대상이다. */
  printInImage: true
  emphasis: LayoutEmphasis
  align: TextAlign
  box: GenerationBox
  ratio: GenerationRatio
}

export interface GenerationAssetRef {
  assetId: string
  fileName?: string
}

export interface GenerationImageSlot {
  blockId: string
  /** 작성자가 적은 설명, 원문 그대로. */
  description?: string
  box: GenerationBox
  ratio: GenerationRatio
  /** 작성자가 붙인 참고 캡처. 최종 사용 이미지가 아니다. */
  referenceAsset?: GenerationAssetRef
  /** `referenceAsset`이 있을 때만 있고, 언제나 true. */
  referenceOnly?: true
  /** 디자인팀이 연결한 실제 사용 제품 누끼. */
  productImage?: GenerationAssetRef
  /** 실제 사용 제품 이미지가 연결됐는지 — 미연결도 숨기지 않는다. */
  status: 'linked' | 'missing'
  /** 기존 계약에 변형 허용 여부가 있으면 그 값. */
  allowTransform?: boolean
}

export interface GenerationButton {
  blockId: string
  /** 버튼에 인쇄할 문구. */
  text: string
  box: GenerationBox
  ratio: GenerationRatio
  /** 주소 문자열이 아니라 "연결 주소 있음" 여부만 (§5.4). */
  hasLink: boolean
}

/** 페이지 전체에 깔린 참고 이미지와 그 보기 방식 (§5.5). */
export interface GenerationPageReference {
  assetId?: string
  fileName?: string
  overlay: boolean
  opacity: number
  fit: ReferenceFit
  note: string
}

export interface GenerationDesignInput {
  document: GenerationDocumentInfo
  texts: GenerationTextEntry[]
  imageSlots: GenerationImageSlot[]
  buttons: GenerationButton[]
  /** 전체 컨셉과 요청 메모 — 언제나 `renderAsText: false`. */
  instructions: SummaryInstruction[]
  reference: GenerationPageReference
  constraints: readonly string[]
  /** 아직 실제 제품 이미지가 연결되지 않은 자리의 블록 id. */
  missingProductImages: string[]
}

export interface GenerationRequest {
  kind: 'image_generation_request'
  version: string
  /** 이미지 제작 입력. 주소 문자열이 들어가지 않는 부분. */
  design: GenerationDesignInput
  /** 이미지 입력이 아닌 퍼블리싱 정보. 주소는 여기에만 남는다. */
  publishing: PublishingInfo
  /** 원본 기획서와 작업본이 달라졌는지 (§7). */
  sourceChanged: boolean
}

const REFERENCE_NOTE = '페이지 참고 이미지입니다. 배경·분위기·구성 참고용이며 최종 이미지에 그대로 사용하지 않습니다.'

function ratioOf(box: GenerationBox, width: number, height: number): GenerationRatio {
  return {
    x: width === 0 ? 0 : box.x / width,
    y: height === 0 ? 0 : box.y / height,
    width: width === 0 ? 0 : box.width / width,
    height: height === 0 ? 0 : box.height / height,
  }
}

function assetRef(assets: Asset[], assetId: string): GenerationAssetRef {
  const fileName = assets.find((a) => a.id === assetId)?.fileName
  return { assetId, ...(fileName === undefined ? {} : { fileName }) }
}

/** 한 페이지에 대한 제작 요청 하나. */
export function buildGenerationRequest(
  doc: BriefDocument,
  job: StudioJob,
  pageId: string,
): GenerationRequest {
  const page: BriefPage = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]!
  const brief = pageAsEventBrief(doc, page)
  const design = buildDesignSummary(brief, { pageId: page.id })
  const publishing = buildPublishingInfo(brief)
  const { canvasWidth: width, canvasHeight: height } = page
  const ratio = (box: GenerationBox) => ratioOf(box, width, height)
  const blockOf = (blockId: string) => page.blocks.find((b) => b.id === blockId)

  // 버튼 문구는 버튼 목록이 맡는다. 디자인 요약의 `texts`는 "빠뜨리지 않기"가
  // 목적이라 버튼도 포함하는 상위집합인데, 제작 요청에서 그대로 두면 같은 문구가
  // 두 번 요구된다 (첫 사용 흐름 §9).
  const buttonIds = new Set(design.ctaButtons.map((c) => c.blockId))

  const texts: GenerationTextEntry[] = design.texts.filter((t) => !buttonIds.has(t.blockId)).map((t) => {
    const block = blockOf(t.blockId)
    return {
      blockId: t.blockId,
      content: t.content,
      verbatim: true,
      printInImage: true,
      emphasis: t.emphasis,
      align: block ? textAlignOf(block) : 'left',
      box: t.geometry,
      ratio: ratio(t.geometry),
    }
  })

  const imageSlots: GenerationImageSlot[] = design.imageSlots.map((slot) => {
    const block = blockOf(slot.blockId)
    const productAssetId = productImageOf(job, slot.blockId)
    const entry: GenerationImageSlot = {
      blockId: slot.blockId,
      box: slot.geometry,
      ratio: ratio(slot.geometry),
      status: productAssetId === undefined ? 'missing' : 'linked',
    }
    if (slot.description !== undefined) entry.description = slot.description
    // 참고 캡처는 끝까지 참고 캡처다. 여기서 실사용 자산으로 바뀌는 길은 없다.
    if (slot.referenceAssetId !== undefined) {
      entry.referenceAsset = assetRef(doc.assets, slot.referenceAssetId)
      entry.referenceOnly = true
    } else if (block?.assetId !== undefined && isReferenceCapture(block)) {
      entry.referenceAsset = assetRef(doc.assets, block.assetId)
      entry.referenceOnly = true
    }
    if (productAssetId !== undefined) entry.productImage = assetRef(doc.assets, productAssetId)
    if (block?.image?.allowTransform !== undefined) entry.allowTransform = block.image.allowTransform
    return entry
  })

  const buttons: GenerationButton[] = design.ctaButtons.map((cta) => {
    const block = blockOf(cta.blockId)
    const box: GenerationBox = block
      ? { x: block.position.x, y: block.position.y, width: block.position.width, height: block.position.height }
      : { x: 0, y: 0, width: 0, height: 0 }
    // 링크가 "이 페이지 어딘가에 있다"가 아니라 **이 버튼의 짝**인지로 판정한다.
    const hasLink = block !== undefined && linkUrlOf(page.blocks, block) !== undefined
    return { blockId: cta.blockId, text: cta.text, box, ratio: ratio(box), hasLink }
  })

  const reference: GenerationPageReference = {
    overlay: page.reference.visible && page.reference.assetId !== undefined,
    opacity: page.reference.opacity,
    fit: page.reference.fit,
    note: REFERENCE_NOTE,
  }
  if (page.reference.assetId !== undefined) {
    const ref = assetRef(doc.assets, page.reference.assetId)
    reference.assetId = ref.assetId
    if (ref.fileName !== undefined) reference.fileName = ref.fileName
  }

  // 작업자가 작업판에서 적은 AI 지시. 작성자의 전달 메모(디자인 요약이 이미
  // 지시로 실어 준다)와 이름이 다르므로, 읽는 쪽에서 둘을 섞을 일이 없다.
  const instructions: SummaryInstruction[] = [...design.instructions]
  const aiNote = doc.project.aiNote?.trim()
  if (aiNote !== undefined && aiNote.length > 0) {
    instructions.push({
      scope: 'document',
      label: 'AI에게 추가로 전달할 말',
      content: aiNote,
      renderAsText: false,
    })
  }

  const document: GenerationDocumentInfo = {
    fingerprint: documentDigest(doc),
    title: doc.project.title,
    pageCount: doc.pages.length,
    pageId: page.id,
    pageTitle: page.title,
    canvas: { width, height },
  }
  if (doc.project.id !== undefined) document.documentId = doc.project.id
  if (design.requestTeam !== undefined) document.requestTeam = design.requestTeam
  const concept = doc.project.concept?.trim()
  if (concept !== undefined && concept.length > 0) document.concept = concept

  return {
    kind: 'image_generation_request',
    version: GENERATION_REQUEST_VERSION,
    design: {
      document,
      texts,
      imageSlots,
      buttons,
      instructions,
      reference,
      constraints: GENERATION_CONSTRAINTS,
      missingProductImages: imageSlots.filter((s) => s.status === 'missing').map((s) => s.blockId),
    },
    publishing,
    // 저장된 작업본이 아니라 **지금 화면의 문서**를 원본과 견준다. 방금 고친
    // 내용이 3초 뒤에야 "달라졌다"고 나오면 판정으로서 의미가 없다 (§9).
    sourceChanged: job.source !== null && documentFingerprint(doc) !== job.source.fingerprint,
  }
}

/** 페이지마다 하나씩 — 페이지는 저마다 크기와 내용이 다르다 (§9.9). */
export function buildGenerationRequests(doc: BriefDocument, job: StudioJob): GenerationRequest[] {
  return doc.pages.map((page) => buildGenerationRequest(doc, job, page.id))
}
