/**
 * 화면에 쓴 클래스 이름에 스타일이 있는가 (그물 치기 §1).
 *
 * 오늘 두 번 같은 자리에서 샜다. `paper-tune__thumb`을 JSX에 쓰고 CSS를 빼먹어
 * 제품 원본이 원래 크기로 펼쳐졌고, 그 바람에 종이 테두리 슬라이더가 화면 밖으로
 * 밀려 나갔다. 검사는 하나도 실패하지 않았다 — **jsdom에는 레이아웃이 없어서**
 * 스타일이 있는지 없는지 볼 방법이 애초에 없기 때문이다.
 *
 * 레이아웃은 못 봐도 **이름이 짝지어졌는지는 볼 수 있다.** 이 검사가 하는 일은
 * 그것 하나다: 화면 코드가 쓴 클래스 이름을 전부 긁어서, `global.css`에 그 이름의
 * 규칙이 있는지 대조한다.
 *
 * 잡는 것과 못 잡는 것을 분명히 해 둔다.
 *
 *  - **잡는다**: 클래스를 새로 쓰고 스타일을 빼먹은 것 (오늘의 썸네일 사고)
 *  - **못 잡는다**: 규칙은 있는데 값이 틀린 것 (오늘의 우측 패널 눌림 사고).
 *    그건 실제 브라우저에서만 판정된다 — 확인 목록으로 사람에게 넘긴다.
 *
 * 규칙이 필요 없는 이름은 아래 `INTENTIONAL`에 **이유와 함께** 적는다. 조용히
 * 통과시키지 않는 것이 요점이다 — 목록에 적히는 순간 그것은 판단이 되고, 판단은
 * 나중에 읽을 수 있다.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CSS_PATH = 'src/styles/global.css'

/**
 * 규칙이 없어도 되는 이름 — 전부 **이유가 있다**.
 *
 * 대부분 `<header>`·`<section>`·감싸는 `<div>` 같은 껍데기다. 형제(`__title`,
 * `__actions`)는 스타일이 있고 자기는 필요 없는 자리라, 규칙을 지어내면 오히려
 * 화면이 달라진다. 이름을 지우지 않는 것은 짜임새를 읽는 단서이기 때문이다.
 */
const INTENTIONAL: Record<string, string> = {
  'confirm__title': '확인창 제목 <h2>. 형제(__text·__actions)만 규칙을 갖고, 제목은 기본 활자를 쓴다.',
  'edit-panel__head': '부분수정 패널의 <header> 껍데기. 안쪽 제목·설명이 규칙을 갖는다.',
  'page-header__text': '페이지 머리의 글 묶음 <div>. 부모가 flex라 이 껍데기는 규칙이 필요 없다.',
  'badge__label': '배지의 글자 <span>. 배지 자체와 __value가 규칙을 갖는다.',
  'library__group': '보관함 묶음 <section>. 부모 __groups가 간격을 정하고 __group-title이 활자를 정한다.',
  'brief-requests': '전달한 요청 <section> 껍데기. 안쪽 __title이 규칙을 갖는다.',
  'effects__details': '세부 조정 <details> 껍데기. __summary와 __sliders가 규칙을 갖는다.',
  'gen-dialog': '생성 확인창의 이름표. 같은 자리에 confirm·confirm--scrollable이 규칙을 갖고, 자식 __targets가 이 이름을 쓴다.',
  'page-note': '팀 선택으로 돌아가는 한 줄. 기본 활자 그대로 쓴다.',
  'is-saved': 'API 키가 저장됐다는 **검사용 표식**. 보이는 변화는 btn--key-saved가 맡는다.',
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) tsxFiles(full, out)
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

/**
 * 이 파일이 쓰는 클래스 이름 → 처음 나온 자리.
 *
 * `className="a b"`와 `className={`a ${x} b`}` 둘 다 읽는다. 비교에 쓰인 문자열
 * (`fit === 'page'`)은 클래스가 아니므로 뺀다 — 안 빼면 `page`·`brief` 같은
 * 낱말이 클래스로 잡혀 검사가 거짓으로 실패한다.
 */
function classesIn(source: string, file: string, into: Map<string, string>): void {
  const attr = /className\s*=\s*/g
  // 값 자체는 필요 없다 — 어디서 끝났는지(`lastIndex`)만 쓴다.
  while (attr.exec(source) !== null) {
    let i = attr.lastIndex
    let value = ''
    if (source[i] === '"') {
      const end = source.indexOf('"', i + 1)
      if (end < 0) break
      value = source.slice(i, end + 1)
      attr.lastIndex = end + 1
    } else if (source[i] === '{') {
      let depth = 0
      let j = i
      for (; j < source.length; j += 1) {
        if (source[j] === '{') depth += 1
        else if (source[j] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      value = source.slice(i, j + 1)
      attr.lastIndex = j + 1
    } else continue

    for (const literal of value.matchAll(/(["'`])([^"'`]*)\1/g)) {
      const before = value.slice(0, literal.index).trimEnd()
      if (/[=!]==?$/.test(before)) continue
      if (/\.(includes|startsWith|endsWith)\($/.test(before)) continue
      for (const token of (literal[2] ?? '').split(/\s+/)) {
        if (/^[A-Za-z][\w-]*$/.test(token) && !into.has(token)) into.set(token, file)
      }
    }
  }
}

describe('화면이 쓴 클래스에는 스타일이 있다', () => {
  const used = new Map<string, string>()
  for (const file of tsxFiles('src')) classesIn(readFileSync(file, 'utf8'), file, used)
  const css = readFileSync(CSS_PATH, 'utf8')
  const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1] as string))

  it('스타일 없는 클래스는 허용 목록에 이유가 적혀 있다', () => {
    const orphans = [...used]
      .filter(([name]) => !defined.has(name) && INTENTIONAL[name] === undefined)
      .map(([name, file]) => `${name}  ←  ${file}`)
    // 실패하면 둘 중 하나다. `global.css`에 규칙을 넣거나, 규칙이 필요 없는
    // 이름이라면 위 INTENTIONAL에 **이유와 함께** 적는다.
    expect(orphans).toEqual([])
  })

  it('허용 목록에 죽은 항목이 남지 않는다', () => {
    // 이름을 지웠거나 스타일을 나중에 넣었으면 목록에서도 빠져야 한다. 안 빼면
    // 목록이 자라기만 하고 아무도 읽지 않는 종이가 된다.
    const stale = Object.keys(INTENTIONAL).filter((name) => !used.has(name) || defined.has(name))
    expect(stale).toEqual([])
  })

  it('읽을 것이 실제로 있다 — 검사가 조용히 비어 버리지 않게', () => {
    expect(used.size).toBeGreaterThan(200)
    expect(defined.size).toBeGreaterThan(200)
  })
})

/**
 * 왼쪽 칸의 바닥 (전달 누락 Patch).
 *
 * jsdom에는 배치가 없어 "팔레트가 짓눌렸는가"를 픽셀로 잴 수 없다. 그래서 규칙
 * 자체를 붙든다 — 짓눌림을 막는 것은 `min-height` 한 줄이고, 그 줄이 사라지면
 * 세로가 짧은 화면에서 `무엇을 넣을까요?`가 다시 한 줄로 접힌다.
 */
describe('왼쪽 칸은 팔레트를 짓누르지 않는다', () => {
  const css = readFileSync(CSS_PATH, 'utf8')

  it('팔레트에 최소 높이가 있다', () => {
    const rule = /\.side-left \.palette \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('min-height')
    // 0은 바닥이 아니다 — 앞선 판이 `min-height: 0`이라 한 줄까지 접혔다.
    expect(/min-height:\s*0/.test(rule)).toBe(false)
  })

  it('넘치면 칸 전체가 스크롤된다', () => {
    const rule = /\.side-left \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('overflow-y: auto')
  })
})
