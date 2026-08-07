/**
 * 아무도 부르지 않는 것이 남아 있는가 (훑기 §1).
 *
 * 이번 훑기에서 21개가 나왔다 — 화면에서 사라진 팔레트의 라벨 표 다섯, 쓰지 않는
 * 컴포넌트 둘, 지난 판의 검증 함수, 저장소의 위험한 헬퍼(`replaceAssets`,
 * 주석에 "import 에는 절대 쓰지 말 것"이라 적힌 채 남아 있던 것), 같은 일을 하는
 * 함수 둘 중 하나. 어느 것도 고장을 내지 않았다. 다만 다음 사람에게 **거짓말**을
 * 한다 — "이것도 쓰이는 길이 있다", "이 표를 고치면 화면이 달라진다".
 *
 * 한 번 걷어내는 것으로는 다시 쌓인다. 그래서 걷어낸 자리에 이 검사를 둔다.
 *
 * 판정은 좁다. **아무 데서도** 부르지 않는 것만 잡는다 — 제품 코드, 검사, 서버
 * 함수(`api/`) 어디에도 없는 것. 검사만 쓰는 것(`resetStudioStoreForTests` 같은
 * 이음매)은 부르는 곳이 있으므로 잡지 않는다.
 *
 * 이름만 보는 검사라 완벽하지 않다 — 같은 이름이 다른 파일에 있으면 서로를
 * 살려 준다. 그 대신 오탐이 없다: 여기 걸리는 것은 정말로 아무도 안 부른다.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 부르는 곳이 없어도 두는 것 — 전부 **이유가 있다**.
 *
 * 비워 두는 것이 맞다. 여기 이름을 적는 순간 그것은 판단이 되고, 판단은 나중에
 * 읽을 수 있어야 한다. "언젠가 쓸지도 모른다"는 이유가 아니다.
 */
const INTENTIONAL: Record<string, string> = {}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const EXPORTED = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm

interface Scan {
  /** 이름 → 그것을 export 한 파일들. */
  owners: Map<string, string[]>
  prod: Map<string, string>
  other: string[]
}

function scan(): Scan {
  const all = sourceFiles('src')
  const prodPaths = all.filter((p) => !p.includes('.test.'))
  const owners = new Map<string, string[]>()
  const prod = new Map<string, string>()
  for (const path of prodPaths) {
    const text = readFileSync(path, 'utf8')
    prod.set(path, text)
    for (const m of text.matchAll(EXPORTED)) {
      const name = m[1]!
      owners.set(name, [...(owners.get(name) ?? []), path])
    }
  }
  // 부르는 쪽이 될 수 있는 나머지 — 검사와 서버 함수.
  const other = all.filter((p) => p.includes('.test.')).map((p) => readFileSync(p, 'utf8'))
  if (existsSync('api')) {
    for (const path of sourceFiles('api')) other.push(readFileSync(path, 'utf8'))
  }
  return { owners, prod, other }
}

describe('§25 부르는 곳이 없는 export', () => {
  it('아무 데서도 부르지 않는 것이 남아 있지 않다', () => {
    const { owners, prod, other } = scan()
    const dead: string[] = []

    for (const [name, ownerPaths] of owners) {
      if (name in INTENTIONAL) continue
      const uses = new RegExp(String.raw`\b${name}\b`, 'g')
      let count = 0
      for (const [path, text] of prod) {
        const hits = text.match(uses)?.length ?? 0
        // 자기를 export 한 파일에서는 그 한 줄을 빼고 센다.
        count += ownerPaths.includes(path) ? Math.max(0, hits - 1) : hits
      }
      for (const text of other) count += text.match(uses)?.length ?? 0
      if (count === 0) dead.push(`${ownerPaths[0]}: ${name}`)
    }

    // 실패하면 부르는 곳이 없는 것이 생긴 것이다. 지우거나, 부르는 곳을 만들거나,
    // 두어야 할 이유가 있으면 `INTENTIONAL`에 그 이유와 함께 적는다.
    expect(dead.toSorted()).toEqual([])
  })

  it('허용 목록에 남은 이름이 실제로 있다', () => {
    const { owners } = scan()
    // 지운 이름이 목록에 남아 있으면, 그 목록은 곧 아무도 안 읽는 낡은 종이가 된다.
    expect(Object.keys(INTENTIONAL).filter((name) => !owners.has(name))).toEqual([])
  })
})
