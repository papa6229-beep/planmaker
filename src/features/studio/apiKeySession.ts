/**
 * 테스트용 OpenAI API 키의 보관 범위 (1단계 키 교정 §2).
 *
 * 이 파일이 키에 대해 아는 전부이고, 키가 갈 수 있는 곳도 여기가 전부다.
 *
 *  - `sessionStorage`에만 둔다. 같은 탭의 새로고침은 넘기고, 탭을 닫으면 사라진다.
 *  - `localStorage`·IndexedDB·StudioJob·기획서 문서·`.eventbrief`·주소·저장소
 *    어디에도 쓰지 않는다. 그 경로가 아예 이 모듈에 없다.
 *  - 로그로 찍지 않는다. 값을 문자열로 만들어 어딘가로 넘기는 함수가 없다.
 *
 * 이것은 접근 제한 기능이 아니다. 브라우저 번들에 키가 들어가지 않게 하면서,
 * 테스트 한 번을 사람 손으로 승인하기 위한 최소 장치다. 나중에 회사 시스템으로
 * 옮길 때는 이 모듈을 쓰는 자리(키 공급)만 바꾸면 되고, 생성·비교 흐름은 그대로
 * 남는다.
 */

export const API_KEY_STORAGE_KEY = 'planmaker.openai-key'

function store(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    // 저장소를 못 쓰는 환경에서는 키가 없는 것과 같다.
    return null
  }
}

export function readApiKey(): string | null {
  const value = store()?.getItem(API_KEY_STORAGE_KEY)
  return value !== null && value !== undefined && value.length > 0 ? value : null
}

export function saveApiKey(key: string): void {
  const trimmed = key.trim()
  if (trimmed.length === 0) {
    clearApiKey()
    return
  }
  try {
    store()?.setItem(API_KEY_STORAGE_KEY, trimmed)
  } catch {
    // 저장하지 못해도 이번 요청에는 쓸 수 있다 — 호출부가 값을 쥐고 있다.
  }
}

export function clearApiKey(): void {
  try {
    store()?.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // 이미 없는 것과 같다.
  }
}

