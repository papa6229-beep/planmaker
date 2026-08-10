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
import {
  bannerBlockId,
  bannerCopyNo,
  bannerPageId,
  blankBannerPage,
  sourceBlockIdOf,
  sourcePageIdOf,
} from '../domain/bannerFit'
import { bannerEditTargets, type EditTarget } from '../domain/editTargets'
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

/**
 * 배너 조각의 부분수정 목록 (배너 부분수정 Patch).
 *
 * 작업자의 말이 근거다 — "이벤트 이미지에서는 3줄이었던 문구가 배너에서는 2줄,
 * 1줄이 될 수도 있는데 수정 방법이 없잖아. 또 그렇게 수정했다고 하더라도 원본
 * 이미지나 다른 조각에 영향은 없어야겠지."
 *
 * 마지막 문장이 이 목록의 모양을 정한다. 조각 하나만 다시 그리는 길로 가려면
 * 목록에 **문구 조각만** 있어야 한다 — 이미지나 배경이 섞이면 한 장을 통째로 다시
 * 그리는 길로 넘어가고, 그러면 애써 놓은 조각이 전부 사라진다.
 */
describe('§32-4 배너 조각의 부분수정 목록', () => {
  const BANNER_ID = bannerPageId('page_1', '1020x70')
  const banner = { ...blankBannerPage(FULL, SPEC), id: BANNER_ID }
  const source: EditTarget[] = [
    { targetId: 'title', blockId: 'title', kind: 'text', label: '문구 1 — 텐가 사고', content: '텐가 사고', pageId: 'page_1' },
    { targetId: 'hero', blockId: 'hero', kind: 'image', label: '이미지 1', pageId: 'page_1' },
    { targetId: 'background', kind: 'background', label: '전체 배경', pageId: 'page_1' },
  ]
  const rect = (y: number) => ({ x: 10, y, width: 100, height: 20 })
  const at = (blockId: string, y: number) => ({ blockId, assetId: 'a', rect: rect(y) })
  const build = (texts: { blockId: string; assetId: string; rect: ReturnType<typeof rect> }[]) =>
    bannerEditTargets(banner, texts, source, (id) => sourceBlockIdOf(BANNER_ID, id), bannerCopyNo)

  it('올린 조각만 목록에 선다', () => {
    // 얼려 두면 방금 서랍에서 꺼낸 조각을 고칠 수가 없다.
    expect(build([])).toEqual([])
    expect(build([at(bannerBlockId(BANNER_ID, 'title'), 10)])).toHaveLength(1)
  })

  it('이름과 문구 원문은 원본의 것을 그대로 쓴다', () => {
    // 배너의 `문구 1`이 이벤트 페이지의 `문구 1`과 같은 것을 가리켜야, "이벤트에서
    // 3줄이던 그것"이 통한다. 그리고 다시 그릴 글자가 그 원문이다.
    const [target] = build([at(bannerBlockId(BANNER_ID, 'title'), 10)])
    expect(target!.label).toBe('문구 1 — 텐가 사고')
    expect(target!.content).toBe('텐가 사고')
  })

  it('대상 번호는 배너 조각의 번호다', () => {
    // 이 번호로 그 조각 하나의 그림만 갈아 끼운다. 원본 번호를 쓰면 이벤트
    // 페이지의 조각이 바뀐다.
    const id = bannerBlockId(BANNER_ID, 'title')
    expect(build([at(id, 10)])[0]!.targetId).toBe(id)
    expect(build([at(id, 10)])[0]!.pageId).toBe(BANNER_ID)
  })

  it('복제한 조각은 따로 선다', () => {
    const id = bannerBlockId(BANNER_ID, 'title')
    const list = build([at(id, 10), at(`${id}#2`, 30)])
    expect(list).toHaveLength(2)
    expect(list[1]!.label).toContain('복제 2')
  })

  it('위에서 아래로 센다', () => {
    const id = bannerBlockId(BANNER_ID, 'title')
    const list = build([at(`${id}#2`, 40), at(id, 5)])
    expect(list.map((t) => t.targetId)).toEqual([id, `${id}#2`])
  })

  it('원본에 없는 조각은 담지 않는다', () => {
    // 이름도 문구 원문도 없는 것을 고칠 수는 없다.
    expect(build([at(bannerBlockId(BANNER_ID, '없는것'), 10)])).toEqual([])
    expect(build([at('남의페이지__title', 10)])).toEqual([])
  })
})
