/**
 * 완성본의 조각을 배너 자리에 다시 놓는다 (배너 Patch §3).
 *
 * 배너는 새로 그리는 것이 아니라 **다시 놓는 것**이다. 그래서 모델을 한 번도
 * 부르지 않는다 — 제목 조각도 버튼 조각도 상품 사진도 완성본을 만들 때 이미
 * 만들어 두었고, 저장 파일에 그대로 들어 있다.
 *
 * 저장 파일이 무엇을 담고 있는지가 이 모듈이 성립하는 근거다. `.eventbrief` 에는
 * 합쳐진 완성본 그림이 **들어 있지 않다.** 대신 배경·블록별 문구 조각·이미지
 * 조각·제품 이미지·효과·톤이 들어 있고, `완성본 다시 합치기`가 그것들로 다시
 * 그린다. 배너도 같은 조각을 다른 자리에 놓는 일이므로, 파일 하나만 있으면
 * 크레딧 없이 몇 번이든 다시 뽑을 수 있다.
 *
 * 합성 계획은 새로 만들지 않고 `planLocalComposite`을 그대로 지난다. 배너 페이지의
 * 캔버스 크기가 규격이고 블록의 자리가 이미 배너 좌표이므로, 그 함수가 아는 일이
 * 달라질 것이 없다.
 *
 * ## 조각이 없는 블록
 *
 * 자리를 얻었는데 그릴 그림이 없는 경우가 있다 — 문구 조각이 생기기 전에 저장한
 * 파일이거나, 이미지 블록에 연결된 그림이 없거나. 그때 **아무 말 없이 빈 자리로
 * 두지 않는다.** `missingPieces`로 이름을 돌려주고, 화면이 그것을 말한다. 제목이
 * 없는 배너가 조용히 나가는 것이 이 기능에서 가장 나쁜 결말이다.
 *
 * 순수 모듈이다. 캔버스도 저장소도 모른다.
 */

import { buildBannerPage, type BannerFit } from './bannerFit'
import type { BannerSpec } from './bannerSpec'
import { planLocalComposite, type CompositePlan } from './composite'
import type { CompositeEffects } from './compositeEffects'
import type { LayoutRect } from './imageLayout'
import type { BriefPage } from './pageSchema'
import type { StudioBackground } from './studioJob'
import type { StudioTextObject } from './textObjects'
import type { ToneAdjust } from './toneAdjust'

/**
 * 배경으로 내려간 조각에 거는 톤.
 *
 * 이벤트3의 가차 기계는 얇은 띠에서 확대되어 **흐리게** 깔렸다. 흐리게 하는 길이
 * 지금 합성기에 없으므로, 밝히고 대비와 채도를 눌러 비슷한 자리에 둔다 — 글자가
 * 읽히는 것이 먼저다.
 *
 * 흐림이 아니라는 것을 적어 둔다. 실물을 보고 모자라면 그때 흐림을 만든다.
 */
export const DEMOTED_TONE: ToneAdjust = { brightness: 0.35, contrast: -0.45, saturation: -0.35, temperature: 0 }

/** 완성본이 남긴 조각들. 저장 파일에서 그대로 나온다. */
export interface BannerPieces {
  background?: StudioBackground | undefined
  /** 페이지의 문구 조각. `blockId`로 찾는다. */
  textObjects?: readonly StudioTextObject[] | undefined
  /** 페이지의 이미지 조각. */
  imageObjects?: readonly StudioTextObject[] | undefined
  productImages: Readonly<Record<string, string>>
  effects: Readonly<Record<string, Partial<CompositeEffects>>>
  objectTones?: Readonly<Record<string, ToneAdjust>> | undefined
  grain?: number | undefined
  tone?: ToneAdjust | undefined
}

export interface BannerBuild {
  /** 배너 규격의 기획서 페이지. 편집기가 그대로 열 수 있다. */
  page: BriefPage
  fit: BannerFit
  plan: CompositePlan
  /**
   * 자리를 얻었지만 **그릴 그림이 없는** 블록.
   *
   * 비어 있지 않으면 그 배너에는 구멍이 있다. 대개 문구 조각이 생기기 전에 저장한
   * 파일이다.
   */
  missingPieces: readonly string[]
}

export interface BuildBannerOptions {
  /** 배경에서 잘라 쓸 자리. `quietRegion`이 고른다. 없으면 가운데를 쓴다. */
  backgroundCrop?: LayoutRect | undefined
}

export function buildBanner(
  source: BriefPage,
  spec: BannerSpec,
  pieces: BannerPieces,
  options: BuildBannerOptions = {},
): BannerBuild {
  const { page, fit } = buildBannerPage(source, spec)

  const textPieces = new Map((pieces.textObjects ?? []).map((piece) => [piece.blockId, piece]))
  const imagePieces = new Map((pieces.imageObjects ?? []).map((piece) => [piece.blockId, piece]))

  // 문구 조각은 **배너 자리**로 옮겨 얹는다. 그림 자체는 그대로다 — 조각을 다시
  // 만들지 않는 것이 이 기능의 값어치다.
  const textObjects = fit.placements.flatMap((placement) => {
    const piece = textPieces.get(placement.blockId)
    if (piece === undefined) return []
    return [
      {
        assetId: piece.assetId,
        rect: placement.rect,
        order: piece.layer,
        ...(pieces.objectTones?.[placement.blockId] === undefined
          ? {}
          : { tone: pieces.objectTones[placement.blockId]! }),
      },
    ]
  })

  // 이미지 블록은 결과 화면에서 고른 그림이 우선한다. 그것이 곧 완성본에 실제로
  // 그려진 그림이라, 배너만 다른 그림을 쓰면 두 장이 달라 보인다.
  const productImages: Record<string, string> = { ...pieces.productImages }
  for (const [blockId, piece] of imagePieces) productImages[blockId] = piece.assetId

  // 배경으로 내려간 것은 눌러서 깐다.
  const objectTones: Record<string, ToneAdjust> = { ...pieces.objectTones }
  for (const blockId of fit.background) objectTones[blockId] = DEMOTED_TONE

  const plan = planLocalComposite({
    page,
    background: pieces.background,
    backgroundCrop: options.backgroundCrop,
    textObjects,
    productImages,
    effects: pieces.effects,
    objectTones,
    ...(pieces.grain === undefined ? {} : { grain: pieces.grain }),
    ...(pieces.tone === undefined ? {} : { tone: pieces.tone }),
    // 글자는 조각이 그린다. 여기서 또 그리면 같은 문구가 두 번 나온다.
    includeTexts: false,
  })

  // 자리는 얻었는데 문구 조각도 없고 그려진 그림 겹도 없으면, 그 자리는 빈 자리다.
  const drawn = new Set(plan.layers.map((layer) => layer.blockId))
  const missingPieces = fit.placements
    .filter((placement) => !textPieces.has(placement.blockId) && !drawn.has(placement.blockId))
    .map((placement) => placement.blockId)

  return { page, fit, plan, missingPieces }
}

/**
 * 배너 배경으로 잘라 쓸 자리를 고를 때 글자가 놓일 곳.
 *
 * 규격의 자리를 그대로 `quietRegion`의 슬롯으로 옮긴 것이다. 자리는 이미 0~1
 * 비율이라 옮길 것이 없다 — 그러라고 비율로 적었다.
 */
export function readableSlots(spec: BannerSpec): { x: number; y: number; width: number; height: number }[] {
  return spec.slots.map((slot) => ({ ...slot.area }))
}
