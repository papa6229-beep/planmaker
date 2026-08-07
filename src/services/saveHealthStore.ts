/**
 * 저장 성공·실패를 한 자리에 모은다 (저장 실패 알리기 Patch).
 *
 * 저장은 여러 곳에서 일어난다 — 기획서 자동저장, 작업판 상태, 이미지 자산.
 * 그 각각에 화면을 물려 두면 새로 생기는 저장 경로마다 배선을 빠뜨릴 수 있으므로,
 * **저장소 계층 하나가** 성공과 실패를 여기 알리고 화면은 여기만 본다.
 *
 * provider 가 아니라 모듈 하나인 이유는 순서 때문이다. 기획서 문서와 작업판은
 * 서로 다른 provider 안에 있고 둘 중 어느 쪽이 위에 있는지에 이 사실이 기대면
 * 안 된다 — 저장이 되고 있는지는 화면 구조와 상관없는 사실이다.
 */

import { HEALTHY, type SaveHealth, type SaveTarget } from '../domain/saveHealth'

let health: SaveHealth = HEALTHY
const listeners = new Set<() => void>()

function publish(next: SaveHealth): void {
  // 같은 사실이면 새 객체를 만들지 않는다. `useSyncExternalStore`는 참조로
  // 견주므로, 매번 새 객체를 주면 저장할 때마다 화면이 다시 그려진다 — 생성
  // 도중에 그런 다시 그리기가 일어나면 만들던 오브젝트를 잃는다.
  if (next.failure === health.failure) return
  health = next
  for (const listen of listeners) listen()
}

export function saveHealth(): SaveHealth {
  return health
}

export function subscribeSaveHealth(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 한 번이라도 쓰기에 성공하면 실패는 지워진다. 저장소가 다시 받아 주기 시작한
 * 뒤에도 빨간 배지가 남아 있으면, 그 배지는 곧 아무도 읽지 않는 장식이 된다.
 *
 * 이미 건강하면 **아무 일도 하지 않는다**. 저장은 잦고, 잦은 일이 화면을 흔들면
 * 안 된다.
 */
export function reportSaveOk(): void {
  if (health.failure === null) return
  publish({ failure: null })
}

export function reportSaveFailed(target: SaveTarget, error: unknown, now: number): void {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  publish({ failure: { target, at: now, reason } })
}

/** 검사 이음매 — 한 검사의 실패가 다음 검사로 새지 않게 한다. */
export function resetSaveHealthForTests(): void {
  health = HEALTHY
  listeners.clear()
}
