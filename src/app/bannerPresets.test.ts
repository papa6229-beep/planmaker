/**
 * 프리셋을 고칠 수 있다 (프리셋 관리 Patch).
 *
 * 작업자의 말은 "이 프리셋 사이즈는 수정 변경 저장 가능하게"였다. 쇼핑몰이 개편되면
 * 크기가 바뀌고 새 자리가 생기면 여섯째가 필요해지는데, 코드에 박아 두면 그때마다
 * 사람을 불러야 한다.
 *
 * 사람이 손으로 적는 값이 그대로 들어온다. 그래서 여기서 붙드는 것은 두 가지다 —
 * **말이 안 되는 줄이 통과하지 않는가**, 그리고 **한 줄이 잘못됐다고 나머지까지
 * 잃지 않는가**. 다섯 중 하나의 오타로 넷이 사라지면 그건 편집이 아니라 사고다.
 */

import { describe, it, expect } from 'vitest'
import { fromDraft, readPresets, toDraft, writePresets, type PresetDraft } from '../domain/bannerPresets'
import { BANNER_SPECS } from '../domain/bannerSpec'

const draft = (patch: Partial<PresetDraft> = {}): PresetDraft => ({
  id: '',
  label: '얇은 가로 띠',
  width: '1020',
  height: '70',
  siblings: '840×78',
  ...patch,
})

describe('§36-1 편집 줄과 규격 사이', () => {
  it('규격을 폈다가 그대로 되돌린다', () => {
    for (const spec of BANNER_SPECS) expect(fromDraft(toDraft(spec))).toEqual(spec)
  })

  it('형제 크기는 `×`도 `x`도 받는다', () => {
    // 사람이 어느 쪽으로 적을지 정해 줄 수 없다. 둘 다 받는다.
    expect(fromDraft(draft({ siblings: '840x78, 500×387' }))!.siblings).toEqual([
      { width: 840, height: 78 },
      { width: 500, height: 387 },
    ])
  })

  it('이름을 비우면 크기가 곧 이름이다', () => {
    expect(fromDraft(draft({ label: '  ' }))!.label).toBe('1020×70')
  })

  it('번호는 크기에서 나온다', () => {
    // 크기를 고치면 번호도 따라 바뀌어야 한다. 안 그러면 이미 뽑아 둔 배너
    // 페이지가 바뀐 크기를 자기 것인 양 쓴다.
    expect(fromDraft(draft({ width: '640', height: '200' }))!.id).toBe('640x200')
  })

  it('말이 안 되는 크기는 규격이 아니다', () => {
    for (const patch of [
      { width: '0' },
      { height: '0' },
      { width: '-5' },
      { width: '99999' },
      { width: '가로' },
      { width: '' },
      { height: '70.5' },
    ]) {
      expect(fromDraft(draft(patch))).toBeNull()
    }
  })

  it('형제 크기가 엉망이면 그 항목만 버린다', () => {
    // 형제는 알려 주는 값이다. 그것 하나 때문에 프리셋 자체를 못 쓰게 하지 않는다.
    const spec = fromDraft(draft({ siblings: '840×78, 알수없음, 0x10' }))!
    expect(spec.siblings).toEqual([{ width: 840, height: 78 }])
  })
})

describe('§36-2 저장한 것을 다시 읽는다', () => {
  it('저장했다 읽으면 그대로다', () => {
    expect(readPresets(writePresets(BANNER_SPECS))).toEqual(BANNER_SPECS)
  })

  it('한 줄이 어긋나도 나머지는 산다', () => {
    // 다섯 중 하나의 오타로 넷까지 사라지면 그건 편집이 아니라 사고다.
    const raw = [
      { label: '작은 사각', width: 178, height: 90, siblings: [] },
      { label: '망가진 줄', width: 'x', height: 90, siblings: [] },
      { label: '얇은 가로 띠', width: 1020, height: 70, siblings: [{ width: 840, height: 78 }] },
    ]
    const read = readPresets(raw)
    expect(read.map((s) => s.id)).toEqual(['178x90', '1020x70'])
  })

  it('같은 크기를 두 번 적으면 하나만 남는다', () => {
    // 버튼이 둘 다 같은 배너 페이지를 가리키면, 누른 사람은 하나가 안 먹은 줄 안다.
    const read = readPresets([
      { label: '가', width: 178, height: 90, siblings: [] },
      { label: '나', width: 178, height: 90, siblings: [] },
    ])
    expect(read).toHaveLength(1)
  })

  it('읽을 것이 없으면 적어 준 다섯으로 돌아간다', () => {
    // 되돌릴 길이 없는 편집은 만들지 않는다.
    expect(readPresets(null)).toEqual(BANNER_SPECS)
    expect(readPresets([])).toEqual(BANNER_SPECS)
    expect(readPresets([{ width: 0, height: 0 }])).toEqual(BANNER_SPECS)
  })
})
