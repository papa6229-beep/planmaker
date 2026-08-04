/**
 * 이 브라우저에서 지금 일하고 있는 팀 (첫 사용 흐름 §4).
 *
 * 아이디도 비밀번호도 아니다. 보안 경계가 아니라, 한 브라우저 안에서 마케팅팀의
 * 기획서와 상품팀의 기획서를 섞지 않기 위한 표시다. 그래서 값은 기획서가 이미
 * 쓰고 있는 `Project.requestTeam`과 같은 정본(`RequestTeam`)이고, 별도의 팀
 * 목록을 만들지 않는다.
 *
 * 선택은 화면 상태가 아니라 이 브라우저의 상태이므로 `localStorage`에 둔다 —
 * 기획서 자료가 아니므로 문서 저장소(IndexedDB)에는 들어가지 않는다.
 */

import { isRequestTeam, type RequestTeam } from '../../domain/requestTeam'

const KEY = 'planmaker.selected-team'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 저장소를 막아 둔 브라우저에서도 게이트는 동작해야 한다.
    return null
  }
}

/** 지금 선택된 팀, 없으면 `null`. */
export function selectedTeam(): RequestTeam | null {
  try {
    const value = storage()?.getItem(KEY)
    return isRequestTeam(value) ? value : null
  } catch {
    return null
  }
}

export function selectTeam(team: RequestTeam): void {
  try {
    storage()?.setItem(KEY, team)
  } catch {
    // 저장하지 못해도 이번 방문 동안의 흐름은 그대로 이어진다.
  }
}

export function clearSelectedTeam(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // 지우지 못해도 게이트는 다시 팀을 물어본다.
  }
}
