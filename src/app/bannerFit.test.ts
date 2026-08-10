/**
 * 기획서가 **빈 배너 캔버스**가 된다 (배너 Patch §2, 자동 배치 제거 Patch).
 *
 * 배너를 이미지로 만들면 나온 뒤에 손댈 수가 없다. 그래서 나오는 것은 또 하나의
 * **기획서 페이지**다 — 크기만 배너 규격이고, 이미 있는 편집기가 그대로 먹힌다.
 *
 * 여기 있던 자동 배치는 걷어냈다. 작업자의 말이 근거다 — "이벤트 페이지는 자동
 * 배치를 해 주지, 왜냐 크니까. 하지만 배너는 작은 것들이 많아." 그래서 이 검사가
 * 붙드는 것은 세 가지다.
 *
 *  - **아무것도 올라오지 않는가.** 조각이 하나라도 올라오면 자동 배치가 돌아온
 *    것이다.
 *  - **블록은 전부 데려오는가.** 이미지 조각은 제 블록이 페이지에 있어야 합성에
 *    실리므로, 하나라도 빠지면 그것은 서랍에서 꺼내도 안 그려진다.
 *  - **번호가 원본과 다른가.** 같으면 배너에 건 톤이 메인 이벤트 페이지까지 바꾼다.
 */

import { describe, it, expect } from 'vitest'
import { bannerBlockId, bannerPageId, blankBannerPage, sourcePageIdOf } from '../domain/bannerFit'
import { BANNER_SPECS, bannerSpecById, customBannerSpec } from '../domain/bannerSpec'
import { createBlock } from '../domain/factory'
import type { BriefBlock } from '../domain/briefSchema'
import type { BlockType } from '../domain/blockTypes'
import type { BriefPage } from '../domain/pageSchema'

const SPEC = bannerSpecById('1020x70')!

function block(type: BlockType, id: string, size?: { width: number; height: number }): BriefBlock {
  return createBlock(type, {
    id,
    content: id,
    position: { x: 10, y: 10, width: size?.width ?? 300, height: size?.height ?? 100 },
  })
}

function page(blocks: BriefBlock[]): BriefPage {
  return {
    id: 'source',
    title: '텐가 사고 선물받자',
    blocks,
    canvasWidth: 840,
    canvasHeight: 1180,
    reference: { viewMode: 'canvas', opacity: 0.35, fit: 'width', visible: false },
  }
}

const FULL = page([
  block('main_headline', 'title'),
  block('cta_button', 'cta'),
  block('main_product_image', 'hero', { width: 330, height: 470 }),
  block('gift', 'g1'),
  block('period', 'period'),
  block('logo', 'logo'),
  block('caution_text', 'caution'),
])

describe('§32-1 빈 캔버스', () => {
  it('캔버스가 규격 크기다', () => {
    const banner = blankBannerPage(FULL, SPEC)
    expect([banner.canvasWidth, banner.canvasHeight]).toEqual([SPEC.width, SPEC.height])
  })

  it('블록을 하나도 빠뜨리지 않는다', () => {
    // 이미지 조각은 제 블록이 페이지에 있어야 합성에 실린다. 자리를 얻은 것만
    // 데려오면 나머지는 서랍에서 꺼내도 그려지지 않는다 — 그 사고를 막는 검사다.
    const banner = blankBannerPage(FULL, SPEC)
    expect(banner.blocks).toHaveLength(FULL.blocks.length)
  })

  it('주의 문구까지 데려온다', () => {
    // 무엇을 배너에 넣을지는 사람이 정한다. 종류로 미리 거르지 않는다.
    const banner = blankBannerPage(FULL, SPEC)
    expect(banner.blocks.some((b) => b.id.endsWith('__caution'))).toBe(true)
  })

  it('블록이 원본과 다른 번호를 받는다', () => {
    // 같은 번호를 쓰면 배너 조각 하나에 건 톤이 메인 이벤트 페이지까지 바꾼다.
    const banner = blankBannerPage(FULL, SPEC)
    for (const b of banner.blocks) expect(b.id.startsWith(banner.id)).toBe(true)
    expect(banner.blocks.some((b) => b.id === 'title')).toBe(false)
  })

  it('원본 페이지를 건드리지 않는다', () => {
    const before = JSON.stringify(FULL)
    blankBannerPage(FULL, SPEC)
    expect(JSON.stringify(FULL)).toBe(before)
  })

  it('블록 자리가 배너 캔버스 안으로 들어온다', () => {
    // 840×1180 좌표를 그대로 두면 70px 캔버스 바깥 저 멀리에 눕는다.
    const banner = blankBannerPage(FULL, SPEC)
    for (const b of banner.blocks) {
      expect(b.position.x).toBeGreaterThanOrEqual(0)
      expect(b.position.y).toBeGreaterThanOrEqual(0)
      expect(b.position.x + b.position.width).toBeLessThanOrEqual(SPEC.width)
      expect(b.position.y + b.position.height).toBeLessThanOrEqual(SPEC.height)
    }
  })

  it('같은 규격을 다시 뽑으면 같은 페이지 번호다', () => {
    // 무작위 번호를 주면 작업이 기억하는 번호와 달라져 서로를 못 찾는다.
    expect(blankBannerPage(FULL, SPEC).id).toBe(blankBannerPage(FULL, SPEC).id)
    expect(blankBannerPage(FULL, SPEC).id).toBe(bannerPageId(FULL.id, SPEC.id))
  })
})

describe('§32-2 번호', () => {
  it('배너 번호에서 원본 페이지를 되찾는다', () => {
    expect(sourcePageIdOf(bannerPageId('page_abc', SPEC.id), SPEC.id)).toBe('page_abc')
    expect(sourcePageIdOf('page_abc', SPEC.id)).toBeNull()
  })

  it('밑줄이 든 임의 크기 번호에서도 되찾는다', () => {
    // `custom_640x200`은 밑줄이 들어 있어, 마지막 밑줄에서 자르면 원본이 잘린다.
    const spec = customBannerSpec(640, 200)!
    expect(sourcePageIdOf(bannerPageId('page_abc', spec.id), spec.id)).toBe('page_abc')
  })

  it('블록 번호에 페이지 번호가 앞선다', () => {
    expect(bannerBlockId('banner_p_1020x70', 'blk')).toBe('banner_p_1020x70__blk')
  })
})

describe('§32-3 프리셋', () => {
  it('작업자가 적어 준 다섯 크기가 전부 있다', () => {
    const sizes = BANNER_SPECS.map((s) => `${String(s.width)}x${String(s.height)}`)
    expect(sizes).toEqual(['178x90', '840x640', '1020x70', '800x250', '602x70'])
  })

  it('형제 크기도 그대로 적혀 있다', () => {
    // "하나 작업하고 사이즈만 바꿔서 저장한 후 그냥 쓰던가 아주 살짝만 수정해서"
    // 쓰는 것들이다. 따로 뽑지 않고 알려만 준다.
    const siblingOf = (id: string) =>
      BANNER_SPECS.find((s) => s.id === id)!.siblings.map((x) => `${String(x.width)}x${String(x.height)}`)
    expect(siblingOf('178x90')).toEqual(['250x135'])
    expect(siblingOf('840x640')).toEqual(['500x387'])
    expect(siblingOf('1020x70')).toEqual(['840x78'])
    expect(siblingOf('800x250')).toEqual(['700x153'])
    expect(siblingOf('602x70')).toEqual([])
  })
})
