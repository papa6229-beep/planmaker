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
/**
 * 지금 일하고 있는 사람 (작업자 기록 Patch).
 *
 * 팀과 같은 자리에 둔다 — 아이디도 비밀번호도 아니고, "이 기획서를 누가 만졌는가"를
 * 나중에 알아보기 위한 이름표다. 팀을 지우면 이 이름도 함께 지운다.
 */
const MEMBER_KEY = 'planmaker.selected-member'

/** 이름표에 담을 수 있는 길이. 목록 한 줄에 들어가야 한다. */
export const MEMBER_NAME_MAX = 20

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

/** 지금 일하고 있는 사람의 이름, 없으면 `null`. */
export function selectedMember(): string | null {
  try {
    const value = storage()?.getItem(MEMBER_KEY)?.trim()
    return value === undefined || value.length === 0 ? null : value
  } catch {
    return null
  }
}

export function selectMember(name: string): void {
  try {
    const trimmed = name.trim().slice(0, MEMBER_NAME_MAX)
    if (trimmed.length === 0) storage()?.removeItem(MEMBER_KEY)
    else storage()?.setItem(MEMBER_KEY, trimmed)
  } catch {
    // 저장하지 못해도 이번 방문 동안의 흐름은 그대로 이어진다.
  }
}

export function clearSelectedTeam(): void {
  try {
    storage()?.removeItem(KEY)
    // 팀을 떠나면 이름도 함께 떠난다. 남겨 두면 다음 사람의 작업에 앞사람
    // 이름이 찍힌다.
    storage()?.removeItem(MEMBER_KEY)
  } catch {
    // 지우지 못해도 게이트는 다시 팀을 물어본다.
  }
}
