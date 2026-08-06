/**
 * 로컬 합성 계획 (배경 합성 1차 §9, §10).
 *
 * "이 페이지를 어떻게 그릴 것인가"를 **숫자로만** 적어 둔 것이다. 픽셀은 여기
 * 없고, 캔버스도 여기 없다. 그리는 일은 이 계획을 받는 렌더러가 한다.
 *
 * 그렇게 나눠 두는 이유가 §13-9와 §13-6이다.
 *
 *  - 계획을 세우는 것만으로는 어떤 자산도 바뀌지 않는다. 원본 제품 이미지는
 *    번호로만 등장하고, 효과는 그 번호 옆에 붙는 숫자다. 세기를 0으로 내리면
 *    원본이 그대로 돌아온다 — 되돌릴 것이 없으므로.
 *  - `externalCalls`가 `0`인 것은 문서가 아니라 값이다. 직접 넣은 배경으로
 *    결과를 만드는 길에 모델을 부르는 자리가 아예 없다는 뜻이고, 그 사실을
 *    검사가 읽을 수 있다.
 */

import { normalizeEffects, type CompositeEffects } from './compositeEffects'
import { cropToCanvas, imageFitOf, type CanvasCrop, type ImageFit, type LayoutRect } from './imageLayout'
import { getBlockTypeMeta } from './blockTypes'
import { drawsBareText, isPairedLinkUrl, textAlignOf, type TextAlign } from './simpleBlocks'
import { CARD_CHROME_Y, CARD_PADDING_X, fitTextSize } from './textFit'
import type { BriefPage } from './pageSchema'
import type { StudioBackground } from './studioJob'

export interface CompositeLayerPlan {
  blockId: string
  /** 원본 자산의 번호. 이 계획은 그 자산을 읽기만 한다. */
  assetId: string
  rect: LayoutRect
  fit: ImageFit
  /** 캔버스 밖으로 걸친 부분을 뺀 최종 사각형. 전부 밖이면 `null`. */
  crop: CanvasCrop | null
  effects: CompositeEffects
}

export interface CompositeTextPlan {
  blockId: string
  content: string
  rect: LayoutRect
  align: TextAlign
  fontSize: number
  /** 카드 없이 글씨만 그리는 종류인가 (기존 표현 그대로). */
  bare: boolean
}

export interface CompositePlan {
  size: { width: number; height: number }
  /** 이 페이지의 배경. 없으면 흰 바탕이다. */
  background?: StudioBackground
  /**
   * 맨 앞에 얹는 한 장 (한방 생성 Patch 2 §4).
   *
   * AI가 만든 전경 문구 레이어다. 배경이 투명하므로 아래의 배경과 사진이 그대로
   * 비치고, 이 겹이 맨 앞이라 **문구는 언제나 이미지보다 앞**에 온다.
   */
  foreground?: { assetId: string }
  /**
   * 맨 앞에 얹는 문구 오브젝트들 (텍스트 오브젝트 Patch §4).
   *
   * 블록마다 한 장이고, 작업자가 옮기거나 늘린 **지금의 자리**를 그대로 쓴다.
   * 이 겹이 마지막이라 문구는 언제나 이미지·컷아웃보다 앞이다.
   */
  textObjects?: readonly { assetId: string; rect: LayoutRect }[]
  layers: CompositeLayerPlan[]
  texts: CompositeTextPlan[]
  /** 완성 결과 전체에 얹는 그레인 (§9.5). */
  grain: number
  /**
   * 이 계획을 실행하는 데 필요한 외부 이미지 생성 호출 수.
   *
   * 언제나 0이다 — 배경은 이미 손에 있고, 나머지는 원본을 그대로 얹는 일뿐이다.
   */
  externalCalls: 0
}

export interface CompositePlanInput {
  page: BriefPage
  background?: StudioBackground | undefined
  /** 맨 앞에 얹을 전경 레이어 (한방 생성 Patch 2 §4). */
  foreground?: { assetId: string } | undefined
  /** 맨 앞에 얹을 문구 오브젝트들 (텍스트 오브젝트 Patch §4). */
  textObjects?: readonly { assetId: string; rect: LayoutRect }[] | undefined
  /** 블록 id → 실제 사용 제품 이미지의 자산 id. */
  productImages: Readonly<Record<string, string>>
  /** 블록 id → 효과 세기. 없는 블록은 기본값. */
  effects: Readonly<Record<string, Partial<CompositeEffects>>>
  grain?: number
  /**
   * 이 블록들만 얹는다 (한방 생성 Patch §2).
   *
   * 원본 보존 완성 디자인에서는 AI가 이미 배경·장식·문구·일반 이미지를 그려
   * 놓았다. 그 위에 브라우저가 더할 것은 **AI에게 보내지 않은 컷아웃**뿐이다 —
   * 나머지를 다시 그리면 같은 것이 두 번 나온다.
   */
  onlyBlockIds?: readonly string[]
  /** 문구를 그릴 것인가. 완성 디자인 위에서는 AI가 이미 그렸으므로 거짓이다. */
  includeTexts?: boolean
  /**
   * 블록 id → 그 이미지를 얹을 자리 (블록 연결 Patch).
   *
   * 결과 화면에서 옮기거나 늘린 값이다. 없으면 기획서 블록의 자리를 그대로 쓴다 —
   * 기획서를 고치지 않고도 결과의 자리를 옮기기 위한 갈래다.
   */
  rectOverrides?: Readonly<Record<string, LayoutRect>>
}

const DEFAULT_PLAN_GRAIN = 0.08

/**
 * 한 페이지의 합성 계획.
 *
 * 이미지 자리에는 디자인팀이 연결한 실제 사용 제품 이미지가 우선한다. 그것이
 * 없을 때만 작성자가 붙여 둔 그림을 쓴다 — 참고 캡처밖에 없다면 결과에 참고
 * 캡처가 나가는 것이 맞다고 판단할 사람은 작업자이지 이 함수가 아니다.
 */
export function planLocalComposite(input: CompositePlanInput): CompositePlan {
  const { page } = input
  const size = { width: page.canvasWidth, height: page.canvasHeight }
  const layers: CompositeLayerPlan[] = []
  const texts: CompositeTextPlan[] = []
  const only = input.onlyBlockIds === undefined ? null : new Set(input.onlyBlockIds)
  const includeTexts = input.includeTexts !== false

  for (const block of page.blocks) {
    if (isPairedLinkUrl(page.blocks, block)) continue
    if (only !== null && !only.has(block.id)) continue
    const meta = getBlockTypeMeta(block.type)
    const rect = { ...(input.rectOverrides?.[block.id] ?? block.position) }

    if (meta.requiresAsset) {
      const assetId = input.productImages[block.id] ?? block.assetId
      if (assetId === undefined) continue
      layers.push({
        blockId: block.id,
        assetId,
        rect,
        fit: imageFitOf(block),
        crop: cropToCanvas(rect, size.width, size.height),
        effects: normalizeEffects({ ...input.effects[block.id] }),
      })
      continue
    }

    const content = block.content ?? ''
    if (!includeTexts || !meta.hasText || content.trim().length === 0) continue
    // §10: 새 텍스트 엔진을 만들지 않는다. 화면에서 쓰는 그 계산을 그대로 쓴다.
    const bare = drawsBareText(block)
    const area = bare ? {} : { padX: CARD_PADDING_X, padY: CARD_CHROME_Y }
    texts.push({
      blockId: block.id,
      content,
      rect,
      align: textAlignOf(block),
      fontSize: fitTextSize(content, rect.width, rect.height, area).fontSize,
      bare,
    })
  }

  return {
    size,
    ...(input.background === undefined ? {} : { background: input.background }),
    ...(input.foreground === undefined ? {} : { foreground: input.foreground }),
    ...(input.textObjects === undefined ? {} : { textObjects: input.textObjects }),
    layers,
    texts,
    grain: input.grain ?? DEFAULT_PLAN_GRAIN,
    externalCalls: 0,
  }
}

/** 이 계획이 필요로 하는 자산 번호 전부 — 배경과 전경까지. */
export function compositeAssetIds(plan: CompositePlan): string[] {
  const ids = plan.layers.map((l) => l.assetId)
  if (plan.background !== undefined) ids.push(plan.background.assetId)
  if (plan.foreground !== undefined) ids.push(plan.foreground.assetId)
  for (const text of plan.textObjects ?? []) ids.push(text.assetId)
  return [...new Set(ids)]
}
