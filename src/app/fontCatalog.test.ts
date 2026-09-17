/**
 * 글꼴 목록 (문구 판 Patch).
 *
 * 로컬 엔진이 한글을 쓰지 못하므로 글자는 브라우저가 그린다. 그 구조에서 디자인의
 * 폭은 **글꼴이** 정한다 — 모델은 글자꼴을 바꾸지 못하고, 바꾸게 두면 한글이
 * 틀린다. 그래서 목록이 깨졌다고 화면이 멈추면 안 되고, 없는 굵기를 골랐다고
 * 글자가 안 나오면 안 된다.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WEIGHT,
  filterFamilies,
  groupFamilies,
  parseFontCatalog,
  pickWeight,
  type FontFamily,
} from '../domain/fontCatalog'

const RAW = [
  { file: 'f01-pretendard-400.woff2', family: 'Pretendard', weight: 400, group: '본문·다목적', bytes: 400_000 },
  { file: 'f01-pretendard-900.woff2', family: 'Pretendard', weight: 900, group: '본문·다목적', bytes: 420_000 },
  { file: 'f01-pretendard-100.woff2', family: 'Pretendard', weight: 100, group: '본문·다목적', bytes: 380_000 },
  { file: 'f02-black-han-sans-400.woff2', family: 'Black Han Sans', weight: 400, group: '임팩트', bytes: 900_000 },
]

describe('parseFontCatalog', () => {
  it('같은 이름을 한 패밀리로 묶고 가는 것부터 세운다', () => {
    const families = parseFontCatalog(RAW)
    const pretendard = families.find((f) => f.family === 'Pretendard')!
    expect(pretendard.weights.map((w) => w.weight)).toEqual([100, 400, 900])
    expect(families.map((f) => f.family)).toEqual(['Pretendard', 'Black Han Sans'])
  })

  it('망가진 줄은 버리고 나머지는 살린다 — 목록 하나가 화면을 막지 않는다', () => {
    const families = parseFontCatalog([
      ...RAW,
      null,
      'nope',
      { file: 42, family: '숫자 이름' },
      { family: '파일 없음', weight: 400 },
      { file: 'no-family.woff2', weight: 400 },
    ])
    expect(families.map((f) => f.family)).toEqual(['Pretendard', 'Black Han Sans'])
  })

  it('목록 자체가 아니면 빈 목록이다', () => {
    expect(parseFontCatalog(null)).toEqual([])
    expect(parseFontCatalog({ fonts: RAW })).toEqual([])
  })

  it('굵기가 이상하면 기본값으로 읽는다', () => {
    const [family] = parseFontCatalog([{ file: 'x.woff2', family: 'X', weight: 5 }])
    expect(family!.weights[0]!.weight).toBe(DEFAULT_WEIGHT)
  })
})

describe('pickWeight', () => {
  const pretendard = parseFontCatalog(RAW).find((f) => f.family === 'Pretendard')!
  const single = parseFontCatalog(RAW).find((f) => f.family === 'Black Han Sans')!

  it('원하는 굵기를 그대로 준다', () => {
    expect(pickWeight(pretendard, 900)?.weight).toBe(900)
  })

  it('없는 굵기는 가장 가까운 것으로 — 고를 수 있는데 안 나오면 안 된다', () => {
    expect(pickWeight(pretendard, 800)?.weight).toBe(900)
    expect(pickWeight(pretendard, 300)?.weight).toBe(400)
  })

  it('굵기가 하나뿐인 글꼴에도 굵게를 고를 수 있다', () => {
    expect(pickWeight(single, 900)?.weight).toBe(400)
  })

  it('빈 패밀리는 아무것도 주지 않는다', () => {
    expect(pickWeight({ family: '빈 것', group: '기타', script: 'ko', weights: [] } as FontFamily)).toBeNull()
  })
})

describe('groupFamilies', () => {
  it('목록에 나온 갈래 차례를 지킨다', () => {
    const grouped = groupFamilies(parseFontCatalog(RAW))
    expect(grouped.map((g) => g.group)).toEqual(['본문·다목적', '임팩트'])
    expect(grouped[0]!.families.map((f) => f.family)).toEqual(['Pretendard'])
  })
})

describe('filterFamilies — 글꼴 전체 Patch', () => {
  const families = parseFontCatalog([
    ...RAW,
    { file: 'f100-antonio-700.woff2', family: 'Antonio', weight: 700, group: '산세리프', script: 'latin' },
  ])

  it('예전 목록(갈래 칸 없음)은 한글로 읽는다', () => {
    expect(families.find((f) => f.family === 'Pretendard')!.script).toBe('ko')
  })

  it('한글과 외국어를 나눈다', () => {
    expect(filterFamilies(families, 'latin', '').map((f) => f.family)).toEqual(['Antonio'])
    expect(filterFamilies(families, 'ko', '').map((f) => f.family)).toEqual(['Pretendard', 'Black Han Sans'])
  })

  it('이름 일부로 좁힌다 — 대소문자·띄어쓰기는 가리지 않는다', () => {
    expect(filterFamilies(families, 'ko', 'blackhan').map((f) => f.family)).toEqual(['Black Han Sans'])
    expect(filterFamilies(families, 'ko', '없는 이름')).toEqual([])
  })
})
