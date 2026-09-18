/**
 * 접속하면 빈 작업판에서 시작한다 (2026-09-18, 사용자 지시).
 *
 * 작업판은 작업 한 건을 이 브라우저에 계속 덮어쓰며 저장하고, 화면이 열릴 때
 * 그것을 다시 읽어 왔다. 혼자 쓰는 도구라면 편하지만 이 도구는 **여러 사람이
 * 각자의 컴퓨터에서** 쓴다. 남의 작업이 남아 있는 화면에서 시작하는 것보다
 * 빈 화면에서 시작하는 편이 낫고, 남길 것은 `작업 파일 저장`으로 각자 파일로
 * 관리한다 — 사용자 결정이다. 그래서 여기서는 옆에 치워 두지 않고 지운다.
 *
 * **새로고침은 접속이 아니다.** 배포 뒤 `Ctrl+Shift+R`로 새 화면을 받으라는
 * 안내가 있어서, 새로고침이 화면을 비우면 작업 중인 사람이 만들던 것을 잃는다.
 * 그래서 "이 탭이 작업판을 처음 여는가"로 가른다:
 *
 *  - 탭에 표시가 없다 → 링크를 새로 열었거나 브라우저를 닫았다 연 것 = **접속**. 비운다
 *  - 표시가 있다 → 같은 탭에서 다시 그린 것 = **새로고침**. 하던 것을 지킨다
 *
 * `sessionStorage`를 쓰는 이유가 그것이다. 새로고침에는 살아남고 탭을 닫으면
 * 사라지는 저장소는 이것뿐이다. 읽지 못하는 환경(사생활 보호 창 등)에서는
 * "접속이 아니다"로 본다 — 판단이 서지 않을 때 지우지 않는 쪽이 안전하다.
 *
 * 지우는 것은 작업판의 작업과 그 작업만 쓰는 이미지뿐이다. 기획서 작성기의
 * 보관함과 전달받은 자료는 건드리지 않는다 (`resetStudioStorage`의 경계).
 */

import { resetStudioStorage } from './storageReset'

/** 이 탭이 작업판을 이미 열었음을 적어 두는 자리. */
const VISIT_KEY = 'planmaker.studio.visited'

/**
 * 이번 그리기가 새 접속인가. 묻는 김에 표시도 남긴다.
 *
 * 표시를 남기지 못하면(저장소를 못 쓰는 창) 매 새로고침이 접속으로 보여 작업이
 * 사라질 수 있으므로, 그때는 접속이 아니라고 답한다.
 */
export function takeFreshVisit(): boolean {
  let store: Storage
  try {
    if (typeof window === 'undefined') return false
    store = window.sessionStorage
    if (store.getItem(VISIT_KEY) === '1') return false
    store.setItem(VISIT_KEY, '1')
  } catch {
    return false
  }
  return true
}

/**
 * 새 접속이면 작업판을 비운다. 화면을 세우기 **전에** 기다려야 한다 — 먼저
 * 그리면 옛 작업이 한 번 보였다가 사라진다.
 */
export async function clearStudioOnFreshVisit(): Promise<void> {
  if (!takeFreshVisit()) return
  try {
    await resetStudioStorage()
  } catch {
    // 저장소를 비우지 못해도 화면은 떠야 한다. 이 경우 옛 작업이 보인다.
  }
}
