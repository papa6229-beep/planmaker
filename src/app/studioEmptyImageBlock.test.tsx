/**
 * 빈 이미지 블록도 더블클릭으로 제품 이미지를 받는다 (손검수 Patch 2).
 *
 * 작업판에서 이미지 블록이 하는 일은 하나다: **실제로 쓸 제품 이미지를 여기 건다.**
 * 그런데 지금은 작성자가 참고 캡처를 붙여 둔 블록만 더블클릭이 통했다. 기획서에
 * 설명만 있고 그림이 없는 자리 — 정작 작업자가 채워야 할 바로 그 자리 — 는
 * 더블클릭하면 설명 편집이 열렸다.
 *
 * 참고 캡처가 있느냐 없느냐는 작성자 쪽 사정이고, 작업자가 할 일은 두 경우 모두
 * 같다. 그래서 작업판에서는 그림이 있든 없든 같은 자리를 연다.
 *
 * 작성기의 뜻은 건드리지 않는다 — 거기서 붙이는 그림은 여전히 참고용이고, 빈
 * 이미지 블록을 더블클릭하면 여전히 설명을 적는다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, getAllAssets, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { createStudioJob, linkProductImage, withSource } from '../domain/studioJob'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { documentFingerprint } from '../domain/documentFingerprint'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
}))

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/**
 * 이미지 자리 셋:
 *  - `blk_empty` — 설명만 있고 그림은 없다 (손검수에서 막혔던 자리)
 *  - `blk_ref`   — 작성자의 참고 캡처가 붙어 있다
 *  - `blk_linked`— 이미 제품 이미지가 걸려 있다
 */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('빈 자리 손검수'))
  const slot = (id: string, content: string, y: number, assetId?: string) =>
    createBlock('main_product_image', {
      id,
      content,
      position: { x: 100, y, width: 400, height: 200 },
      ...(assetId === undefined ? {} : { assetId, image: { referenceOnly: true as const } }),
    })
  doc.pages[0]!.blocks = [
    slot('blk_empty', '여기에 신제품 정면 컷', 80),
    slot('blk_ref', '참고 캡처가 있는 자리', 340, 'asset_ref'),
    slot('blk_linked', '이미 연결된 자리', 600),
    createBlock('free_text', { id: 'blk_text', content: '여름 감사제', position: { x: 100, y: 860, width: 400, height: 90 } }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  doc.assets = []
  return doc
}

function readyJob() {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  return linkProductImage(job, 'blk_linked', 'asset_old')
}

/** 브라우저가 실제로 여는 대신, 몇 번 열렸는지만 센다. */
let pickerOpens = 0

beforeEach(async () => {
  pickerOpens = 0
  const realClick = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function patched(this: HTMLInputElement) {
    if (this.type === 'file') {
      pickerOpens += 1
      return
    }
    realClick.call(this)
  }

  sessionStorage.clear()
  localStorage.clear()
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
  await saveStudioJob(readyJob())
  await putAsset(storedAsset('asset_ref', 1))
  await putAsset(storedAsset('asset_old', 2))
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('빈 자리 손검수')
  }, { timeout: 8000 })
}

async function openWriter(): Promise<void> {
  localStorage.setItem('planmaker.selected-team', 'marketing')
  render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <AppRoutes surface="brief-writer" />
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.querySelector('.canvas__sheet')).toBeTruthy(), { timeout: 8000 })
}

/**
 * 화면 위의 그 카드. id는 화면에 없으므로 사람이 읽는 글로 찾는다.
 *
 * 실제 제품 이미지가 걸린 자리는 설명을 그리지 않으므로 (긴급 Patch §1) 접근
 * 이름도 함께 본다 — 그 이름에는 블록에 적힌 글이 그대로 남는다.
 */
function card(text: string): HTMLElement {
  const found = [...document.querySelectorAll('.block-card')].find(
    (c) => c.textContent?.includes(text) || (c.getAttribute('aria-label') ?? '').includes(text),
  )
  expect(found, `"${text}" 카드를 찾지 못함`).toBeTruthy()
  return found as HTMLElement
}

function fileOf(host: HTMLElement): HTMLInputElement {
  return host.querySelector('input[type="file"]') as HTMLInputElement
}

const pngFile = (name: string, seed: number): File =>
  new File([new Uint8Array([137, 80, 78, 71, seed])], name, { type: 'image/png' })

async function jobNow() {
  return (await loadStudioJob(STUDIO_JOB_ID))!
}

// ── 빈 자리도 같은 자리를 연다 ───────────────────────────────────────────────

describe('Patch 2 §9·§10 빈 이미지 블록 더블클릭', () => {
  it('opens the picker on a block that has no picture yet', async () => {
    await openStudio()
    fireEvent.doubleClick(card('여기에 신제품 정면 컷'))
    expect(pickerOpens).toBe(1)
    // 설명 편집으로 새지 않는다.
    expect(card('여기에 신제품 정면 컷').querySelector('textarea')).toBeNull()
  }, 25000)

  it('still opens the picker on a block that has a reference capture', async () => {
    await openStudio()
    fireEvent.doubleClick(card('참고 캡처가 있는 자리'))
    expect(pickerOpens).toBe(1)
  }, 25000)

  it('opens it exactly once per double-click', async () => {
    await openStudio()
    fireEvent.doubleClick(card('여기에 신제품 정면 컷'))
    expect(pickerOpens).toBe(1)
    fireEvent.doubleClick(card('여기에 신제품 정면 컷'))
    expect(pickerOpens).toBe(2)
  }, 25000)

  it('links what was chosen as the real product image, keeping the brief intact', async () => {
    await openStudio()
    const before = await jobNow()
    const fingerprintBefore = documentFingerprint(before.doc)

    const target = card('여기에 신제품 정면 컷')
    fireEvent.doubleClick(target)
    fireEvent.change(fileOf(target), { target: { files: [pngFile('cut.png', 7)] } })

    await waitFor(async () => {
      expect((await jobNow()).productImages.blk_empty).toBeDefined()
    }, { timeout: 8000 })

    const after = await jobNow()
    // 기획서 문서는 한 글자도 달라지지 않는다 — 연결은 Studio 작업에만 적힌다.
    expect(documentFingerprint(after.doc)).toBe(fingerprintBefore)
    const block = after.doc.pages[0]!.blocks.find((b) => b.id === 'blk_empty')!
    expect(block.content).toBe('여기에 신제품 정면 컷')
    expect(block.position).toEqual({ x: 100, y: 80, width: 400, height: 200 })
    expect(block.assetId).toBeUndefined() // 참고 캡처가 생기지 않는다
    await waitFor(() => expect(screen.getAllByAltText('실제 사용 제품 이미지').length).toBeGreaterThan(0))
  }, 25000)

  it('replaces the product image on a block that already had one', async () => {
    await openStudio()
    const target = card('이미 연결된 자리')
    fireEvent.doubleClick(target)
    fireEvent.change(fileOf(target), { target: { files: [pngFile('new.png', 9)] } })

    await waitFor(async () => {
      expect((await jobNow()).productImages.blk_linked).not.toBe('asset_old')
    }, { timeout: 8000 })
  }, 25000)

  it('keeps the reference capture when the product image lands beside it', async () => {
    await openStudio()
    const target = card('참고 캡처가 있는 자리')
    fireEvent.doubleClick(target)
    fireEvent.change(fileOf(target), { target: { files: [pngFile('real.png', 5)] } })

    await waitFor(async () => {
      expect((await jobNow()).productImages.blk_ref).toBeDefined()
    }, { timeout: 8000 })
    const after = await jobNow()
    // 참고 캡처는 문서에 그대로 남는다 — 덮어쓰지 않는다.
    expect(after.doc.pages[0]!.blocks.find((b) => b.id === 'blk_ref')!.assetId).toBe('asset_ref')
  }, 25000)

  it('changes nothing when the picker is cancelled', async () => {
    await openStudio()
    const before = await jobNow()
    const assetsBefore = (await getAllAssets()).length

    const target = card('여기에 신제품 정면 컷')
    fireEvent.doubleClick(target)
    // 파일 선택창을 그냥 닫은 것과 같다.
    fireEvent.change(fileOf(target), { target: { files: [] } })

    await new Promise((r) => setTimeout(r, 200))
    const after = await jobNow()
    expect(after.productImages).toEqual(before.productImages)
    expect(documentFingerprint(after.doc)).toBe(documentFingerprint(before.doc))
    expect((await getAllAssets()).length).toBe(assetsBefore)
  }, 25000)

  it('stores one asset for one chosen file', async () => {
    await openStudio()
    const before = (await getAllAssets()).length
    const target = card('여기에 신제품 정면 컷')
    fireEvent.doubleClick(target)
    fireEvent.change(fileOf(target), { target: { files: [pngFile('once.png', 3)] } })

    await waitFor(async () => {
      expect((await jobNow()).productImages.blk_empty).toBeDefined()
    }, { timeout: 8000 })
    expect((await getAllAssets()).length).toBe(before + 1)
  }, 25000)

  it('does not start dragging, resizing or a new block', async () => {
    await openStudio()
    const before = await jobNow()
    const target = card('여기에 신제품 정면 컷')
    fireEvent.doubleClick(target)

    const after = await jobNow()
    expect(after.doc.pages[0]!.blocks).toHaveLength(before.doc.pages[0]!.blocks.length)
    expect(after.doc.pages[0]!.blocks.find((b) => b.id === 'blk_empty')!.position).toEqual({
      x: 100, y: 80, width: 400, height: 200,
    })
  }, 25000)

  it('leaves the ⋯ menu working as before', async () => {
    await openStudio()
    fireEvent.pointerDown(card('여기에 신제품 정면 컷'), { button: 0 })
    const menu = card('여기에 신제품 정면 컷').querySelector('.block-card__menu') as HTMLDetailsElement
    expect(menu).toBeTruthy()
    menu.setAttribute('open', '')
    expect(menu.textContent).toContain('제품 이미지')
  }, 25000)
})

// ── 작성기 표면의 뜻은 그대로 ────────────────────────────────────────────────

describe('Patch 2 §12 작성기에서는 여전히 설명부터', () => {
  it('opens the description editor on an empty image block', async () => {
    await openWriter()
    // 팔레트에서 이미지 자리 하나를 놓는다.
    fireEvent.click(screen.getByRole('button', { name: '이미지' }))
    await waitFor(() => expect(document.querySelectorAll('.block-card').length).toBeGreaterThan(0))

    const block = document.querySelector('.block-card') as HTMLElement
    // 새 블록은 스스로 입력을 열어 두므로, 한 번 닫고 나서 더블클릭을 본다.
    const box = block.querySelector('textarea')
    if (box !== null) {
      fireEvent.keyDown(box, { key: 'Escape' })
      await waitFor(() => expect(block.querySelector('textarea')).toBeNull())
    }

    const opensBefore = pickerOpens
    fireEvent.doubleClick(block)
    // 작성기에서 빈 이미지 블록은 여전히 "무엇이 들어갈지" 부터 적는 자리다.
    expect(pickerOpens).toBe(opensBefore)
    await waitFor(() => expect(block.querySelector('textarea')).toBeTruthy())
  }, 25000)
})
