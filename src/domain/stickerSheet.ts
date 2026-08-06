/**
 * 문구·버튼 스티커판 (스티커판 Patch §4, §5).
 *
 * 앞선 판은 문구를 한 장에 그리게 한 뒤 **픽셀을 보고** 블록별로 갈랐다. 이어진
 * 획은 두 문구를 하나로 만들고, 떨어진 낱글자는 한 문구를 여럿으로 만든다. 픽셀
 * 모양은 블록의 이름을 알지 못하므로, 어떤 규칙을 얹어도 추측이다.
 *
 * 그래서 자르는 자리를 **먼저 정한다.**
 *
 * 판을 블록 수만큼의 칸으로 나누고, 칸 하나에 블록 하나를 지정해 주문한다.
 * 돌아온 그림은 그 **미리 정한 좌표로만** 잘린다 — 픽셀을 보고 나누는 자리가
 * 아예 없다. 칸 번호가 곧 `blockId`이므로 합쳐질 수도, 쪼개질 수도 없다.
 *
 * 칸 안쪽의 잘라 낼 상자(`crop`)는 그 블록과 **같은 가로세로비**다. 그래야 잘라
 * 낸 그림을 기획서의 원래 자리에 그대로 앉혀도 글자가 눌리거나 늘어나지 않는다.
 * 상자와 칸 사이의 띠는 완충 지대이고, 거기에 잉크가 묻으면 모델이 자기 칸을
 * 넘어섰다는 뜻이다.
 *
 * 좌표는 전부 **판 전체에 대한 비율(0..1)** 이다. 모델이 주는 그림의 실제 픽셀
 * 크기는 요청 규격과 다를 수 있어서, 비율로 적어 두면 받은 그대로에 곱하면 된다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { LayoutRect } from './imageLayout'
import type { TextAlign } from './simpleBlocks'

/** 이 블록이 문구인가 버튼인가. 버튼은 배경판·테두리까지 한 오브젝트다. */
export type StickerKind = 'text' | 'button'

/** 그 자리 **주변**의 색 — 숫자뿐이다. 그림은 이 값으로 대신 간다. */
export interface StickerRegionTone {
  average: { r: number; g: number; b: number }
  /** 0=어두움, 1=밝음. */
  brightness: number
  /** 0=평평함, 1=명암 차가 큼. */
  contrast: number
}

/** 스티커판에 주문할 블록 하나. */
export interface StickerBlock {
  blockId: string
  /** 작업자가 적은 그대로. 한 글자도 바꾸지 않는다. */
  content: string
  kind: StickerKind
  /** 기획서 좌표의 자리. 잘라 낸 그림이 돌아갈 곳이기도 하다. */
  rect: LayoutRect
  align: TextAlign
  layer: number
  /** 이미지·컷아웃과 겹치는가. 겹치면 그 위에서도 읽혀야 한다. */
  overlapsImage: boolean
  /** 그 자리 주변의 색. 못 쟀으면 없다. */
  tone?: StickerRegionTone | null
}

/**
 * 스티커판 위의 한 칸.
 *
 * `cell`은 이 블록에게 준 자리 전부, `crop`은 실제로 잘라 낼 안쪽 상자다. 둘
 * 사이의 띠가 완충 지대다.
 */
export interface StickerCell {
  /** 1부터. 프롬프트가 부르는 이름이 이 번호다. */
  index: number
  blockId: string
  cell: LayoutRect
  crop: LayoutRect
}

/**
 * 칸 가장자리에 남기는 완충 띠 — 칸 짧은 변에 대한 비율.
 *
 * 이 띠가 없으면 옆 칸의 글자와 이 칸의 글자가 맞닿아, 잘라 낸 그림에 남의
 * 획 끝이 딸려 온다.
 */
export const STICKER_GUARD = 0.06

/**
 * 완충 띠에 이만큼 넘게 잉크가 묻으면 침범으로 본다.
 *
 * 0으로 두면 글자 가장자리의 안티에일리어싱 한 줄에도 걸린다. 3%는 "한두 획이
 * 스친 것"과 "옆 칸까지 그려 버린 것"을 가르는 자리다.
 */
export const STICKER_SPILL_LIMIT = 0.03

/** 한 칸에 실제로 묻은 잉크의 양. */
export interface CellInk {
  index: number
  blockId: string
  /** 완충 띠에서 불투명한 픽셀의 비율 0..1. */
  guardRatio: number
}

/**
 * 블록 목록을 칸으로 나눈다. 차례는 **기획서 차례 그대로**다.
 *
 * 넷까지는 가로로 긴 한 줄씩 쌓는다 — 문구는 대개 가로로 길고, 세로로 쪼갠 칸에
 * 넣으면 글자가 작아진다. 다섯부터는 줄이 넷을 넘지 않게 열을 늘린다.
 */
export function planStickerCells(
  blocks: readonly StickerBlock[],
  sheet: { width: number; height: number },
): StickerCell[] {
  const count = blocks.length
  if (count === 0 || sheet.width <= 0 || sheet.height <= 0) return []

  const cols = count <= 4 ? 1 : Math.ceil(count / 4)
  const rows = Math.ceil(count / cols)
  const cellW = 1 / cols
  const cellH = 1 / rows
  const pxW = sheet.width * cellW
  const pxH = sheet.height * cellH
  const guard = STICKER_GUARD * Math.min(pxW, pxH)
  const safeW = Math.max(1, pxW - guard * 2)
  const safeH = Math.max(1, pxH - guard * 2)

  return blocks.map((block, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    // 블록과 같은 가로세로비로, 안전 영역 안에 들어가는 가장 큰 상자.
    const aspect = block.rect.height <= 0 ? 1 : block.rect.width / block.rect.height
    let cropW = safeW
    let cropH = safeW / aspect
    if (cropH > safeH) {
      cropH = safeH
      cropW = safeH * aspect
    }
    return {
      index: i + 1,
      blockId: block.blockId,
      cell: { x: col * cellW, y: row * cellH, width: cellW, height: cellH },
      crop: {
        x: (col * pxW + (pxW - cropW) / 2) / sheet.width,
        y: (row * pxH + (pxH - cropH) / 2) / sheet.height,
        width: cropW / sheet.width,
        height: cropH / sheet.height,
      },
    }
  })
}

/**
 * 자기 칸을 넘어선 칸들.
 *
 * 하나라도 나오면 부르는 쪽은 **결과를 얹지 않고 멈춘다.** 다시 부르지도, 픽셀을
 * 보고 다시 나누지도 않는다 — 그 두 길이 지금 고치고 있는 결함이다.
 */
export function spilledCells(
  inks: readonly CellInk[],
  limit: number = STICKER_SPILL_LIMIT,
): CellInk[] {
  return inks.filter((ink) => ink.guardRatio > limit)
}

/** 지면에서 이 상자가 차지하는 넓이 0..1. */
export function areaShare(rect: LayoutRect, size: { width: number; height: number }): number {
  const total = size.width * size.height
  return total <= 0 ? 0 : (rect.width * rect.height) / total
}

/** 넓은 상자부터 1위. 같은 넓이는 기획서 차례가 앞선 쪽이 앞이다. */
export function importanceRanks(
  blocks: readonly StickerBlock[],
  size: { width: number; height: number },
): Map<string, number> {
  const ordered = blocks
    .map((block, order) => ({ blockId: block.blockId, share: areaShare(block.rect, size), order }))
    .toSorted((a, b) => (b.share - a.share) || (a.order - b.order))
  return new Map(ordered.map((entry, i) => [entry.blockId, i + 1]))
}

/** 두 사각형이 조금이라도 겹치는가. */
export function rectsOverlap(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
