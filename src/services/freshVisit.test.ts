/**
 * 접속하면 빈 작업판에서 시작한다 (2026-09-18).
 *
 * 가르는 기준은 "이 탭이 작업판을 처음 여는가"다. 새 탭이면 비우고, 같은 탭의
 * 새로고침이면 지킨다. 저장소를 못 쓰는 창에서는 지우지 않는다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { takeFreshVisit, clearStudioOnFreshVisit } from './freshVisit'
import { loadStudioJob, saveStudioJob, resetStudioStoreForTests, STUDIO_JOB_ID } from './studioStore'
import { createStudioJob } from '../domain/studioJob'
import { createEmptyDocument, } from '../domain/pageSchema'
import { createEmptyProject } from '../domain/factory'

function seedJob() {
  return saveStudioJob(createStudioJob(createEmptyDocument(createEmptyProject('지난 작업')), Date.now(), STUDIO_JOB_ID))
}

beforeEach(() => {
  window.sessionStorage.clear()
  resetStudioStoreForTests()
})

describe('접속 판정', () => {
  it('탭이 처음 열면 접속이고, 두 번째부터는 새로고침이다', () => {
    expect(takeFreshVisit()).toBe(true)
    expect(takeFreshVisit()).toBe(false)
    expect(takeFreshVisit()).toBe(false)
  })

  it('표시를 남기지 못하는 창에서는 접속으로 보지 않는다 — 지우지 않는 쪽이 안전하다', () => {
    // jsdom의 sessionStorage는 프록시라 인스턴스 메서드를 갈아끼우면 값으로 저장된다.
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('사생활 보호 창')
    })
    try {
      expect(takeFreshVisit()).toBe(false)
    } finally {
      blocked.mockRestore()
    }
  })
})

describe('접속 시 비우기', () => {
  it('새 탭으로 들어오면 지난 작업이 남지 않는다', async () => {
    await seedJob()
    expect(await loadStudioJob(STUDIO_JOB_ID)).not.toBeNull()

    await clearStudioOnFreshVisit()

    expect(await loadStudioJob(STUDIO_JOB_ID)).toBeNull()
  })

  it('같은 탭의 새로고침은 하던 작업을 지킨다', async () => {
    await clearStudioOnFreshVisit() // 접속
    await seedJob() // 작업 중
    await clearStudioOnFreshVisit() // 새로고침

    expect(await loadStudioJob(STUDIO_JOB_ID)).not.toBeNull()
  })
})
