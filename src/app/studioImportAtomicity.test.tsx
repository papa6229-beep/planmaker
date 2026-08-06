/**
 * 불러오기의 원자성 (Studio 파일 교정 §3).
 *
 * 파일을 여는 일은 여러 단계로 이뤄진다: 바이너리를 쓰고, 작업을 저장하고, 자산을
 * 정리하고, 화면을 바꾼다. 어느 한 단계가 실패했는데 화면과 저장소가 이미 새
 * 파일로 넘어가 있으면, 사용자는 "불러오기 실패"라는 말을 보면서 남의 작업 위에
 * 앉아 있게 된다.
 *
 * 그래서 실패할 수 있는 일은 전부 화면을 바꾸기 **전에** 끝난다. 이 검사는 그
 * 마지막 단계 중 하나를 일부러 실패시키고, 문서·Studio 작업·제품 이미지 연결이
 * 불러오기 직전과 한 글자도 다르지 않은지 본다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { packageEventDocument } from '../services/eventBriefExport'
import { createStudioJob, linkProductImage, withSource, type StudioJob } from '../domain/studioJob'
import { toStudioFileState } from '../domain/studioFile'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import type { BriefDocument } from '../domain/pageSchema'
import type { StoredAsset } from '../services/assetStore'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

/**
 * 자산 정리는 불러오기의 마지막 갈래 중 하나다. 여기에 실패를 주입해, 그 뒤에도
 * 화면과 저장소가 그대로인지 본다.
 */
const pruneFails = { value: false }
vi.mock('../services/assetStore', async () => {
  const actual = await vi.importActual<typeof import('../services/assetStore')>('../services/assetStore')
  return {
    ...actual,
    pruneAssets: async (ids: Iterable<string>) => {
      if (pruneFails.value) throw new Error('정리 실패(주입)')
      return actual.pruneAssets(ids)
    },
  }
})

/**
 * 채택은 저장과 화면 교체를 함께 한다. 그 저장 자체가 실패했을 때도 화면이
 * 넘어가지 않는지 보려면 여기에도 실패를 넣을 수 있어야 한다.
 */
const saveJobFails = { value: false }
vi.mock('../services/studioStore', async () => {
  const actual = await vi.importActual<typeof import('../services/studioStore')>('../services/studioStore')
  return {
    ...actual,
    saveStudioJob: async (job: StudioJob) => {
      if (saveJobFails.value) throw new Error('작업 저장 실패(주입)')
      return actual.saveStudioJob(job)
    },
  }
})

const store = await import('../services/assetStore')
const { clearAll, getAllAssets, putAsset, resetAssetStoreForTests } = store
const { clearAllDocuments, resetDocumentStoreForTests } = await import('../services/documentStore')
const { clearAllRequests, resetRequestStoreForTests } = await import('../services/requestStore')
const { clearAllStudioJobs, loadStudioJob, resetStudioStoreForTests, saveStudioJob, STUDIO_JOB_ID } =
  await import('../services/studioStore')

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

function docNamed(title: string, blockId: string, wording: string, assetId?: string): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  const block = createBlock('main_product_image', {
    id: blockId,
    content: wording,
    ...(assetId === undefined ? {} : { assetId }),
  })
  if (assetId !== undefined) {
    block.image = { referenceOnly: true }
    doc.assets = [{ id: assetId, fileName: `${assetId}.png`, mimeType: 'image/png' }]
  }
  doc.pages[0]!.blocks = [block]
  return doc
}

/** 이미 작업 중인 상태: 원본을 채택하고 제품 이미지를 하나 연결해 둔 작업. */
function currentJob(): StudioJob {
  const doc = docNamed('먼저 하던 작업', 'blk_current', '먼저 하던 문구', 'asset_current_ref')
  const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, '먼저.eventbrief')
  return linkProductImage(job, 'blk_current', 'asset_current_cut')
}

/**
 * 하던 작업을 저장해 두고, 그것을 열어 둔 채로, 열려고 하는 파일을 손에 쥔다.
 * 여기까지는 어느 검사에서나 같다 — 다른 것은 어느 단계를 실패시키느냐뿐이다.
 */
async function openStudioWithWork(): Promise<File> {
  const before = currentJob()
  await saveStudioJob(before)
  await putAsset(storedAsset('asset_current_ref', 1))
  await putAsset(storedAsset('asset_current_cut', 2))

  // 열려고 하는 파일 — 제품 이미지가 연결된 다른 작업.
  const incomingDoc = docNamed('새로 여는 파일', 'blk_new', '새 문구', 'asset_new_ref')
  const incomingJob = linkProductImage(
    withSource(createStudioJob(incomingDoc, 2, STUDIO_JOB_ID), incomingDoc, 2, '새.eventbrief'),
    'blk_new',
    'asset_new_cut',
  )
  const pkg = await packageEventDocument({
    doc: incomingDoc,
    assets: [storedAsset('asset_new_ref', 3), storedAsset('asset_new_cut', 4)],
    previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
    createdAt: new Date(0).toISOString(),
    studio: toStudioFileState(incomingJob),
  })

  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('먼저 하던 작업')
  }, { timeout: 8000 })

  return new File([pkg.blob], '새.eventbrief', { type: 'application/zip' })
}

/** 파일을 열고, 하던 작업을 교체하겠다고 답한다. */
async function importFile(file: File): Promise<void> {
  fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, { target: { files: [file] } })
  const replace = await screen.findByRole('button', { name: '교체' }, { timeout: 8000 })
  fireEvent.click(replace)
  await waitFor(() => expect(screen.getByText(/불러오기 실패/)).toBeTruthy(), { timeout: 8000 })
}

/** 불러오기 직전과 한 글자도 다르지 않다 — 화면도, 저장된 작업도. */
async function expectUntouched(): Promise<void> {
  expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('먼저 하던 작업')
  // 제품 이미지가 걸린 자리는 설명 글을 그리지 않으므로 (긴급 Patch §1) 블록의
  // 접근 이름을 본다 — 화면에 그 블록이 그대로 서 있다는 뜻은 같다.
  const labels = [...document.querySelectorAll('.block-card')].map((c) => c.getAttribute('aria-label') ?? '')
  expect(labels.join(' ')).toContain('먼저 하던 문구')
  expect(labels.join(' ')).not.toContain('새 문구')
  expect(document.body.textContent).not.toContain('새 문구')

  const after = (await loadStudioJob(STUDIO_JOB_ID))!
  expect(after.doc.project.title).toBe('먼저 하던 작업')
  expect(after.productImages).toEqual({ blk_current: 'asset_current_cut' })
  expect(after.source?.fileName).toBe('먼저.eventbrief')
  expect(after.doc.pages[0]!.blocks[0]!.assetId).toBe('asset_current_ref')

  // 하던 작업의 이미지는 살아 있고, 이번 불러오기가 더한 바이너리만 정리된다.
  const ids = (await getAllAssets()).map((a) => a.id)
  expect(ids).toContain('asset_current_ref')
  expect(ids).toContain('asset_current_cut')
  expect(ids).not.toContain('asset_new_cut')
}

beforeEach(async () => {
  pruneFails.value = false
  saveJobFails.value = false
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
})

describe('§3 불러오기가 실패하면 하던 작업이 그대로 남는다', () => {
  it('keeps the open document, the job and every link when the sweep fails', async () => {
    const file = await openStudioWithWork()
    pruneFails.value = true
    await importFile(file)
    await expectUntouched()
  }, 30000)

  it('keeps them when the job write itself fails', async () => {
    const file = await openStudioWithWork()
    saveJobFails.value = true
    await importFile(file)
    // 실패한 저장 뒤에도 화면이 넘어가지 않았는지 보는 것이므로, 확인은 실패를
    // 걷어낸 뒤에 한다 — 그러지 않으면 확인 자체가 저장소를 못 읽는다.
    saveJobFails.value = false
    await expectUntouched()
  }, 30000)
})
