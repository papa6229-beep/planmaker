/**
 * 저장이 실제로 되고 있는가 (저장 실패 알리기 Patch).
 *
 * 상단바는 처음부터 `저장: 로컬 자동저장`이라고 적어 두고 있었다. 상태가 아니라
 * **문구**였다 — 브라우저 저장소가 가득 차서 쓰기가 실패해도 같은 자리에 같은
 * 말이 그대로 있었다. 그 말을 믿고 계속 작업하면, 사람은 저장되고 있다고 알고
 * 있는 동안 아무것도 저장되지 않는다. 조용한 실패 중에 가장 나쁜 종류다.
 *
 * 여기 있는 것은 판단뿐이다. 무엇을 어떻게 알릴지는 화면이, 언제 알릴지는
 * 저장소 계층이 정한다.
 */

/** 어느 저장이 실패했는가. 사람에게는 이름으로 말해야 한다. */
export type SaveTarget = 'brief' | 'studio' | 'asset'

export interface SaveFailure {
  target: SaveTarget
  at: number
  /** 공급자·브라우저가 준 원문. 화면에는 그대로 내보내지 않는다. */
  reason: string
}

/**
 * 담는 것은 **깨졌는가** 하나다.
 *
 * 처음에는 "마지막으로 성공한 시각"도 함께 담았다. 그 값은 어디에도 보이지 않는데
 * 저장할 때마다 달라지므로, 저장 한 번마다 화면 전체가 다시 그려졌다 — 생성
 * 도중에는 그 다시 그리기가 만들던 오브젝트를 잃게 했다. 보이지 않는 값을 상태에
 * 담으면 그 값이 바뀔 때마다 값을 치른다.
 */
export interface SaveHealth {
  /** 아직 회복되지 않은 실패. 한 번이라도 성공하면 사라진다. */
  failure: SaveFailure | null
}

export const HEALTHY: SaveHealth = { failure: null }

export function targetLabel(target: SaveTarget): string {
  if (target === 'studio') return '작업판 상태'
  if (target === 'asset') return '이미지'
  return '기획서'
}

/**
 * 브라우저가 저장 공간 때문에 거절했는가.
 *
 * 이름이 브라우저마다 다르고(`QuotaExceededError`, 크롬의 옛 이름), 어떤 곳은
 * 이름 없이 문장으로만 말한다. 셋 다 같은 사실이므로 셋 다 같은 안내를 받는다.
 */
export function isQuotaFailure(reason: string): boolean {
  const text = reason.toLowerCase()
  return (
    text.includes('quota') ||
    text.includes('storage is full') ||
    text.includes('저장 공간')
  )
}

export interface SaveStatus {
  text: string
  /** 마우스를 올렸을 때의 자세한 말. */
  detail: string
  failed: boolean
}

/**
 * 상단바에 적을 말.
 *
 * 실패했을 때 사람이 **할 수 있는 일**을 적는다. "저장 실패"만 적힌 배지는 무슨
 * 일이 났는지는 알려 주지만 무엇을 해야 하는지는 말하지 않는다. 여기서 할 수
 * 있는 일은 하나다 — 작업을 파일로 빼서 브라우저 밖에 두는 것.
 */
export function saveStatus(health: SaveHealth): SaveStatus {
  const { failure } = health
  if (failure === null) {
    return {
      text: '저장: 로컬 자동저장',
      detail: '편집 상태는 IndexedDB에 자동저장됩니다',
      failed: false,
    }
  }
  const what = targetLabel(failure.target)
  const why = isQuotaFailure(failure.reason)
    ? '브라우저 저장 공간이 가득 찼습니다.'
    : '브라우저 저장소에 쓰지 못했습니다.'
  return {
    text: '저장 실패 — 작업 파일로 빼 두세요',
    detail: `${what} 저장에 실패했습니다. ${why} 지금 작업은 이 브라우저에 남지 않습니다 — 상단의 작업 파일 저장을 눌러 파일로 내보내 주세요.`,
    failed: true,
  }
}
