/**
 * 작업을 잃는 문 앞에서 무엇을 잃는지 말한다 (작업 잃지 않기 Patch).
 *
 * `기획서 불러오기`는 지금 작업의 완성본을 지운다. 파일이 말하지 않은 것은 없는
 * 것으로 열어야 하므로 그 동작 자체는 옳다 — 다른 기획서를 열었는데 앞 기획서의
 * 완성본이 붙어 있으면 그것이 더 나쁘다.
 *
 * 틀린 것은 **알리는 방식**이었다. 두 군데가 동시에 샜다.
 *
 *  - 교체를 물을지 말지를 `hasUserWork(문서)` 하나로 정했다. 완성본은 기획서 문서
 *    밖에 있으므로, 문서가 비어 있으면 완성본이 몇 장이든 **묻지 않고** 지웠다.
 *  - 묻더라도 "저장하지 않은 변경 사항은 사라집니다"라고만 했다. 사라지는 것이
 *    방금 유료로 만든 완성본이라는 말은 어디에도 없었고, 저장할 길도 그 창에
 *    없었다. 실제로 이 길로 완성본을 통째로 잃었다.
 *
 * 그리고 저장은 실패할 수 있다. "저장하고 열기"가 저장 실패를 성공으로 읽으면,
 * 사람은 안전한 길을 골랐는데 결과는 가장 나쁜 쪽이 된다 — 그 경우가 이 검사에서
 * 가장 중요하다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { packageEventDocument } from '../services/eventBriefExport'
import { createStudioJob, linkProductImage, withPageResult, withSource, type StudioJob } from '../domain/studioJob'
import { toStudioFileState } from '../domain/studioFile'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { hasUserWork } from '../domain/pageOps'
import { IMAGE_MODEL, IMAGE_QUALITY } from '../domain/imageGeneration'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

const fetchSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([seed, seed + 1, seed + 2])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 3,
  }
}

function docNamed(title: string): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', { id: 'blk_a', content: '제품 컷', position: { x: 20, y: 20, width: 200, height: 200 } }),
  ]
  return doc
}

/**
 * 지금 브라우저에 열려 있는 작업 — 완성본 한 장이 있다.
 *
 * `linked`는 제품 이미지를 블록에 연결할지를 정한다. 이 환경에서는 저장소를
 * 오간 Blob 을 JSZip 이 읽지 못하므로, **연결이 있으면 저장은 반드시 실패한다**.
 * 실패 경로와 성공 경로를 둘 다 실제로 밟기 위한 손잡이다.
 */
function jobWithResult(linked: boolean): StudioJob {
  const doc = docNamed('하던 작업')
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1)
  if (linked) job = linkProductImage(job, 'blk_a', 'asset_cut')
  return withPageResult(
    job,
    {
      pageId: 'page_1',
      assetId: 'asset_made',
      model: IMAGE_MODEL,
      quality: IMAGE_QUALITY,
      requestedSize: '1024x1536',
      sourceFingerprint: 'fp',
      createdAt: 2,
      revisions: [{ assetId: 'asset_made', kind: 'initial' }],
      cursor: 0,
    },
    2,
  )
}

/** 사람이 고르는 다른 기획서 파일. */
async function otherFile(): Promise<File> {
  const doc = docNamed('다른 기획서')
  const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1)
  const pkg = await packageEventDocument({
    doc,
    assets: [],
    previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
    createdAt: new Date(0).toISOString(),
    studio: toStudioFileState(job),
  })
  return new File([pkg.blob], '다른 기획서.eventbrief', { type: 'application/zip' })
}

/** 완성본이 있는 작업이 열린 작업판을 띄우고, 파일 하나를 고른다. */
async function openStudioAndPick(linked = false): Promise<void> {
  await saveStudioJob(jobWithResult(linked))
  if (linked) await putAsset(storedAsset('asset_cut', 20))
  await putAsset(storedAsset('asset_made', 30))
  const file = await otherFile()

  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 8000 })
  fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, { target: { files: [file] } })
}

beforeEach(async () => {
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
  fetchSpy.mockReset()
})

describe('§23-1 잃을 것을 이름으로 말한다', () => {
  it('완성본이 있으면 묻고, 몇 장인지 말한다', async () => {
    await openStudioAndPick()

    const dialog = await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })
    // 실패하면 완성본을 말없이 지우는 길이 다시 열린 것이다.
    expect(dialog.textContent).toContain('완성본 1장이 사라집니다')
    expect(dialog.textContent).toContain('완성본 다시 합치기')

    // 아직 아무것도 교체되지 않았다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.results['page_1']?.assetId).toBe('asset_made')
  }, 30000)

  it('잃지 않는 길이 주 버튼이고, 지우는 쪽은 그렇다고 적혀 있다', async () => {
    await openStudioAndPick()
    await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })

    const save = screen.getByRole('button', { name: '저장하고 열기' })
    const drop = screen.getByRole('button', { name: '저장하지 않고 열기' })
    expect(save.className).toContain('btn--primary')
    expect(drop.className).toContain('btn--danger')
    expect(drop.className).not.toContain('btn--primary')
  }, 30000)

  it('기획서가 비어 있어도 완성본이 있으면 묻는다', async () => {
    // 이것이 실제로 샜던 자리다. 교체를 물을지 말지를 문서만 보고 정하면, 문서가
    // 비어 있는 작업의 완성본은 **말없이** 지워진다.
    const blank = createEmptyDocument(createEmptyProject(''))
    blank.pages[0]!.id = 'page_1'
    blank.activePageId = 'page_1'
    expect(hasUserWork(blank)).toBe(false)

    const job = withPageResult(withSource(createStudioJob(blank, 1, STUDIO_JOB_ID), blank, 1), {
      pageId: 'page_1',
      assetId: 'asset_made',
      model: IMAGE_MODEL,
      quality: IMAGE_QUALITY,
      requestedSize: '1024x1536',
      sourceFingerprint: 'fp',
      createdAt: 2,
    }, 2)
    await saveStudioJob(job)
    await putAsset(storedAsset('asset_made', 30))
    const file = await otherFile()

    render(
      <MemoryRouter initialEntries={['/studio']}>
        <AppRoutes surface="studio" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 8000 })
    fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, { target: { files: [file] } })

    const dialog = await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })
    expect(dialog.textContent).toContain('완성본 1장이 사라집니다')
    expect((await loadStudioJob(STUDIO_JOB_ID))!.results['page_1']?.assetId).toBe('asset_made')
  }, 30000)

  it('취소하면 완성본도 문서도 그대로다', async () => {
    await openStudioAndPick()
    await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })

    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '현재 작업 교체 확인' })).toBeNull())

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.results['page_1']?.assetId).toBe('asset_made')
    expect(job.doc.project.title).toBe('하던 작업')
  }, 30000)
})

describe('§23-2 저장하고 열기는 저장이 끝난 뒤에만 연다', () => {
  it('저장에 실패하면 교체하지 않고 창을 그대로 둔다', async () => {
    // 제품 이미지가 연결된 작업 — 이 환경에서는 포장이 그 원본을 읽지 못해 저장이
    // 실패한다. 실패의 이유가 무엇이든, 여기서 봐야 하는 것은 그 다음이다.
    await openStudioAndPick(true)
    await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })

    fireEvent.click(screen.getByRole('button', { name: '저장하고 열기' }))

    await waitFor(
      () => expect(screen.getByRole('alert').textContent).toContain('파일로 저장하지 못했습니다'),
      { timeout: 8000 },
    )
    // 가장 중요한 줄: 저장에 실패했으므로 **열지 않았다**.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(job.results['page_1']?.assetId).toBe('asset_made')
    expect(job.doc.project.title).toBe('하던 작업')
    // 고른 파일은 그대로 쥐고 있다 — 다시 고르지 않아도 된다.
    expect(screen.getByRole('button', { name: '저장하고 열기' })).toBeTruthy()
  }, 30000)

  it('저장에 성공하면 그때 교체한다', async () => {
    await openStudioAndPick()
    await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })

    fireEvent.click(screen.getByRole('button', { name: '저장하고 열기' }))

    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))!.doc.project.title).toBe('다른 기획서')
    }, { timeout: 12000 })
    // 새 파일은 완성본을 담지 않으므로, 열린 작업에는 완성본이 없다.
    expect(Object.keys((await loadStudioJob(STUDIO_JOB_ID))!.results)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 30000)
})

describe('§23-3 그냥 열기는 사람이 고른 뒤에만 일어난다', () => {
  it('저장하지 않고 열기를 눌러야 교체된다', async () => {
    await openStudioAndPick()
    await screen.findByRole('alertdialog', { name: '현재 작업 교체 확인' }, { timeout: 8000 })

    fireEvent.click(screen.getByRole('button', { name: '저장하지 않고 열기' }))

    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))!.doc.project.title).toBe('다른 기획서')
    }, { timeout: 12000 })
  }, 30000)
})

describe('§23-4 돌아올 수 있는 저장이 상단 바에 있다', () => {
  it('작업판 상단 바에 작업 파일 저장이 있다', async () => {
    await saveStudioJob(jobWithResult(true))
    await putAsset(storedAsset('asset_cut', 20))
    render(
      <MemoryRouter initialEntries={['/studio']}>
        <AppRoutes surface="studio" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 8000 })

    // 실패하면 돌아올 수 있는 유일한 저장이 다시 메뉴 안으로 숨은 것이다.
    //
    // 이미지 저장은 이 바에 없다 (작업 목록 Patch). 그쪽이 내놓는 것은 **지금 고른
    // 것 하나**라, 고르는 자리인 `작업 목록` 옆으로 내려갔다. 여기 남은 저장은
    // 목록의 한 줄이 아니라 작업 전부를 담는다.
    const bar = document.querySelector('.editor-topbar') as HTMLElement
    expect(bar.textContent).toContain('작업 파일 저장')
  }, 30000)
})
