/**
 * 저장이 안 되고 있으면 그렇다고 말한다 (저장 실패 알리기 Patch).
 *
 * 상단바의 `저장: 로컬 자동저장`은 상태가 아니라 **붙박이 문구**였다. 브라우저
 * 저장소가 가득 차거나 쓰기가 거절되어도 같은 자리에 같은 말이 그대로 있었고,
 * 그 말을 믿은 사람은 저장되고 있다고 알고 있는 동안 아무것도 저장하지 못한다.
 * 잃는 것을 나중에, 대개 새로고침 뒤에 안다.
 *
 * 여기서 지키는 것은 셋이다.
 *
 *  - 쓰기가 실패하면 배지가 **바뀐다**.
 *  - 실패를 알리되 **삼키지 않는다**. 이미 실패를 보고 판단하는 자리들이 있고
 *    (생성 결과 저장, 파일 채택), 그 판단이 살아 있어야 한다.
 *  - 다시 성공하면 배지가 **돌아온다**. 회복된 뒤에도 남아 있는 경고는 곧 아무도
 *    읽지 않는 장식이 된다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearAllStudioJobs, resetStudioStoreForTests, saveStudioJob, STUDIO_JOB_ID } from '../services/studioStore'
import {
  reportSaveFailed,
  reportSaveOk,
  resetSaveHealthForTests,
  saveHealth,
  subscribeSaveHealth,
} from '../services/saveHealthStore'
import { watchSave } from '../services/watchSave'
import { HEALTHY, isQuotaFailure, saveStatus, targetLabel } from '../domain/saveHealth'
import { createStudioJob, withSource } from '../domain/studioJob'
import { createEmptyDocument } from '../domain/pageSchema'
import { createEmptyProject } from '../domain/factory'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

const fetchSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch

beforeEach(async () => {
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  resetSaveHealthForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
})

describe('§24-1 배지가 무엇을 말할지 정하는 순수 판단', () => {
  it('아무 일 없으면 지금까지의 말 그대로다', () => {
    const status = saveStatus(HEALTHY)
    expect(status.text).toBe('저장: 로컬 자동저장')
    expect(status.failed).toBe(false)
  })

  it('실패하면 무엇을 해야 하는지까지 말한다', () => {
    const status = saveStatus({ failure: { target: 'studio', at: 2, reason: 'AbortError: nope' } })
    expect(status.failed).toBe(true)
    // 배지에 "저장 실패"만 적으면 무슨 일이 났는지는 알려 주지만 무엇을 해야
    // 하는지는 말하지 않는다.
    expect(status.text).toContain('작업 파일로 빼 두세요')
    expect(status.detail).toContain('작업판 상태')
    expect(status.detail).toContain('작업 파일 저장')
  })

  it('저장 공간이 찬 경우를 따로 알아본다', () => {
    expect(isQuotaFailure('QuotaExceededError: ...')).toBe(true)
    expect(isQuotaFailure('The storage is full')).toBe(true)
    expect(isQuotaFailure('NetworkError')).toBe(false)

    const full = saveStatus({ failure: { target: 'asset', at: 1, reason: 'QuotaExceededError' } })
    expect(full.detail).toContain('저장 공간이 가득 찼습니다')
  })

  it('무엇이 실패했는지 사람의 말로 부른다', () => {
    expect(targetLabel('brief')).toBe('기획서')
    expect(targetLabel('studio')).toBe('작업판 상태')
    expect(targetLabel('asset')).toBe('이미지')
  })
})

describe('§24-2 쓰기 하나를 감싸는 자리', () => {
  it('성공하면 결과를 그대로 돌려주고 상태를 되돌린다', async () => {
    reportSaveFailed('brief', new Error('앞선 실패'), 1)
    expect(saveHealth().failure).not.toBeNull()

    const value = await watchSave('brief', 5, async () => 42)
    expect(value).toBe(42)
    // 다시 성공했으므로 경고는 사라진다.
    expect(saveHealth().failure).toBeNull()
  })

  it('실패를 알리고 **그대로 다시 던진다**', async () => {
    // 여기서 삼키면 생성 결과 저장 실패·파일 채택 실패를 판정하는 자리들이
    // 조용히 성공으로 바뀐다. 알림 하나를 얻고 그보다 중요한 것을 잃는다.
    const boom = new Error('QuotaExceededError')
    await expect(watchSave('asset', 9, () => Promise.reject(boom))).rejects.toBe(boom)
    expect(saveHealth().failure?.target).toBe('asset')
    expect(saveHealth().failure?.reason).toContain('QuotaExceededError')
  })

  it('잘 되고 있을 때의 성공은 아무 값도 바꾸지 않는다', () => {
    // 이 줄이 무너지면 저장 한 번마다 화면 전체가 다시 그려진다. 실제로 그렇게
    // 만들었더니 생성 도중의 다시 그리기가 만들던 오브젝트를 잃었다.
    const first = saveHealth()
    let woken = 0
    subscribeSaveHealth(() => { woken += 1 })
    reportSaveOk()
    reportSaveOk()
    expect(saveHealth()).toBe(first)
    expect(woken).toBe(0)
  })

  it('실패했다가 성공하면 그때는 깨운다', () => {
    let woken = 0
    subscribeSaveHealth(() => { woken += 1 })
    reportSaveFailed('brief', new Error('가득 참'), 1)
    expect(woken).toBe(1)
    reportSaveOk()
    expect(woken).toBe(2)
    expect(saveHealth().failure).toBeNull()
  })
})

describe('§24-3 실제 저장이 실패하면 상단바가 달라진다', () => {
  it('작업판 저장이 거절되면 배지가 붙박이 문구를 버린다', async () => {
    const doc = createEmptyDocument(createEmptyProject('저장 실패 시험'))
    await saveStudioJob(withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1))

    render(
      <MemoryRouter initialEntries={['/studio']}>
        <AppRoutes surface="studio" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 8000 })
    // 지금은 잘 저장되고 있다.
    await waitFor(() => expect(screen.getByText('저장: 로컬 자동저장')).toBeTruthy())

    // 저장소가 더는 받지 않는다.
    await act(async () => {
      await expect(
        watchSave('studio', Date.now(), () => Promise.reject(new Error('QuotaExceededError: full'))),
      ).rejects.toThrow()
    })

    // 실패하면 배지가 **바뀐다**. 실패하면 붙박이 문구가 그대로 남은 것이다.
    const badge = await screen.findByRole('alert', {}, { timeout: 8000 })
    expect(badge.textContent).toContain('작업 파일로 빼 두세요')
    expect(badge.className).toContain('editor-topbar__status--failed')
    expect(screen.queryByText('저장: 로컬 자동저장')).toBeNull()

    // 저장소가 다시 받으면 돌아온다.
    await act(async () => {
      await watchSave('studio', Date.now(), async () => undefined)
    })
    await waitFor(() => expect(screen.getByText('저장: 로컬 자동저장')).toBeTruthy(), { timeout: 8000 })

    expect(fetchSpy).not.toHaveBeenCalled()
  }, 30000)
})
