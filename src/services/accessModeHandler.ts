/**
 * "이 배포는 어느 갈래인가" 한 줄 (서버 키 Patch).
 *
 * 브라우저는 화면을 그리기 전에 이것을 묻는다 — 키를 달라고 할지, 암구호를
 * 달라고 할지 정해야 하기 때문이다.
 *
 * 내보내는 것은 **갈래 하나뿐**이다. 키도, 암구호도, 암구호의 길이도, 환경변수
 * 이름도 나가지 않는다. "서버에 키가 있다"는 사실은 어차피 첫 요청이면 드러나고,
 * 그것을 숨겨서 얻는 것은 없다 — 대신 숨기면 팀원 화면이 엉뚱한 칸을 띄운다.
 */

import { accessModeOf, type ServerEnv } from './serverAccess.js'
import type { AccessModeReply } from '../domain/serverAccess.js'

export function handleAccessMode(env: ServerEnv): Response {
  const body: AccessModeReply = { mode: accessModeOf(env) }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // 갈래는 배포 설정이 바뀌면 바뀐다. 캐시에 얼려 두면 환경변수를 고친 뒤에도
      // 옛 화면이 남는다.
      'cache-control': 'no-store',
    },
  })
}
