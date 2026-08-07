/**
 * 문구·버튼을 **블록마다 한 장씩** (블록별 문구 Patch).
 *
 * 앞선 두 판은 모두 "한 장을 받아서 나중에 자른다"였다. 자르는 기준이 픽셀
 * 덩어리였을 때는 붙어 있는 두 문구가 하나로 묶였고, 미리 정한 칸이었을 때는
 * 모델이 그 칸을 지키지 않아 네 칸이 한꺼번에 탈락했다.
 *
 * 그래서 **자르는 일을 그만둔다.**
 *
 * 이미지와 컷아웃이 멀쩡한 이유를 그대로 가져온다 — 그림이 처음부터 따로 있고,
 * 놓을 자리는 기획서가 정한다. 문구도 같게 만든다. 모델에게는 **글자 한 덩어리만
 * 예쁘게 그려 달라**고 하고, 어디에 얼마나 크게 놓을지는 브라우저가 정한다.
 *
 * 모델이 못 하는 일(정해진 자리 지키기)을 아예 시키지 않는 것이 요점이다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import { CARD_CHROME_Y, CARD_PADDING_X, TEXT_CHROME_PX, fitTextSize, wrapLines } from './textFit'
import type { LayoutRect } from './imageLayout'
import type { TextAlign } from './simpleBlocks'

/** 이 블록이 문구인가 버튼인가. 버튼은 배경판·테두리까지 한 오브젝트다. */
export type TextLayerKind = 'text' | 'button'

/** 그 자리 **주변**의 색 — 숫자뿐이다. 그림은 이 값으로 대신 간다. */
export interface TextLayerTone {
  average: { r: number; g: number; b: number }
  /** 0=어두움, 1=밝음. */
  brightness: number
  /** 0=평평함, 1=명암 차가 큼. */
  contrast: number
}

/** 한 장을 주문할 문구·버튼 블록 하나. */
export interface TextLayerBlock {
  blockId: string
  /** 작업자가 적은 그대로. 한 글자도 바꾸지 않는다. */
  content: string
  kind: TextLayerKind
  /** 기획서 좌표의 자리. 받은 그림이 돌아갈 곳이다. */
  rect: LayoutRect
  align: TextAlign
  layer: number
  /** 이미지·컷아웃과 겹치는가. 겹치면 그 위에서도 읽혀야 한다. */
  overlapsImage: boolean
  /** 그 자리 주변의 색. 못 쟀으면 없다. */
  tone?: TextLayerTone | null
  /** 기획서 화면에서 이 문구가 실제로 끊기는 줄. 그대로 지켜 달라고 보낸다. */
  lines: readonly string[]
}

/**
 * 이 문구를 주문할 **판의 모양** (블록별 문구 2차 Patch).
 *
 * 앞선 판은 문구도 페이지와 같은 세로로 긴 판에 그리게 했다. 세로로 긴 판을
 * "가득 채우라"고 하면 가로 한 줄짜리 문구는 반드시 여러 줄로 쌓인다 — 기획서가
 * 한 줄로 잡아 둔 제목이 세 줄 로고가 되어 돌아온 것이 그 결과다.
 *
 * 그래서 판을 **블록과 같은 모양**으로 준다. 그러면 "가득 채우라"가 곧 "기획서가
 * 잡은 그 형태로 크게"라는 뜻이 된다. 모델에게 자리를 지키라고 설득하는 대신,
 * 지킬 수밖에 없는 종이를 건네는 것이다.
 *
 * 모델은 1:3~3:1 밖의 판을 받지 않으므로 그 밖은 경계로 접는다. 접히더라도 지금
 * (0.7:1 세로)보다는 언제나 기획서에 가깝다.
 */
export const TEXT_LAYER_MAX_ASPECT = 3

export function textLayerCanvas(rect: LayoutRect): { width: number; height: number } {
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const aspect = width / height
  if (aspect > TEXT_LAYER_MAX_ASPECT) return { width: TEXT_LAYER_MAX_ASPECT, height: 1 }
  if (1 / aspect > TEXT_LAYER_MAX_ASPECT) return { width: 1, height: TEXT_LAYER_MAX_ASPECT }
  return { width, height }
}

/**
 * 기획서 화면에서 이 문구가 실제로 끊기는 줄.
 *
 * 합성 계획이 문구를 그릴 때 쓰는 것과 **같은 계산**이다 (`fitTextSize` →
 * `wrapLines`). 그래야 작업자가 화면에서 본 줄바꿈과 모델에게 보내는 줄바꿈이
 * 같아진다 — 다르면 지키라고 말한 것과 화면이 어긋난다.
 */
export function planLines(content: string, rect: LayoutRect, bare: boolean): string[] {
  const trimmed = content.trim()
  if (trimmed.length === 0) return []
  const box = bare ? {} : { padX: CARD_PADDING_X, padY: CARD_CHROME_Y }
  const { fontSize } = fitTextSize(trimmed, rect.width, rect.height, box)
  const padX = bare ? TEXT_CHROME_PX : CARD_PADDING_X
  return wrapLines(trimmed, fontSize, Math.max(1, rect.width - padX))
}

/** 지면에서 이 상자가 차지하는 넓이 0..1. */
export function areaShare(rect: LayoutRect, size: { width: number; height: number }): number {
  const total = size.width * size.height
  return total <= 0 ? 0 : (rect.width * rect.height) / total
}

/** 넓은 상자부터 1위. 같은 넓이는 기획서 차례가 앞선 쪽이 앞이다. */
export function importanceRanks(
  blocks: readonly TextLayerBlock[],
  size: { width: number; height: number },
): Map<string, number> {
  const ordered = blocks
    .map((block, order) => ({ blockId: block.blockId, share: areaShare(block.rect, size), order }))
    .toSorted((a, b) => b.share - a.share || a.order - b.order)
  return new Map(ordered.map((entry, i) => [entry.blockId, i + 1]))
}

/** 두 사각형이 조금이라도 겹치는가. */
export function rectsOverlap(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * 받은 그림을 블록 상자 **안에** 앉힌다 — 비율을 지키면서, 가운데로.
 *
 * 늘려서 상자를 채우지 않는다. 글자를 늘리면 획 굵기가 가로세로로 달라져 디자인이
 * 무너지기 때문이다. 그래서 상자를 넘지 않는 가장 큰 크기로 넣고 남는 쪽을 비운다 —
 * 기획서가 정한 상자가 **넘지 말아야 할 한계**로 지켜지는 것이 이 함수의 계약이다.
 */
export function containRect(
  content: { width: number; height: number },
  box: LayoutRect,
): LayoutRect {
  if (content.width <= 0 || content.height <= 0) return { ...box }
  const scale = Math.min(box.width / content.width, box.height / content.height)
  const width = Math.max(1, Math.round(content.width * scale))
  const height = Math.max(1, Math.round(content.height * scale))
  return {
    x: Math.round(box.x + (box.width - width) / 2),
    y: Math.round(box.y + (box.height - height) / 2),
    width,
    height,
  }
}
