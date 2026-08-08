/**
 * 기획서가 배너 기획서가 된다 (배너 Patch §2).
 *
 * 배너를 이미지로 만들면 나온 뒤에 손댈 수가 없다. 그래서 나오는 것은 또 하나의
 * **기획서 페이지**다 — 크기만 배너 규격이고 안에 든 것은 같은 블록이다. 그러면
 * 이미 있는 편집기가 그대로 먹히고, 조각도 다시 만들 필요가 없다.
 *
 * 여기서 가장 조심하는 것은 **자리를 못 얻은 블록**이다. 셋으로 갈리고, 셋을
 * 헷갈리면 각각 다른 사고가 난다.
 *
 *  - 히어로를 빼면 이벤트가 무엇인지 알 수 없는 배너가 나온다.
 *  - 기간을 억지로 넣으면 겹친 배너가 나온다.
 *  - 제목을 조용히 빼면 **제목 없는 배너가 그대로 나간다.**
 *
 * 마지막 것이 제일 위험하다. 아무도 실패했다고 말해 주지 않기 때문이다.
 */

import { describe, it, expect } from 'vitest'
import { buildBannerPage, fitBanner } from '../domain/bannerFit'
import { BANNER_1020x70, BANNER_SPECS, bannerSpecById } from '../domain/bannerSpec'
import { createBlock } from '../domain/factory'
import type { BriefBlock } from '../domain/briefSchema'
import type { BlockType } from '../domain/blockTypes'
import type { BriefPage } from '../domain/pageSchema'

const SPEC = BANNER_1020x70

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

const slotOf = (fit: ReturnType<typeof fitBanner>, id: string) =>
  fit.placements.find((p) => p.blockId === id)?.slotId ?? null

describe('§32-1 어느 자리로 가는가', () => {
  it('제목은 가운데, 누르는 것은 오른쪽', () => {
    // 세 이벤트의 얇은 띠가 전부 이 문법이었다.
    const fit = fitBanner([block('main_headline', 'title'), block('cta_button', 'cta')], SPEC)
    expect(slotOf(fit, 'title')).toBe('head')
    expect(slotOf(fit, 'cta')).toBe('act')
  })

  it('혜택은 왼쪽부터 차고, 넘치면 다음 자리로 간다', () => {
    const fit = fitBanner(
      [block('price', 'a'), block('price', 'b'), block('price', 'c')],
      SPEC,
    )
    expect([slotOf(fit, 'a'), slotOf(fit, 'b')]).toEqual(['lead', 'lead'])
    expect(slotOf(fit, 'c')).toBe('body')
  })

  it('자리는 중요한 것부터 고른다', () => {
    // 순서가 뒤집히면 가격이 밀려나고 구분 머리말이 앞자리를 차지한다.
    const fit = fitBanner(
      [block('winner_count', 'few'), block('purchase_condition', 'cond'), block('price', 'won')],
      SPEC,
    )
    expect(slotOf(fit, 'won')).toBe('lead')
  })

  it('로고는 자리가 남을 때만 들어간다', () => {
    // "협업 이벤트면 로고를 넣는다"가 아니다. 제목과 제품을 넣고 남으면 들어간다.
    // 혼자면 남는 자리를 얻고 —
    expect(slotOf(fitBanner([block('logo', 'logo')], SPEC), 'logo')).toBe('body')
    // 앞의 것들이 자리를 다 채우면 포기한다.
    const crowded = fitBanner(
      [
        block('logo', 'logo'),
        block('product_group_image', 'p1'),
        block('product_group_image', 'p2'),
        block('price', 'w1'),
        block('price', 'w2'),
      ],
      SPEC,
    )
    expect(crowded.dropped).toEqual([{ blockId: 'logo', reason: 'no-slot' }])
  })

  it('배너에 가지 않는 것은 자리를 다투지도 않는다', () => {
    // 주의 문구가 자리를 다투면 정말 필요한 것이 그만큼 밀린다.
    const fit = fitBanner([block('caution_text', 'notice'), block('button_url', 'url')], SPEC)
    expect(fit.dropped.map((d) => d.reason)).toEqual(['not-for-banner', 'not-for-banner'])
    expect(fit.placements).toEqual([])
  })

  it('모든 자리가 배너 안에 있다', () => {
    const fit = fitBanner(
      [block('main_headline', 't'), block('cta_button', 'c'), block('price', 'p'), block('gift', 'g')],
      SPEC,
    )
    for (const { rect } of fit.placements) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(SPEC.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(SPEC.height)
    }
  })
})

describe('§32-2 자리를 못 얻으면', () => {
  it('한 대뿐인 히어로는 배경으로 내려간다', () => {
    // 이벤트3의 가차 기계. 잘리지도 빠지지도 않고 확대되어 흐리게 깔렸다.
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => block('main_product_image', id))
    const fit = fitBanner(many, SPEC)
    expect(fit.background).toEqual(['e'])
    expect(fit.dropped).toEqual([])
  })

  it('기간은 남는 자리가 있으면 들어가고, 없으면 그냥 빠진다', () => {
    // 기간도 "남는 자리에 우겨넣는" 쪽이다. 줄바꿈을 바꾼다고 들어갈 것이 아니라
    // 자리가 있느냐 없느냐다.
    expect(slotOf(fitBanner([block('period', 'when')], SPEC), 'when')).toBe('head')

    const crowded = fitBanner(
      [
        block('main_headline', 'title'),
        block('cta_button', 'cta1'),
        block('cta_button', 'cta2'),
        block('price', 'won1'),
        block('price', 'won2'),
        block('gift', 'gift1'),
        block('winner_count', 'few'),
        block('sub_headline', 'sub'),
        block('period', 'when'),
      ],
      SPEC,
    )
    expect(crowded.dropped).toEqual([{ blockId: 'when', reason: 'no-slot' }])
  })

  it('제목은 빠지지 않는다 — 대신 그렇다고 말한다', () => {
    // 여기가 이 파일에서 제일 중요한 검사다. 조용히 빼면 제목 없는 배너가
    // 그대로 나가고, 아무도 실패했다고 말해 주지 않는다.
    const fit = fitBanner(
      [block('main_headline', 'one'), block('main_headline', 'two'), block('main_headline', 'three')],
      SPEC,
    )
    expect(fit.unplaced).toEqual(['three'])
    expect(fit.dropped).toEqual([])
    expect(fit.background).toEqual([])
  })

  it('CTA도 마찬가지다', () => {
    const fit = fitBanner(
      [block('cta_button', 'a'), block('cta_button', 'b'), block('cta_button', 'c')],
      SPEC,
    )
    expect(fit.unplaced).toEqual(['c'])
    expect(fit.dropped).toEqual([])
  })
})

describe('§32-3 모양을 지킨다', () => {
  const ratio = (r: { width: number; height: number }) => r.width / r.height

  it('조각은 자리 안에서 제 비율을 지킨다', () => {
    // 자리를 통째로 주면 늘어난다. 배너에 들어가는 것은 이미 만들어 놓은 그림
    // 조각이라 — 제목도 버튼도 상품 사진도 — 늘리면 그 그림이 망가진다.
    const source = block('main_headline', 'title', { width: 520, height: 150 })
    const fit = fitBanner([source], SPEC)
    expect(ratio(fit.placements[0]!.rect)).toBeCloseTo(ratio(source.position), 1)
  })

  it('자리를 나눠 써도 비율은 그대로다', () => {
    const a = block('price', 'a', { width: 260, height: 60 })
    const b = block('price', 'b', { width: 120, height: 120 })
    const fit = fitBanner([a, b], SPEC)
    for (const p of fit.placements) {
      const src = p.blockId === 'a' ? a : b
      expect(ratio(p.rect)).toBeCloseTo(ratio(src.position), 1)
    }
  })

  it('모양이 안 맞으면 자리를 얻고도 배경으로 내려간다', () => {
    // 이벤트3의 가차 기계. 앞선 판은 "자리가 모자랄 때"만 배경으로 내렸는데,
    // 실제로 배경이 된 이유는 자리가 없어서가 아니라 **모양이 안 맞아서**였다 —
    // 자리는 왼쪽에 있었다. 세로로 긴 기계를 70px 띠에 비율 지켜 넣으면 손가락만
    // 한 조각이 남는다.
    const fit = fitBanner([block('main_product_image', 'gacha', { width: 330, height: 470 })], SPEC)
    expect(fit.background).toEqual(['gacha'])
    expect(fit.placements).toEqual([])
  })

  it('눕힐 수 있는 것은 눕혀서 자리를 채운다', () => {
    // `ADULT ONLY · R19`. 그대로 넣으면 폭이 10px도 안 되지만, 눕히면 칸을 거의
    // 다 쓴다. 눕히지 못했다면 이것도 버려졌을 것이다.
    const fit = fitBanner([block('free_text', 'r19', { width: 40, height: 230 })], SPEC)
    const placed = fit.placements[0]!
    expect(placed.applied).toEqual(['rotate'])
    expect(placed.rect.width).toBeGreaterThan(placed.rect.height)
    expect(fit.background).toEqual([])
  })

  it('가로로 긴 것을 괜히 눕히지는 않는다', () => {
    const fit = fitBanner([block('free_text', 'wide', { width: 400, height: 60 })], SPEC)
    expect(fit.placements[0]!.applied).toEqual([])
  })
})

describe('§32-3-2 눕힌 것을 기록한다', () => {
  it('세로로 길던 것이 가로 자리에 들어가면 눕혔다고 적는다', () => {
    // `ADULT ONLY - R19`가 1020×70에서 가로로 누웠다. 자리가 정하는 일이지만,
    // 그렇게 되었다는 것을 알아야 세로로 짜인 글자를 그대로 늘여 놓지 않는다.
    const fit = fitBanner([block('free_text', 'r19', { width: 40, height: 220 })], SPEC)
    expect(fit.placements[0]!.applied).toEqual(['rotate'])
  })

  it('원래 가로로 길던 것은 아무 일도 없다', () => {
    const fit = fitBanner([block('free_text', 'wide', { width: 400, height: 60 })], SPEC)
    expect(fit.placements[0]!.applied).toEqual([])
  })
})

describe('§32-4 배너 기획서가 나온다', () => {
  function built() {
    return buildBannerPage(
      page([
        block('main_headline', 'title'),
        block('cta_button', 'cta'),
        block('price', 'won'),
        block('caution_text', 'notice'),
      ]),
      SPEC,
    )
  }

  it('크기가 규격 그대로다', () => {
    const { page: banner } = built()
    expect([banner.canvasWidth, banner.canvasHeight]).toEqual([1020, 70])
  })

  it('블록의 번호와 내용이 그대로 따라온다', () => {
    // 번호가 바뀌면 조각을 다시 만들어야 한다. 배너의 값어치가 거기에 있다.
    const { page: banner } = built()
    const title = banner.blocks.find((b) => b.id === 'title')!
    expect(title.content).toBe('title')
    expect(title.type).toBe('main_headline')
  })

  it('배너에 가지 않는 블록은 페이지에 없다', () => {
    const { page: banner } = built()
    expect(banner.blocks.map((b) => b.id)).not.toContain('notice')
  })

  it('원본 기획서를 건드리지 않는다', () => {
    // 배너를 뽑았다고 메인 이벤트 페이지의 배치가 흔들리면 안 된다.
    const source = page([block('main_headline', 'title'), block('price', 'won')])
    const before = source.blocks.map((b) => ({ ...b.position }))
    buildBannerPage(source, SPEC)
    expect(source.blocks.map((b) => ({ ...b.position }))).toEqual(before)
    expect([source.canvasWidth, source.canvasHeight]).toEqual([840, 1180])
  })

  it('배경으로 내려간 것은 전면으로 깔리고 맨 뒤에 간다', () => {
    // 배열의 앞이 뒤에 깔린다. 글자 위에 오면 아무것도 읽을 수 없다.
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => block('main_product_image', id))
    const { page: banner, fit } = buildBannerPage(page(many), SPEC)
    expect(fit.background).toEqual(['e'])
    expect(banner.blocks[0]!.id).toBe('e')
    expect(banner.blocks[0]!.position).toEqual({ x: 0, y: 0, width: 1020, height: 70 })
  })

  it('배경으로 내려간 것은 화면을 **채운다**', () => {
    // 기본값인 `맞추기`로 두면 세로로 긴 히어로가 70px 높이에 맞춰 손톱만 하게
    // 줄어 가운데 박힌다 — 브라우저에서 실제로 그랬다. 배경으로 내린다는 것은
    // 화면을 덮는다는 뜻이지 작게 놓는다는 뜻이 아니다.
    const gacha = block('main_product_image', 'gacha', { width: 330, height: 470 })
    const { page: banner } = buildBannerPage(page([gacha]), SPEC)
    expect(banner.blocks[0]!.image?.fit).toBe('cover')
  })
})

describe('§32-5 규격이 스스로 말하는 것', () => {
  it('끝 색을 어느 쪽에서 읽을지 적혀 있다', () => {
    // 이 값이 비어 있으면 사람이 다시 스포이드를 든다.
    expect(SPEC.edgeReport.length).toBeGreaterThan(0)
  })

  it('형제 규격을 데리고 있다', () => {
    // 840×78은 따로 배치하지 않고 이 배치를 다른 크기로 다시 저장하는 것이다.
    expect(SPEC.siblings).toContainEqual({ width: 840, height: 78 })
  })

  it('자리들이 배너 안에 있고 서로 겹치지 않는다', () => {
    // 겹치면 두 블록이 겹쳐 그려진다. 눈으로 보기 전에는 모른다.
    for (const slot of SPEC.slots) {
      expect(slot.area.x).toBeGreaterThanOrEqual(0)
      expect(slot.area.y).toBeGreaterThanOrEqual(0)
      expect(slot.area.x + slot.area.width).toBeLessThanOrEqual(1)
      expect(slot.area.y + slot.area.height).toBeLessThanOrEqual(1)
    }
    for (const [i, a] of SPEC.slots.entries()) {
      for (const b of SPEC.slots.slice(i + 1)) {
        const apart =
          a.area.x + a.area.width <= b.area.x ||
          b.area.x + b.area.width <= a.area.x ||
          a.area.y + a.area.height <= b.area.y ||
          b.area.y + b.area.height <= a.area.y
        expect(apart).toBe(true)
      }
    }
  })

  it('번호로 규격을 찾는다', () => {
    expect(bannerSpecById('1020x70')).toBe(SPEC)
    expect(bannerSpecById('없는규격')).toBeNull()
    expect(BANNER_SPECS).toContain(SPEC)
  })
})
