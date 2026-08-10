/**
 * 테스트용 OpenAI API 키의 보관 범위 (1단계 키 교정 §2, 키 기억하기 Patch).
 *
 * 이 파일이 키에 대해 아는 전부이고, 키가 갈 수 있는 곳도 여기가 전부다.
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

export const API_KEY_STORAGE_KEY = 'planmaker.openai-key'

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
