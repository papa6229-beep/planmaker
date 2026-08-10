/**
 * 배너에서 무엇이 버티고 무엇이 물러나는가 (배너 Patch §2).
 *
 * 세 이벤트의 배너 열다섯 장에서 읽은 것을 붙든다. 규격별 규칙은 여기 없다 —
 * "1020×70에서는 기간을 뺀다" 같은 것은 이벤트마다 달랐고 앞으로도 달라진다.
 * 여기서 지키는 것은 그보다 아래에 있는 것, **차례**와 **물러나는 방법**이다.
 *
 * 그래서 검사도 표를 그대로 다시 읽지 않는다. 표를 읽어 답하는 것은 검사가
 * 아니라 동어반복이다. 대신 실제 배너에서 눈으로 본 사실을 적는다 — 열다섯 장에
 * 주의 문구가 한 번도 없었다는 것, 자리가 하나뿐일 때 남은 것이 제목이었다는 것,
 * 얇은 띠의 사은품이 빠지지 않고 이름표만 벗었다는 것.
 */

import { describe, it, expect } from 'vitest'
import { BLOCK_TYPE_LIST, type BlockType } from '../domain/blockTypes'
import {
  BANNER_ROLES,
  CONCESSION_ORDER,
  bannerOrder,
  bannerRoleOf,
  goesToBanner,
  nextConcession,
} from '../domain/bannerRules'
import { createBlock } from '../domain/factory'
import type { BriefBlock } from '../domain/briefSchema'

function block(type: BlockType, id: string = type): BriefBlock {
  return createBlock(type, { id, content: id })
}

const ALL_TYPES = BLOCK_TYPE_LIST.map((meta) => meta.type)

describe('§31-1 배너에 가지 않는 것', () => {
  it('주의 문구는 가지 않는다', () => {
    // 세 이벤트 열다섯 장 어디에도 하단 고지가 없었다. "자리가 남으면 넣는다"가
    // 아니라 아예 가지 않는 것으로 본다.
    expect(goesToBanner('caution_text')).toBe(false)
  })

  it('옆에 적어 두는 것은 그림에 가지 않는다', () => {
    // 링크·퍼블리싱 메모·담당자 메모는 디자인팀이 읽는 것이지 그려지는 것이 아니다.
    // 하나라도 새면 배너에 URL이 찍힌다.
    const leaked = ALL_TYPES.filter((type) => BLOCK_TYPE_LIST.find((m) => m.type === type)!.category === 'reference')
      .filter(goesToBanner)
    expect(leaked).toEqual([])
  })

  it('참고로만 붙여 둔 그림도 가지 않는다', () => {
    expect(goesToBanner('background_reference_image')).toBe(false)
    expect(goesToBanner('existing_full_image')).toBe(false)
  })

  it('가지 않는 것은 차례에도 없다', () => {
    const blocks = [block('main_headline'), block('caution_text'), block('publishing_note')]
    expect(bannerOrder(blocks).map((b) => b.type)).toEqual(['main_headline'])
  })
})

describe('§31-2 버티는 차례', () => {
  it('자리가 하나뿐이면 제목이 남는다', () => {
    // 열다섯 장 전부에 제목이 있었다. 다른 무엇을 위해서도 밀려나지 않는다.
    const blocks = [block('period'), block('logo'), block('gift'), block('main_headline'), block('body_text')]
    expect(bannerOrder(blocks)[0]!.type).toBe('main_headline')
  })

  it('제목 다음은 누르게 하는 것이다', () => {
    // 버튼이 없는 배너를 예외로 보았지만, 원래는 늘 들어가는 것이 맞다.
    const blocks = [block('period'), block('cta_button'), block('main_headline'), block('price')]
    expect(bannerOrder(blocks).map((b) => b.type).slice(0, 2)).toEqual(['main_headline', 'cta_button'])
  })

  it('가격은 얇은 띠에서도 살아남을 만큼 세다', () => {
    // 이벤트3의 70px 띠에서 `1회뽑기 14,900원`이 **맨 앞자리**를 차지했다.
    // 부제·기간·설명문보다 뒤로 밀리면 그 배너가 나오지 않는다.
    const order = bannerOrder([block('sub_headline'), block('period'), block('body_text'), block('price')])
    expect(order[0]!.type).toBe('price')
  })

  it('중요도가 같으면 기획서에 놓인 차례를 지킨다', () => {
    // 뒤집히면 작성자가 위에 둔 것이 배너에서 먼저 빠진다.
    const blocks = [block('gift', 'gift-a'), block('gift', 'gift-b'), block('gift', 'gift-c')]
    expect(bannerOrder(blocks).map((b) => b.id)).toEqual(['gift-a', 'gift-b', 'gift-c'])
  })

  it('원래 목록을 건드리지 않는다', () => {
    // 기획서의 블록 차례는 화면의 앞뒤이기도 하다. 배너를 뽑았다고 그것이 바뀌면 안 된다.
    const blocks = [block('period'), block('main_headline')]
    const before = blocks.map((b) => b.type)
    bannerOrder(blocks)
    expect(blocks.map((b) => b.type)).toEqual(before)
  })
})

describe('§31-3 물러나는 방법', () => {
  it('제목과 CTA는 물러나도 빠지지는 않는다', () => {
    // 이 둘을 뺄 바에는 배너를 만들지 않는 편이 낫다.
    expect(bannerRoleOf('main_headline').concessions).not.toContain('drop')
    expect(bannerRoleOf('cta_button').concessions).not.toContain('drop')
    // 줄바꿈은 바꾼다 — 제목은 2줄이 되기도 1줄이 되기도 했다.
    expect(nextConcession('main_headline')).toBe('reflow')
    // 더 물러날 데가 없어도 `null`이지 `drop`이 아니다.
    expect(nextConcession('main_headline', ['reflow', 'shorten'])).toBeNull()
  })

  it('제목은 빼는 대신 줄인다', () => {
    // "너무 길면 의미만 맞게 줄일 때도 있다." 줄바꿈과는 다른 일이다 — 줄바꿈은
    // 같은 글자를 다르게 접는 것이고, 이것은 글자를 덜어내는 것이다.
    expect(nextConcession('main_headline', ['reflow'])).toBe('shorten')
    // 줄바꿈을 먼저 해 본다. 덜어내는 것이 접는 것보다 아프다.
    expect(CONCESSION_ORDER.indexOf('shorten')).toBeGreaterThan(CONCESSION_ORDER.indexOf('reflow'))
  })

  it('제품 이미지는 제목 다음이다 — 가격보다 앞', () => {
    // 작은 규격에서 넣는 차례가 제목 → 제품 이미지 → 남는 것이다. 밀리면 글자만
    // 남은 배너가 나온다.
    const order = bannerOrder([block('price'), block('product_group_image'), block('main_headline')])
    expect(order.map((b) => b.type)).toEqual(['main_headline', 'product_group_image', 'price'])
  })

  it('상품 뭉치는 빼기 전에 개수를 줄인다', () => {
    // 8개가 5개가 되었을 뿐 사라지지는 않았다.
    expect(nextConcession('product_group_image')).toBe('thin')
  })

  it('한 대뿐인 히어로는 줄일 개수가 없다 — 안 맞으면 뺀다', () => {
    // 한때 배경으로 내려 깔았다. 실물로 돌려 보니 인물 컷아웃은 늘리면 얼룩이라
    // 작업자가 "배경에 뭐가 깔린지 모르겠다"고 했다. 빼고 말하는 쪽으로 되돌렸다.
    expect(nextConcession('main_product_image')).toBe('drop')
    expect(bannerRoleOf('main_product_image').concessions).not.toContain('thin')
  })

  it('사은품은 빼기 전에 이름표를 벗는다', () => {
    // 70px 띠 두 장에서 스피너·젤 사진은 남고 이름만 사라졌다. 사은품이 이벤트의
    // 요점이라 통째로 빼면 "텐가 사요"가 되어 버린다.
    expect(nextConcession('gift')).toBe('unlabel')
  })

  it('목록은 빼기 전에 열 수를 바꾼다', () => {
    // 브랜드 일곱 줄이 800×250에서 세로 1열 → 가로 2열로 재배치됐다.
    expect(nextConcession('option_item')).toBe('recolumn')
  })

  it('이미 한 것은 다시 하지 않는다', () => {
    expect(nextConcession('product_group_image', ['thin'])).toBe('drop')
    expect(nextConcession('product_group_image', ['thin', 'drop'])).toBeNull()
  })

  it('기간과 로고는 물러날 것 없이 바로 빠진다', () => {
    // 줄바꿈을 바꾼다고 들어갈 것이 아니다. 있거나 없거나 둘 중 하나였다.
    expect(nextConcession('period')).toBe('drop')
    expect(nextConcession('logo')).toBe('drop')
  })
})

describe('§31-4 표가 스스로 어긋나지 않는다', () => {
  it('양보는 언제나 덜 아픈 것부터다', () => {
    // `['drop', 'thin']`처럼 적히면 자리가 조금 모자랄 뿐인데 블록이 통째로
    // 사라진다. 표를 손댈 때 가장 하기 쉬운 실수다.
    const broken: string[] = []
    for (const [type, role] of Object.entries(BANNER_ROLES)) {
      const ranks = role.concessions.map((step) => CONCESSION_ORDER.indexOf(step))
      if (ranks.some((rank, i) => i > 0 && rank <= ranks[i - 1]!)) broken.push(type)
    }
    expect(broken).toEqual([])
  })

  it('빼기가 있으면 그것이 마지막이다', () => {
    const wrong = Object.entries(BANNER_ROLES)
      .filter(([, role]) => role.concessions.includes('drop'))
      .filter(([, role]) => role.concessions.at(-1) !== 'drop')
      .map(([type]) => type)
    expect(wrong).toEqual([])
  })

  it('가지 않는 것에는 중요도도 양보도 없다', () => {
    // 중요도가 남아 있으면 언젠가 누군가 그 숫자를 보고 "간다"고 읽는다.
    const odd = Object.entries(BANNER_ROLES)
      .filter(([, role]) => role.purpose === 'none')
      .filter(([, role]) => role.importance !== 0 || role.concessions.length > 0)
      .map(([type]) => type)
    expect(odd).toEqual([])
  })

  it('가는 것에는 중요도가 있다', () => {
    // 0이면 차례를 매길 수 없어 기획서에 놓인 순서대로만 남는다.
    const zero = ALL_TYPES.filter(goesToBanner).filter((type) => bannerRoleOf(type).importance <= 0)
    expect(zero).toEqual([])
  })

  it('모든 블록 종류에 자리가 정해져 있다', () => {
    // 종류를 새로 만들고 여기를 안 채우면 그 블록은 조용히 배너에서 사라진다.
    expect(ALL_TYPES.filter((type) => BANNER_ROLES[type] === undefined)).toEqual([])
  })
})
