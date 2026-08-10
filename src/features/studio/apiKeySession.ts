/**
 * 브라우저가 쥐는 **자격 한 줄** (1단계 키 교정 §2, 키 기억하기 Patch,
 * 서버 키 Patch).
 *
 * 배포에 따라 그 한 줄이 무엇인지가 다르다.
 *
 *  - `server-key` — 키는 서버(Vercel 환경변수)에 있다. 브라우저가 쥐는 것은
 *    **암구호**다. 키는 이 컴퓨터에 내려오지 않는다.
 *  - `client-key` — 지금까지처럼 **자기 OpenAI 키**를 쥔다.
 *
 * 어느 쪽인지는 서버에게 한 번 물어 캐시한다 (`ensureAccessMode`). 부르는 쪽은
 * 그 갈래를 몰라도 되게 `authHeaders()` 하나만 쓰면 된다 — 세 군데(생성·배경
 * 합성·지시 다듬기)가 각자 갈래를 따지기 시작하면, 한 곳을 빠뜨린 날 그 요청만
 * 조용히 인증 없이 나간다.
 *
 * 아래는 **키**에 대한 이야기이고, 그대로 유효하다.
 *
 *  - `sessionStorage` 또는 `localStorage`. **둘 중 어느 쪽인지는 사람이 고른다.**
 *  - IndexedDB·StudioJob·기획서 문서·`.eventbrief`·주소 어디에도 쓰지 않는다.
 *    그 경로가 아예 이 모듈에 없다.
 *  - 로그로 찍지 않는다. 값을 문자열로 만들어 어딘가로 넘기는 함수가 없다.
 *
 * ## 왜 고르게 하는가
 *
 * 앞선 판은 `sessionStorage` 하나였다 — 탭을 닫으면 사라진다. 안전한 기본값이지만,
 * 작업자가 실제로 겪은 것은 이랬다: "테스트할 때마다 API 키를 계속 수동으로
 * 입력하고 있는데." 하루에 몇 번씩 키를 붙여 넣는 일은 그 자체로 위험하다 — 키를
 * 어딘가 메모장에 꺼내 두게 만들기 때문이다.
 *
 * 그래서 `이 브라우저에 기억`을 켜면 `localStorage`로 간다. 브라우저를 닫아도
 * 남고, `키 지우기`를 누르거나 새 키를 넣을 때까지 그대로다. 끄면 지금까지처럼
 * 탭을 닫을 때 사라진다.
 *
 * **기억한 키는 이 브라우저를 여는 사람이면 개발자 도구로 읽을 수 있다.** 접근
 * 제한 기능이 아니다 — 브라우저 번들에 키가 들어가지 않게 하면서, 제 컴퓨터에서
 * 테스트 한 번을 사람 손으로 승인하기 위한 최소 장치다. 공용 컴퓨터에서는 켜면
 * 안 되고, 화면이 그렇게 말한다.
 *
 * 어느 쪽에 두었든 읽을 때는 **둘 다** 본다. 켜고 끄는 사이에 키를 잃지 않기
 * 위해서다.
 */

import {
  ACCESS_CODE_HEADER,
  ACCESS_MODE_PATH,
  encodeAccessCode,
  readAccessMode,
  type AccessMode,
} from '../../domain/serverAccess'
import { API_KEY_HEADER } from '../../domain/imageGeneration'

export const API_KEY_STORAGE_KEY = 'planmaker.openai-key'

/**
 * 암구호가 앉는 자리.
 *
 * 키와 달리 **언제나 이 브라우저에 남는다.** 암구호는 개인의 비밀이 아니라 팀이
 * 나눠 갖는 한 줄이고, 새어도 OpenAI 계정과 무관하며, 주인이 환경변수 한 글자만
 * 바꾸면 죽는다. 그 값을 하루에 몇 번씩 다시 넣게 만들 이유가 없다.
 */
export const ACCESS_CODE_STORAGE_KEY = 'planmaker.access-code'

function session(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    // 저장소를 못 쓰는 환경에서는 키가 없는 것과 같다.
    return null
  }
}

function local(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 이 키가 브라우저에 남아 있는가 — 탭을 닫아도 살아남는 쪽에. */
export function apiKeyRemembered(): boolean {
  try {
    return (local()?.getItem(API_KEY_STORAGE_KEY) ?? null) !== null
  } catch {
    return false
  }
}

export function readApiKey(): string | null {
  for (const store of [session(), local()]) {
    const value = store?.getItem(API_KEY_STORAGE_KEY)
    if (value !== null && value !== undefined && value.length > 0) return value
  }
  return null
}

/**
 * 키를 둔다. `remember`면 브라우저에, 아니면 이 탭에만.
 *
 * 어느 쪽에 두든 **다른 쪽은 먼저 비운다.** 둘에 남아 있으면 끈 줄 알았는데
 * 브라우저에 그대로 있는 일이 생긴다.
 */
export function saveApiKey(key: string, remember = false): void {
  const trimmed = key.trim()
  if (trimmed.length === 0) {
    clearApiKey()
    return
  }
  const [keep, drop] = remember ? [local(), session()] : [session(), local()]
  try {
    drop?.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // 못 지워도 아래에서 새 값이 덮인다.
  }
  try {
    keep?.setItem(API_KEY_STORAGE_KEY, trimmed)
  } catch {
    // 저장하지 못해도 이번 요청에는 쓸 수 있다 — 호출부가 값을 쥐고 있다.
  }
}

/** 양쪽 다 지운다. `키 지우기`가 한쪽만 지우면 지운 것이 아니다. */
export function clearApiKey(): void {
  for (const store of [session(), local()]) {
    try {
      store?.removeItem(API_KEY_STORAGE_KEY)
    } catch {
      // 이미 없는 것과 같다.
    }
  }
}

// ── 암구호와 갈래 (서버 키 Patch) ───────────────────────────────────────────

export function readAccessCode(): string | null {
  try {
    const value = local()?.getItem(ACCESS_CODE_STORAGE_KEY)
    return value === null || value === undefined || value.length === 0 ? null : value
  } catch {
    return null
  }
}

export function saveAccessCode(code: string): void {
  const trimmed = code.trim()
  if (trimmed.length === 0) {
    clearAccessCode()
    return
  }
  try {
    local()?.setItem(ACCESS_CODE_STORAGE_KEY, trimmed)
  } catch {
    // 저장하지 못해도 이번 요청에는 쓸 수 있다 — 호출부가 값을 쥐고 있다.
  }
}

export function clearAccessCode(): void {
  try {
    local()?.removeItem(ACCESS_CODE_STORAGE_KEY)
  } catch {
    // 이미 없는 것과 같다.
  }
}

/**
 * 이 배포의 갈래. 물어보기 전에는 `client-key`다 — 지금까지의 동작 그대로.
 *
 * 모듈 안에 한 벌만 둔다. 화면 상태로 두면 세 hook이 각자 물어보게 되고, 그러면
 * 같은 질문이 세 번 나가면서 셋이 서로 다른 답을 쥐는 순간이 생긴다.
 */
let cachedMode: AccessMode | null = null
let asking: Promise<AccessMode> | null = null

export function currentAccessMode(): AccessMode {
  return cachedMode ?? 'client-key'
}

/**
 * 서버에게 한 번 묻는다. 이미 물었으면 그 답을 그대로 돌려준다.
 *
 * 실패는 `client-key`다 — 서버가 죽었거나 옛 배포라 이 길이 없을 때, 브라우저가
 * 할 수 있는 안전한 일은 자기 키를 쓰는 것이다. 남의 키를 쓸 수 있다고 넘겨짚지
 * 않는다.
 */
export async function ensureAccessMode(deps: { fetch?: typeof fetch } = {}): Promise<AccessMode> {
  if (cachedMode !== null) return cachedMode
  if (asking !== null) return await asking
  const doFetch = deps.fetch ?? fetch
  asking = (async (): Promise<AccessMode> => {
    try {
      const response = await doFetch(ACCESS_MODE_PATH, { method: 'GET' })
      if (!response.ok) return 'client-key'
      return readAccessMode(await response.json())
    } catch {
      return 'client-key'
    }
  })()
  const mode = await asking
  cachedMode = mode
  asking = null
  return mode
}

/** 검사 이음매 — 한 검사가 물어 둔 답이 다음 검사로 새지 않게 한다. */
export function resetAccessModeForTests(): void {
  cachedMode = null
  asking = null
}

/**
 * 이번 요청에 붙일 자격 헤더. 쥔 것이 없으면 `null`이고, 그때는 **부르지 않는다.**
 *
 * 갈래를 따지는 곳이 여기 하나여야 하는 이유는 단순하다 — 생성·배경 합성·지시
 * 다듬기 셋이 각자 따지면, 한 곳을 고치지 않은 날 그 요청만 조용히 옛 헤더로
 * 나가고 서버는 401을 돌려준다. 그 실패는 화면에서 "암구호가 틀렸다"로 보이므로
 * 원인을 엉뚱한 데서 찾게 된다.
 */
export function authHeaders(): Record<string, string> | null {
  if (currentAccessMode() === 'server-key') {
    const code = readAccessCode()
    return code === null ? null : { [ACCESS_CODE_HEADER]: encodeAccessCode(code) }
  }
  const key = readApiKey()
  return key === null ? null : { [API_KEY_HEADER]: key }
}

/** 지금 갈래에서 쥔 자격이 있는가. 버튼을 켤지 정하는 값이다. */
export function hasCredential(): boolean {
  return authHeaders() !== null
}
