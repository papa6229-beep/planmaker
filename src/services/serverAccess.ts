/**
 * 서버가 지키는 두 가지 — **키가 어디서 오는가**와 **누가 부를 수 있는가**
 * (서버 키 Patch).
 *
 * 이 파일이 그 둘을 아는 유일한 곳이다. `handleGenerateImage`도
 * `handleRefineInstruction`도 여기에 묻기만 하고, 답이 `ok`가 아니면 OpenAI를
 * 부르지 않는다.
 *
 * ## 규칙은 세 줄이다
 *
 *  1. 서버에 키가 있으면 **서버 키**를 쓴다. 요청에 실려 온 키는 무시한다.
 *  2. 서버 키를 쓸 때는 **암구호가 맞아야** 한다. 암구호를 정해 두지 않았으면
 *     아예 거절한다 — 잠기지 않은 채로 열어 두지 않는다.
 *  3. 서버에 키가 없으면 지금까지처럼 **요청 헤더의 키**를 쓴다. 이때는 암구호를
 *     묻지 않는다 — 자기 키로 자기 돈을 쓰는 사람을 막을 이유가 없다.
 *
 * 2번이 이 파일에서 가장 중요한 줄이다. 환경변수를 하나만 넣고 만 배포는
 * "조용히 열린 생성기"가 되고, 그 사실은 요금이 청구되기 전까지 아무 데도
 * 드러나지 않는다. 그래서 **막고, 화면에 그렇게 말한다.** 설정이 덜 끝난 배포는
 * 눈에 띄게 고장 나는 편이 낫다.
 *
 * ## 환경변수를 밖에서 받는 이유
 *
 * `process.env`를 여기서 직접 읽지 않는다. 읽으면 검사가 검사를 돌리는 사람의
 * 컴퓨터에 딸린 환경변수에 따라 다른 길로 가게 된다 — `OPENAI_API_KEY`가 켜져
 * 있는 노트북에서만 빨개지는 검사만큼 쓸모없는 것이 없다. 환경을 읽는 일은
 * `api/*.ts` 한 줄이 맡고, 여기는 받은 값만 본다.
 *
 * ## 나중에 이식할 때
 *
 * `resolveApiKey` 하나만 사내 비밀 저장소를 보게 바꾸고, 암구호 비교 자리를
 * 사내 인증(SSO 세션·사번 헤더·mTLS)으로 바꾸면 된다. 부르는 쪽은 손대지 않는다.
 */

import { ACCESS_CODE_HEADER, decodeAccessCode, type AccessMode } from '../domain/serverAccess.js'
import { API_KEY_HEADER } from '../domain/imageGeneration.js'

/**
 * 이 문 앞에서 나올 수 있는 실패 셋.
 *
 * 이미지 쪽과 지시 다듬기 쪽은 오류 코드 목록이 따로다. 이 셋을 **양쪽 목록에
 * 모두** 넣어 두면, 두 handler가 같은 답을 각자의 말로 옮기는 변환 없이 그대로
 * 쓸 수 있다 — 옮기는 자리가 생기면 한쪽만 고쳐지는 날이 온다.
 */
export type AccessFailureCode = 'missing_api_key' | 'access_denied' | 'server_not_configured'

/** 서버가 쥔 값. 없는 것과 빈 문자열은 같은 뜻이다. */
export interface ServerEnv {
  apiKey?: string | undefined
  accessCode?: string | undefined
}

/** 환경변수에서 쓸 것만 골라 다듬는다. 공백만 있는 값은 없는 것과 같다. */
export function readServerEnv(env: Record<string, string | undefined>): ServerEnv {
  const apiKey = env.OPENAI_API_KEY?.trim()
  const accessCode = env.PLANMAKER_ACCESS_CODE?.trim()
  return {
    ...(apiKey !== undefined && apiKey.length > 0 ? { apiKey } : {}),
    ...(accessCode !== undefined && accessCode.length > 0 ? { accessCode } : {}),
  }
}

/** 이 배포는 어느 갈래인가. 브라우저에게 알려 줄 수 있는 유일한 사실이다. */
export function accessModeOf(env: ServerEnv): AccessMode {
  return env.apiKey === undefined ? 'client-key' : 'server-key'
}

/**
 * 두 비밀이 같은가 — **길이를 먼저 보고, 그 다음 전부 본다.**
 *
 * 첫 글자가 틀린 순간 돌아가면 걸린 시간이 "몇 글자까지 맞았는가"를 알려 준다.
 * 암구호는 짧고 사람이 정하므로 그 정도 실마리도 아깝다. 표준 라이브러리의
 * `timingSafeEqual`을 쓰지 않는 것은 이 파일이 Node에만 매이지 않게 하기
 * 위해서다 — 이식할 곳의 런타임이 무엇일지 지금은 모른다.
 */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type AccessResult =
  | { ok: true; apiKey: string; source: AccessMode }
  | { ok: false; code: AccessFailureCode; status: number }

/**
 * 이 요청이 쓸 키. `ok`가 아니면 **공급자를 부르지 않는다.**
 *
 * 돌려주는 실패에는 서버가 쥔 값이 한 글자도 담기지 않는다 — 암구호가 틀렸다는
 * 사실만 나가고, 맞는 암구호가 무엇인지도 길이도 나가지 않는다.
 */
export function resolveApiKey(request: Request, env: ServerEnv): AccessResult {
  const serverKey = env.apiKey
  if (serverKey !== undefined) {
    // 잠금장치 없이 남의 키를 열어 두지 않는다.
    if (env.accessCode === undefined) return { ok: false, code: 'server_not_configured', status: 503 }
    // 헤더에는 퍼센트 인코딩을 씌워 온다 — 한글 암구호도 실릴 수 있게 (한글
    // 암구호 교정). 벗긴 뒤에 비교한다.
    const given = decodeAccessCode(request.headers.get(ACCESS_CODE_HEADER)?.trim() ?? '')
    if (given.length === 0 || !sameSecret(given, env.accessCode)) {
      return { ok: false, code: 'access_denied', status: 401 }
    }
    return { ok: true, apiKey: serverKey, source: 'server-key' }
  }

  const given = request.headers.get(API_KEY_HEADER)?.trim()
  if (given === undefined || given.length === 0) {
    return { ok: false, code: 'missing_api_key', status: 400 }
  }
  return { ok: true, apiKey: given, source: 'client-key' }
}
