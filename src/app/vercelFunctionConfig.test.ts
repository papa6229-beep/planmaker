/**
 * 배포가 실제로 통과하는지 보는 검사.
 *
 * `npm run build`가 통과해도 배포는 실패할 수 있다 — 실제로 그랬다. Vercel은
 * 프런트엔드를 빌드한 **뒤에** `api/`의 각 파일을 따로 읽어 `export const config`
 * 를 정적으로 해석하고, 그 단계에서 죽으면 배포 전체가 실패한다. 화면 쪽 게이트는
 * 그 단계를 전혀 지나가지 않으므로 초록불인 채로 배포가 깨진다.
 *
 * 그래서 여기서는 Vercel이 쓰는 바로 그 파서(`@vercel/static-config`)를 그대로
 * 불러 같은 파일을 읽는다. 우리가 다시 구현한 흉내가 아니라 같은 코드다.
 *
 * 무엇에 걸렸었나: 그 파서의 `getObject()`는 속성 하나를
 *
 *     const [nameNode, _colon, valueNode] = prop.getChildren()
 *
 * 로 읽는다. 이름·콜론·값 세 개라고 가정한 것이다. 그런데 속성 바로 위에
 * `/** … *\/` 형식의 주석이 붙으면 그 주석이 자식 하나로 먼저 들어와 자리가 한 칸씩
 * 밀리고, 값 자리에 콜론이 들어앉는다. 그 결과가 배포 로그의
 *
 *     Error: Unhandled type: "ColonToken" :
 *
 * 이다. 설명을 지우라는 뜻이 아니라, 설명을 **객체 바깥**에 두라는 뜻이다.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Project } from 'ts-morph'
import { getConfig } from '@vercel/static-config'

const API_DIR = resolve(__dirname, '../../api')

function functionFiles(): string[] {
  return readdirSync(API_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(API_DIR, name))
}

describe('Vercel 서버 함수 설정은 배포가 읽을 수 있어야 한다', () => {
  it('has at least one function to check', () => {
    expect(functionFiles().length).toBeGreaterThan(0)
  })

  for (const file of functionFiles()) {
    it(`reads ${file.split('/').pop() ?? file} the way the deployment does`, () => {
      // 배포와 같은 파서, 같은 파일. 여기서 던지면 배포도 던진다.
      const config = getConfig(new Project(), file)
      expect(config).not.toBeNull()
      // 이 단계를 통과했다는 것은 값이 정적으로 읽혔다는 뜻이다.
      expect(config).toMatchObject({ runtime: expect.any(String) })
    })
  }
})
