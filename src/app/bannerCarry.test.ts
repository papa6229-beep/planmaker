/**
 * 비슷한 크기의 배너로 작업을 옮긴다 (배너 이어받기 Patch).
 *
 * 작업자의 말이 근거다 — "유사한 비율의 사이즈의 배너들, 비율이 똑같은 게 아냐
 * 미묘하게 달라. 근데 그 비율 차이가 작아서 배치는 그대로 두고 조각들의 미세한
 * 위치나 크기 조정만 하거나 (…) 유사 사이즈 배너 하나를 작업했다면 다른 사이즈
 * 배너 작업창을 불러왔을 때 그 내용이 남아 있으면 좋겠다."
 *
 * 여기서 붙드는 것은 셋이다. **어느 배너에서 가져오는가**(비율이 가장 가까운 것),
 * **자리와 크기를 어떻게 옮기는가**(눌리지 않게), **번호가 갈아입는가**(이쪽 배너에
 * 건 톤이 저쪽까지 바꾸지 않게).
 */

import { describe, it, expect } from 'vitest'
import { carryBannerWork, closestBanner } from '../domain/bannerCarry'
import { bannerBlockId, bannerPageId } from '../domain/bannerFit'
import type { StudioTextObject } from '../domain/textObjects'

const A = bannerPageId('page_1', '840x640')
const B = bannerPageId('page_1', 'custom_500x387')

const piece = (blockId: string, rect: { x: number; y: number; width: number; height: number }): StudioTextObject => ({
  blockId,
  assetId: `asset-${blockId}`,
  rect,
  layer: 3,
})

describe('§37-1 어느 배너에서 가져오는가', () => {
  const worked = [
    { pageId: 'thin', size: { width: 1020, height: 70 }, pieceCount: 3 },
    { pageId: 'square', size: { width: 840, height: 640 }, pieceCount: 4 },
    { pageId: 'wide', size: { width: 800, height: 250 }, pieceCount: 2 },
  ]

  it('비율이 가장 가까운 것을 고른다', () => {
    // 500×387은 840×640과 거의 같은 비율이다.
    expect(closestBanner(worked, { width: 500, height: 387 })?.pageId).toBe('square')
    // 840×78은 1020×70과 같은 계열의 띠다.
    expect(closestBanner(worked, { width: 840, height: 78 })?.pageId).toBe('thin')
    expect(closestBanner(worked, { width: 700, height: 153 })?.pageId).toBe('wide')
  })

  it('빈 배너에서는 가져오지 않는다', () => {
    // 옮겨 올 것이 없는데 고르면, 비율이 더 먼 진짜 작업물을 놓친다.
    const empty = worked.map((w) => ({ ...w, pieceCount: 0 }))
    expect(closestBanner(empty, { width: 500, height: 387 })).toBeNull()
    expect(closestBanner([], { width: 500, height: 387 })).toBeNull()
  })
})

describe('§37-2 자리와 크기를 옮긴다', () => {
  const from = { width: 840, height: 640 }
  const to = { width: 500, height: 387 }
  const carried = carryBannerWork(
    A,
    B,
    from,
    to,
    [piece(bannerBlockId(A, 'blk_title'), { x: 400, y: 100, width: 200, height: 60 })],
    [piece(bannerBlockId(A, 'blk_prod'), { x: 0, y: 320, width: 300, height: 300 })],
  )

  it('조각 수가 그대로다', () => {
    expect(carried.texts).toHaveLength(1)
    expect(carried.images).toHaveLength(1)
  })

  it('자리는 가로세로 각각의 비율로 옮긴다', () => {
    // 한 비율로 옮기면 오른쪽 끝에 붙여 둔 것이 가운데로 들어온다.
    const t = carried.texts[0]!
    expect(t.rect.x).toBe(Math.round(400 * (500 / 840)))
    expect(t.rect.y).toBe(Math.round(100 * (387 / 640)))
  })

  it('크기는 한 비율로만 옮긴다 — 눌리지 않게', () => {
    // 가로세로를 따로 옮기면 이미 만들어 둔 글자 그림이 찌그러진다.
    const t = carried.texts[0]!
    expect(t.rect.width / t.rect.height).toBeCloseTo(200 / 60, 1)
  })

  it('그림은 그대로 쓴다 — 다시 만들지 않는다', () => {
    // 자산 번호가 바뀌면 그것은 옮긴 것이 아니라 다시 그린 것이고, 돈이 든다.
    expect(carried.texts[0]!.assetId).toBe(`asset-${bannerBlockId(A, 'blk_title')}`)
  })

  it('번호가 새 배너의 것으로 갈아입는다', () => {
    // 같은 번호를 쓰면 이쪽 배너에 건 톤이 저쪽 배너까지 바꾼다.
    expect(carried.texts[0]!.blockId).toBe(bannerBlockId(B, 'blk_title'))
    expect(carried.images[0]!.blockId).toBe(bannerBlockId(B, 'blk_prod'))
  })

  it('설정을 물려받을 짝을 함께 내놓는다', () => {
    // 컷아웃 두께도 톤도 함께 가야 한다. 옮긴 배너에서 다시 켜야 한다면 그건
    // 옮긴 것이 아니다.
    expect(carried.settingsFrom).toContainEqual({
      from: bannerBlockId(A, 'blk_prod'),
      to: bannerBlockId(B, 'blk_prod'),
    })
  })
})

describe('§37-3 복제한 조각', () => {
  it('복제 꼬리를 그대로 달고 간다', () => {
    // 두 벌이던 것이 새 크기에서 한 벌로 합쳐지면, 사람이 지운 적 없는 것이 사라진다.
    const id = bannerBlockId(A, 'blk_title')
    const carried = carryBannerWork(
      A,
      B,
      { width: 840, height: 640 },
      { width: 500, height: 387 },
      [piece(id, { x: 0, y: 0, width: 10, height: 10 }), piece(`${id}#2`, { x: 20, y: 20, width: 10, height: 10 })],
      [],
    )
    expect(carried.texts.map((t) => t.blockId)).toEqual([
      bannerBlockId(B, 'blk_title'),
      `${bannerBlockId(B, 'blk_title')}#2`,
    ])
  })

  it('남의 배너 조각은 옮기지 않는다', () => {
    const carried = carryBannerWork(
      A,
      B,
      { width: 840, height: 640 },
      { width: 500, height: 387 },
      [piece('남의페이지__blk_title', { x: 0, y: 0, width: 10, height: 10 })],
      [],
    )
    expect(carried.texts).toEqual([])
  })
})
