/**
 * 키가 어디에 있는가 — 브라우저와 서버가 같은 말을 쓰기 위한 계약 (서버 키 Patch).
 *
 * ## 무엇을 풀려고 만들었나
 *
 * 지금까지 이미지를 만들려면 작업자가 **자기 브라우저에 OpenAI 키를 넣어야**
 * 했다. 그 말은 팀원에게 이미지를 맡기려면 키를 건네야 한다는 뜻이고, 건네는
 * 순간 그 키는 남의 `localStorage`에 남아 개발자 도구로 읽히고, 회수할 방법이
 * 없다. 작업자가 찾던 것은 그 반대였다 — "내 API를 팀원한테 공유하지 않는 방법".
 *
 * 그래서 키를 **서버(Vercel 환경변수)** 에 둔다. 브라우저는 그림과 지시만 보내고,
 * 키를 붙이는 일은 서버 함수 안에서 끝난다. 키는 번들에도, 응답에도, 팀원 화면
 * 어디에도 나오지 않는다.
 *
 * ## 그러면 아무나 부를 수 있다
 *
 * 이 사이트는 로그인이 없는 공개 주소다. 서버에 키를 두는 순간 `/api/generate-image`
 * 는 주소만 알면 누구나 부를 수 있는 생성기가 되고, 요금은 키 주인이 낸다. 그래서
 * **암구호**를 함께 둔다. 암구호는 키가 아니다 — 이 사이트에서만 통하는 문자열이라
 * 새어 나가도 OpenAI 계정과는 무관하고, 환경변수 한 글자만 바꾸면 즉시 죽는다.
 *
 * ## 두 갈래 (`AccessMode`)
 *
 *  - `server-key` — 서버에 키가 있다. 브라우저는 **암구호**를 보낸다.
 *  - `client-key` — 서버에 키가 없다. 브라우저가 **자기 키**를 보낸다 (지금까지).
 *
 * 어느 쪽인지는 서버만 안다. 브라우저는 물어보고 따른다. 물어보지 못하면
 * `client-key`로 둔다 — 판정은 어차피 서버가 하고, 브라우저가 틀린 쪽으로 기울어도
 * 나가는 것은 자기 키뿐이다.
 *
 * ## 나중에 이식할 때
 *
 * 바뀌는 곳은 서버의 두 함수뿐이다 (`src/services/serverAccess.ts`) — "키가 어디서
 * 오는가"와 "누가 부를 수 있는가". 이 파일의 계약도, 브라우저 코드도, 생성 흐름도
 * 그대로 남는다.
 */

/** 암구호가 실리는 자리. 키가 아니므로 키 헤더와 따로 둔다. */
export const ACCESS_CODE_HEADER = 'X-Planmaker-Access'

/** 브라우저가 "어느 갈래인가"를 물어보는 곳. */
export const ACCESS_MODE_PATH = '/api/access-mode'

export type AccessMode = 'server-key' | 'client-key'

export interface AccessModeReply {
  mode: AccessMode
}

/**
 * 응답을 갈래로 읽는다. 모르는 것은 전부 `client-key`다.
 *
 * 이 함수는 서버가 죽었거나, 옛 배포라 이 길이 아예 없거나, 프록시가 HTML을
 * 돌려준 경우를 모두 지난다. 그 모든 경우에 브라우저가 할 수 있는 안전한 일은
 * **자기 키를 쓰는 것**이다 — 남의 키를 쓸 수 있다고 넘겨짚지 않는다.
 */
/**
 * 암구호를 헤더에 실을 수 있는 모양으로 (한글 암구호 교정).
 *
 * HTTP 헤더 값은 바이트 하나에 한 글자다. 한글을 그대로 넣으면 `fetch`가 요청을
 * 만들기도 전에 던진다 — `Cannot convert argument to a ByteString`. 그 실패는
 * 화면에서 "네트워크 오류"로 보이므로, 암구호에 한글을 쓴 사람은 무엇이 잘못됐는지
 * 영영 알 수 없다. 암구호는 사람이 정하는 값이고 한국어로 쓰는 팀이 있다.
 *
 * 그래서 보낼 때 퍼센트 인코딩을 씌우고, 서버가 벗긴다. 값은 달라지지 않는다.
 */
export function encodeAccessCode(code: string): string {
  return encodeURIComponent(code)
}

/** 씌운 것을 벗긴다. 모양이 깨졌으면 받은 그대로 본다 — 어차피 맞지 않는다. */
export function decodeAccessCode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function readAccessMode(value: unknown): AccessMode {
  if (typeof value !== 'object' || value === null) return 'client-key'
  const mode = (value as Record<string, unknown>).mode
  return mode === 'server-key' ? 'server-key' : 'client-key'
}
