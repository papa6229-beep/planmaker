/**
 * 꾸며진 텍스트를 블록별 오브젝트로 (텍스트 오브젝트 Patch §1).
 *
 * 모델은 페이지 한 장에 모든 문구를 한꺼번에 그려 준다. 그 한 장을 결과에 바로
 * 합쳐 버리면 나중에 문구 하나만 옮기거나 하나만 다시 디자인할 방법이 없다 —
 * 픽셀이 이미 배경과 섞여 버리기 때문이다.
 *
 * 그래서 합치기 전에 **블록마다 한 장씩** 잘라 둔다.
 *
 * 편집 단위의 정체성은 **`blockId`**다. 픽셀 덩어리가 아니다.
 *
 * 앞선 판은 이어진 픽셀 덩어리를 세어 가장 가까운 블록에게 통째로 주었다. 그
 * 규칙에서는 세 가지가 반드시 깨진다.
 *
 *  - 글자끼리 획이 닿거나 그림자가 겹치면 두 문구가 **한 덩어리**가 되어 하나로
 *    묶인다.
 *  - 한 문구의 낱글자는 서로 떨어진 여러 덩어리라, 그중 일부가 옆 블록에게
 *    표를 주면 문구가 **쪼개진다**.
 *  - 모델이 그린 별·꽃 같은 장식도 덩어리라, 가장 가까운 문구가 **가져간다**.
 *
 * 그래서 덩어리를 세지 않는다. 픽셀마다 **어느 블록 상자에 속하는가**만 본다.
 * 상자에서 여백(`TEXT_CLAIM_MARGIN`)까지가 그 블록의 몫이고, 어느 상자에서도
 * 그만큼 떨어진 픽셀은 임자가 없다 — 장식이 딸려 오지 않는 이유다. 겹치는
 * 자리는 더 가까운 상자가 가져가므로 두 문구가 서로의 픽셀을 나눠 갖지 않는다.
 *
 * 순수 모듈이다. 캔버스도 DOM도 모른다.
 */

import type { LayoutRect } from './imageLayout'

/** 생성된 문구 한 덩어리 — 기획서의 텍스트 블록 하나에 대응한다. */
export interface StudioTextObject {
  /** 어느 텍스트 블록에서 나온 것인가. */
  blockId: string
  /** 꾸며진 문구 그림. 옮기고 크기를 바꿔도 이 그림은 그대로다. */
  assetId: string
  /** 페이지 좌표. 작업자가 옮기고 늘리면 이 값만 바뀐다. */
  rect: LayoutRect
  /** 앞뒤 순서. 문구끼리의 차례일 뿐, 문구는 언제나 이미지보다 앞이다. */
  layer: number
}

/** 자를 근거가 되는 기획서 블록. */
export interface TextSourceBlock {
  blockId: string
  /** 기획서 좌표의 문구 상자. */
  rect: LayoutRect
  layer: number
}

/** 잘라 낼 조각 하나 — **그림 픽셀 좌표**의 사각형이다. */
export interface TextSlice {
  blockId: string
  layer: number
  box: { x: number; y: number; width: number; height: number }
}

export interface SplitResult {
  /**
   * 픽셀마다의 임자 — 블록 차례, 비어 있으면 `-1`.
   *
   * 자르는 쪽이 이 값으로 "이 픽셀은 내 것인가"를 물어본다. 사각형만 주면 겹치는
   * 두 문구가 서로의 픽셀을 가져간다.
   */
  owner: Int32Array
  slices: TextSlice[]
}

export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 이 알파 아래는 없는 픽셀이다 (`photoBox`·`chromaKey`와 같은 기준). */
export const TEXT_ALPHA_FLOOR = 8

/**
 * 문구 상자 밖으로 이만큼까지가 그 문구의 몫이다 — 상자 짧은 변에 대한 비율.
 *
 * 외곽선·그림자·라벨은 글자 상자를 조금 넘어간다. 그만큼은 품고, 그보다 멀리
 * 있는 것은 이 문구의 것이 아니다.
 */
export const TEXT_CLAIM_MARGIN = 0.12

/** 점에서 사각형까지의 거리. 안에 있으면 0. */
function distanceToRect(x: number, y: number, rect: LayoutRect): number {
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.width ? x - (rect.x + rect.width) : 0
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.height ? y - (rect.y + rect.height) : 0
  return Math.hypot(dx, dy)
}

/**
 * 문구 레이어를 블록별로 가른다.
 *
 * 결과의 조각 수는 **언제나 블록 수와 같다.** 픽셀이 하나도 없는 블록도 자기
 * 상자를 그대로 가진다 — 그래야 화면의 편집 오브젝트와 기획서 블록이 1:1이다.
 *
 * `scale`은 그림 픽셀을 기획서 좌표로 옮기는 비율이다 — 모델이 준 그림은 16의
 * 배수 규격이라 페이지 크기와 딱 맞지 않는다. 거리를 재는 자리는 기획서 좌표다.
 */
export function splitTextLayer(
  pixels: PixelBuffer,
  blocks: readonly TextSourceBlock[],
  scale: { x: number; y: number },
): SplitResult {
  const { data, width, height } = pixels
  const total = width * height
  const owner = new Int32Array(total).fill(-1)
  if (blocks.length === 0 || total === 0) return { owner, slices: [] }

  const margins = blocks.map((b) => Math.min(b.rect.width, b.rect.height) * TEXT_CLAIM_MARGIN)
  const boxes = blocks.map(() => ({ minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 }))

  for (let index = 0; index < total; index += 1) {
    if ((data[index * 4 + 3] ?? 0) <= TEXT_ALPHA_FLOOR) continue
    const x = index % width
    const y = Math.floor(index / width)
    const px = x * scale.x
    const py = y * scale.y

    // 가장 가까운 상자 하나. 그 상자의 여백을 넘어서면 임자가 없다.
    let best = -1
    let bestDistance = Infinity
    for (let b = 0; b < blocks.length; b += 1) {
      const d = distanceToRect(px, py, blocks[b]!.rect)
      if (d < bestDistance) {
        bestDistance = d
        best = b
      }
    }
    if (best < 0 || bestDistance > (margins[best] ?? 0)) continue

    owner[index] = best
    const box = boxes[best]!
    if (x < box.minX) box.minX = x
    if (y < box.minY) box.minY = y
    if (x > box.maxX) box.maxX = x
    if (y > box.maxY) box.maxY = y
  }

  // 블록마다 하나씩. 픽셀이 없으면 자기 상자를 그대로 쓴다.
  const slices: TextSlice[] = blocks.map((block, b) => {
    const box = boxes[b]!
    if (box.maxX < box.minX) {
      return {
        blockId: block.blockId,
        layer: block.layer,
        box: {
          x: Math.max(0, Math.round(block.rect.x / scale.x)),
          y: Math.max(0, Math.round(block.rect.y / scale.y)),
          width: Math.max(1, Math.round(block.rect.width / scale.x)),
          height: Math.max(1, Math.round(block.rect.height / scale.y)),
        },
      }
    }
    return {
      blockId: block.blockId,
      layer: block.layer,
      box: { x: box.minX, y: box.minY, width: box.maxX - box.minX + 1, height: box.maxY - box.minY + 1 },
    }
  })
  return { owner, slices }
}
