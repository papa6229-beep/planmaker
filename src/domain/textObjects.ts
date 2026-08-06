/**
 * 꾸며진 텍스트를 블록별 오브젝트로 (텍스트 오브젝트 Patch §1).
 *
 * 모델은 페이지 한 장에 모든 문구를 한꺼번에 그려 준다. 그 한 장을 결과에 바로
 * 합쳐 버리면 나중에 문구 하나만 옮기거나 하나만 다시 디자인할 방법이 없다 —
 * 픽셀이 이미 배경과 섞여 버리기 때문이다.
 *
 * 그래서 합치기 전에 **블록마다 한 장씩** 잘라 둔다. 자르는 규칙은 두 가지다.
 *
 *  - **덩어리는 쪼개지 않는다.** 글자와 그 외곽선·그림자·라벨은 서로 붙어 있는
 *    한 덩어리다. 사각형으로 자르면 그림자만 잘려 나가므로, 이어진 픽셀을 통째로
 *    한 임자에게 준다.
 *  - **임자는 가장 가까운 블록이다.** 덩어리의 픽셀들이 저마다 어느 블록 상자에
 *    가까운지 세어, 표를 많이 받은 블록이 그 덩어리를 가져간다. 그래서 옆 문구의
 *    픽셀이 딸려 오지 않는다.
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

/** 점에서 사각형까지의 거리 제곱. 안에 있으면 0. */
function distanceToRect(x: number, y: number, rect: LayoutRect): number {
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.width ? x - (rect.x + rect.width) : 0
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.height ? y - (rect.y + rect.height) : 0
  return dx * dx + dy * dy
}

/**
 * 문구 레이어를 블록별로 가른다.
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

  const opaque = (index: number) => (data[index * 4 + 3] ?? 0) > TEXT_ALPHA_FLOOR

  // ── 1) 이어진 덩어리마다 번호를 붙인다 ──────────────────────────────────
  const component = new Int32Array(total).fill(-1)
  const members: number[][] = []
  const stack: number[] = []
  for (let seed = 0; seed < total; seed += 1) {
    if (component[seed] !== -1 || !opaque(seed)) continue
    const id = members.length
    const group: number[] = []
    stack.push(seed)
    component[seed] = id
    while (stack.length > 0) {
      const index = stack.pop()!
      group.push(index)
      const x = index % width
      const push = (next: number, ok: boolean) => {
        if (!ok || next < 0 || next >= total || component[next] !== -1 || !opaque(next)) return
        component[next] = id
        stack.push(next)
      }
      push(index - 1, x > 0)
      push(index + 1, x < width - 1)
      push(index - width, true)
      push(index + width, true)
    }
    members.push(group)
  }

  // ── 2) 덩어리마다 표를 세어 임자를 정한다 ───────────────────────────────
  const boxes = blocks.map(() => ({ minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 }))
  for (const group of members) {
    const votes: number[] = Array.from({ length: blocks.length }, () => 0)
    for (const index of group) {
      const px = (index % width) * scale.x
      const py = Math.floor(index / width) * scale.y
      let best = 0
      let bestDistance = Infinity
      for (let b = 0; b < blocks.length; b += 1) {
        const d = distanceToRect(px, py, blocks[b]!.rect)
        if (d < bestDistance) {
          bestDistance = d
          best = b
        }
      }
      votes[best] = (votes[best] ?? 0) + 1
    }
    let winner = 0
    for (let b = 1; b < blocks.length; b += 1) {
      if ((votes[b] ?? 0) > (votes[winner] ?? 0)) winner = b
    }
    const box = boxes[winner]!
    for (const index of group) {
      owner[index] = winner
      const x = index % width
      const y = Math.floor(index / width)
      if (x < box.minX) box.minX = x
      if (y < box.minY) box.minY = y
      if (x > box.maxX) box.maxX = x
      if (y > box.maxY) box.maxY = y
    }
  }

  // ── 3) 픽셀이 하나도 없는 블록은 오브젝트를 만들지 않는다 ───────────────
  const slices: TextSlice[] = []
  for (let b = 0; b < blocks.length; b += 1) {
    const box = boxes[b]!
    if (box.maxX < box.minX) continue
    slices.push({
      blockId: blocks[b]!.blockId,
      layer: blocks[b]!.layer,
      box: { x: box.minX, y: box.minY, width: box.maxX - box.minX + 1, height: box.maxY - box.minY + 1 },
    })
  }
  return { owner, slices }
}
