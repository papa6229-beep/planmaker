/**
 * 문구 꾸미기 (문구 꾸미기 Patch, 2026-09-17).
 *
 * 작업자의 한국어 주문을 칸으로 읽는다. 자유 문장으로 옮기지 않는 것은, 같은 날
 * 번역기가 "흰 테두리"를 `silver gradient`로 바꿨기 때문이다.
 */

import { describe, expect, it } from 'vitest'
import {
  KEY_HUE_MAX,
  KEY_HUE_MIN,
  PLATE_MIN_HEIGHT,
  hexToRgb,
  letteringColors,
  mergeTextOrders,
  plateSizeFor,
  readTextFinish,
  readTextOrder,
} from '../domain/textStyle'

describe('readTextOrder', () => {
  it('주문이 없으면 강조에 따라 기본값 — 큰 제목은 알록달록, 본문은 그라데이션, 테두리·그림자 켬', () => {
    expect(readTextOrder('', 'very_high')).toMatchObject({ fill: 'colorful', outline: true, shadow: true, finish: 'glossy' })
    expect(readTextOrder(undefined, 'normal')).toMatchObject({ fill: 'gradient', finish: 'glossy' })
    expect(readTextOrder('', 'low').finish).toBe('none')
  })

  it('실제 작업 파일의 주문 — "참고 이미지처럼 알록달록하게 꾸며줘 흰색 테두리도 넣어줘."', () => {
    const spec = readTextOrder('참고 이미지처럼 알록달록하게 꾸며줘 흰색 테두리도 넣어줘.', 'high')
    expect(spec.fill).toBe('colorful')
    expect(spec.outline).toBe(true)
    expect(spec.outlineColor).toBe('#ffffff')
    // 테두리의 색이 몸통 색으로 새지 않는다
    expect(spec.colors).toEqual([])
  })

  it('"배경 레퍼런스 이미지와 어울리는 느낌으로 꾸며줘"는 기본값이다 — 배경에서 색을 가져온다', () => {
    const spec = readTextOrder('배경 레퍼런스 이미지와 어울리는 느낌으로 꾸며줘', 'normal')
    expect(spec).toEqual(readTextOrder('', 'normal'))
  })

  it('색 이름은 말한 차례대로, 하나면 단색', () => {
    expect(readTextOrder('노랑이랑 파랑 그라데이션', 'high')).toMatchObject({
      fill: 'gradient',
      colors: ['#f5c518', '#2f6fe0'],
    })
    expect(readTextOrder('빨간색으로', 'high')).toMatchObject({ fill: 'solid', colors: ['#e8413c'] })
  })

  it('금색은 그라데이션 + 금속', () => {
    expect(readTextOrder('금색으로 반짝이게', 'high')).toMatchObject({ fill: 'gradient', finish: 'metal' })
  })

  it('테두리·그림자를 빼 달라면 끈다', () => {
    const spec = readTextOrder('테두리 없이, 그림자는 빼줘', 'high')
    expect(spec.outline).toBe(false)
    expect(spec.shadow).toBe(false)
  })

  it('테두리 색을 읽는다', () => {
    expect(readTextOrder('검은색 테두리 넣어줘', 'high').outlineColor).toBe('#1b1b1f')
  })

  it('재질 낱말', () => {
    expect(readTextOrder('네온사인처럼', 'high').finish).toBe('neon')
    expect(readTextOrder('입체감 있게', 'high').finish).toBe('plastic')
    expect(readTextOrder('글리터 느낌', 'high').finish).toBe('glitter')
    expect(readTextOrder('무광으로 깔끔하게', 'high').finish).toBe('none')
  })

  it('흰 글자에는 흰 테두리를 두지 않는다', () => {
    expect(readTextOrder('흰색 글자', 'high').outlineColor).toBe('#1b1b1f')
  })

  it('모양을 바꾸는 말은 칸이 없다 — 무시된다', () => {
    expect(readTextOrder('둥글둥글하고 굵게', 'high')).toEqual(readTextOrder('', 'high'))
  })
})

describe('mergeTextOrders — 고치기의 수정 지시가 원래 주문을 이긴다', () => {
  it('말한 칸만 바뀐다', () => {
    const spec = mergeTextOrders('알록달록 흰색 테두리', '네온으로 바꿔줘', 'high')
    expect(spec.fill).toBe('colorful')
    expect(spec.finish).toBe('neon')
    expect(spec.outline).toBe(true)
  })
  it('수정 지시의 색이 원래 색을 덮는다', () => {
    expect(mergeTextOrders('빨간색', '파란색으로', 'high').colors).toEqual(['#2f6fe0'])
  })
})

describe('letteringColors', () => {
  const hue = (hex: string) => {
    const { r, g, b } = hexToRgb(hex)!
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === min) return 0
    let h = max === r ? (g - b) / (max - min) : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
    h *= 60
    return h < 0 ? h + 360 : h
  }

  it('마젠타 근처 색은 버린다 — 바탕과 함께 지워진다', () => {
    const out = letteringColors(
      [
        { hex: '#ff00ff', share: 0.5 },
        { hex: '#e040c0', share: 0.2 },
        { hex: '#40a0e0', share: 0.1 },
      ],
      { emphasis: 'high' },
    )
    expect(out.every((h) => hue(h) < KEY_HUE_MIN || hue(h) > KEY_HUE_MAX)).toBe(true)
    expect(out.length).toBe(1)
  })

  it('무채색 그림이면 기본 한 벌을 쓴다', () => {
    expect(letteringColors([{ hex: '#f0f0f0', share: 1 }], { emphasis: 'high' }).length).toBeGreaterThan(1)
  })

  it('본문은 제목보다 진하다 — 밝은 배경에서 읽히게', () => {
    const palette = [{ hex: '#f0c04b', share: 1 }]
    const [title] = letteringColors(palette, { emphasis: 'high' })
    const [body] = letteringColors(palette, { emphasis: 'normal' })
    const lum = (hex: string) => {
      const { r, g, b } = hexToRgb(hex)!
      return r + g + b
    }
    expect(lum(body!)).toBeLessThan(lum(title!))
  })
})

describe('plateSizeFor', () => {
  it('높이는 352px 이상 — 낮은 판에서 한글이 깨졌다', () => {
    const size = plateSizeFor({ width: 403, height: 48 })!
    expect(size.height).toBeGreaterThanOrEqual(PLATE_MIN_HEIGHT - 16)
    expect(size.width % 16).toBe(0)
    expect(size.width / size.height).toBeCloseTo(403 / 48, 0)
  })

  it('보통 제목은 약 100만 화소', () => {
    const size = plateSizeFor({ width: 468, height: 177 })!
    expect(size.width * size.height).toBeGreaterThan(900_000)
    expect(size.width * size.height).toBeLessThan(1_100_000)
  })

  it('너무 가늘고 길면 null — AI 없이 간다', () => {
    expect(plateSizeFor({ width: 2000, height: 20 })).toBeNull()
  })
})

describe('readTextFinish', () => {
  it('아는 이름만', () => {
    expect(readTextFinish('neon')).toBe('neon')
    expect(readTextFinish('Recolor the lettering')).toBeUndefined()
    expect(readTextFinish(3)).toBeUndefined()
  })
})
