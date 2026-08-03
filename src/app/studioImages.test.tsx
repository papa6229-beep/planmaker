/**
 * 작업판의 이미지 입력과 제작 요청의 정확성 (첫 사용 흐름 §7, §8, §9).
 *
 * 같은 정보를 두 군데에서 넣게 하면 어느 쪽이 진짜인지 아무도 모른다. 그래서
 * 작업판에서도 이미지는 이미지 블록 하나에서만 넣는다 — 다만 거기서 넣은 파일은
 * 참고 캡처가 아니라 **실제로 쓸 제품 이미지**이고, 작성자가 붙여 둔 참고 캡처는
 * 그대로 남는다.
 *
 * 제작 요청은 사람이 읽고 확인하는 화면이지 생성 버튼이 아니다. 그러니 적어도
 * 정확해야 한다: 버튼 문구가 두 번 세어지지 않고, 링크 판정이 그 버튼의 것이며,
 * 지금 화면의 문서와 원본을 비교해야 한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, getAllAssets, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearAllStudioJobs, loadStudioJob, resetStudioStoreForTests, STUDIO_JOB_ID } from '../services/studioStore'
import { createStudioJob, withSource } from '../domain/studioJob'
import { buildGenerationRequest } from '../domain/generationRequest'
import { createEmptyDocument, createPage } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { packageEventDocument } from '../services/eventBriefExport'
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

const CTA_URL = 'https://shop.example.com/goods/12345'

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/** 참고 캡처가 붙은 이미지 자리, 짝지어진 버튼과 링크, 그리고 짝 없는 버튼 하나. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('작업판 시험'))
  const slot = createBlock('main_product_image', {
    id: 'blk_image',
    label: '이미지',
    content: '니트 정면 컷이 들어갑니다',
    assetId: 'asset_ref',
    position: { x: 100, y: 200, width: 400, height: 300 },
  })
  slot.image = { referenceOnly: true }
  const linkedButton = createBlock('cta_button', {
    id: 'blk_button_linked',
    content: '지금 예약하기',
    groupId: 'grp_cta',
  })
  const url = createBlock('button_url', { id: 'blk_url', content: CTA_URL, groupId: 'grp_cta' })
  const loneButton = createBlock('cta_button', { id: 'blk_button_alone', content: '매장 찾기' })

  doc.pages[0]!.blocks = [slot, linkedButton, url, loneButton]
  doc.assets = [{ id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' }]
  return doc
}

async function briefFile(doc: BriefDocument): Promise<File> {
  const pkg = await packageEventDocument({
    doc,
    assets: [storedAsset('asset_ref', 3)],
    previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    createdAt: new Date(0).toISOString(),
  })
  return new File([pkg.blob], 'work.eventbrief', { type: 'application/zip' })
}

function pngFile(name: string, seed: number): File {
  return new File([new Uint8Array([137, 80, 78, 71, seed])], name, { type: 'image/png' })
}

async function openStudioWith(doc: BriefDocument) {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })
  const input = document.querySelector('.toolbar__file-input') as HTMLInputElement
  fireEvent.change(input, { target: { files: [await briefFile(doc)] } })
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('작업판 시험')
  }, { timeout: 6000 })
}

/** 카드의 도구 막대와 메뉴는 선택했을 때만 그려진다. */
const selectImageCard = () => fireEvent.pointerDown(imageCard(), { button: 0 })

/** 이미지 블록 카드. */
const imageCard = () => {
  const card = [...document.querySelectorAll('.block-card')].find((c) =>
    c.textContent?.includes('니트 정면 컷이 들어갑니다'),
  )
  if (!card) throw new Error('이미지 블록을 찾지 못했습니다')
  return card as HTMLElement
}

/**
 * 불러온 뒤 이미지 자리에 붙어 있는 참고 캡처의 자산 id.
 *
 * 파일 안의 id는 공용 풀에서 이미 쓰이고 있으면 새 번호를 받는다(정상 동작).
 * 그러니 "그대로 남았다"는 판정은 언제나 불러온 뒤의 값을 기준으로 한다.
 */
const referenceAssetId = async () => {
  const job = await loadStudioJob(STUDIO_JOB_ID)
  return job!.doc.pages[0]!.blocks.find((b) => b.id === 'blk_image')!.assetId
}

const attachToCard = (file: File) => {
  const input = imageCard().querySelector('.block-card__file') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
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
})

describe('§7 이미지 블록이 곧 제품 이미지 입력', () => {
  it('makes a file dropped on an image block the product image, keeping the reference', async () => {
    await openStudioWith(sampleDoc())
    const referenceId = await referenceAssetId()

    // 메뉴 문구가 역할을 말한다.
    selectImageCard()
    await waitFor(() => expect(imageCard().textContent).toContain('제품 이미지'))
    expect(imageCard().textContent).not.toContain('참고 이미지 넣기')

    attachToCard(pngFile('cutout.png', 9))
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.productImages['blk_image']).toBeDefined()
    }, { timeout: 6000 })

    const job = await loadStudioJob(STUDIO_JOB_ID)
    const productId = job!.productImages['blk_image']!
    // 작성자의 참고 캡처는 문서에 그대로 남아 있다.
    const block = job!.doc.pages[0]!.blocks.find((b) => b.id === 'blk_image')!
    expect(block.assetId).toBe(referenceId)
    expect(block.image?.referenceOnly).toBe(true)
    expect(productId).not.toBe(referenceId)
    // 캔버스는 실제 제품 이미지를 우선 보여 준다.
    await waitFor(() => expect(imageCard().textContent).toContain('실제 사용 제품 이미지'))
  }, 20000)

  it('replaces and removes the product image while the brief stays whole', async () => {
    await openStudioWith(sampleDoc())
    const referenceId = await referenceAssetId()
    attachToCard(pngFile('one.png', 9))
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages['blk_image']).toBeDefined()
    }, { timeout: 6000 })
    const first = (await loadStudioJob(STUDIO_JOB_ID))!.productImages['blk_image']

    attachToCard(pngFile('two.png', 11))
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages['blk_image']).not.toBe(first)
    }, { timeout: 6000 })

    selectImageCard()
    await waitFor(() => expect(within(imageCard()).getByRole('button', { name: '제품 이미지 제거' })).toBeTruthy())
    fireEvent.click(within(imageCard()).getByRole('button', { name: '제품 이미지 제거' }))
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages['blk_image']).toBeUndefined()
    }, { timeout: 6000 })

    // 제거해도 설명·참고 이미지·좌표·링크는 그대로다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const block = job.doc.pages[0]!.blocks.find((b) => b.id === 'blk_image')!
    expect(block.content).toBe('니트 정면 컷이 들어갑니다')
    expect(block.assetId).toBe(referenceId)
    expect(block.position).toEqual({ x: 100, y: 200, width: 400, height: 300 })
    expect(job.doc.pages[0]!.blocks.find((b) => b.id === 'blk_url')?.content).toBe(CTA_URL)
  }, 25000)

  it('lets the worker look at the reference again', async () => {
    await openStudioWith(sampleDoc())
    attachToCard(pngFile('cutout.png', 9))
    await waitFor(() => expect(imageCard().textContent).toContain('실제 사용 제품 이미지'), { timeout: 6000 })

    selectImageCard()
    await waitFor(() => expect(within(imageCard()).getByRole('button', { name: '참고 이미지 보기' })).toBeTruthy())
    fireEvent.click(within(imageCard()).getByRole('button', { name: '참고 이미지 보기' }))
    await waitFor(() => expect(imageCard().textContent).toContain('참고용 이미지'))
  }, 20000)

  it('undoes and redoes a product image change', async () => {
    await openStudioWith(sampleDoc())
    attachToCard(pngFile('cutout.png', 9))
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages['blk_image']).toBeDefined()
    }, { timeout: 6000 })

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages['blk_image']).toBeUndefined()
    }, { timeout: 6000 })

    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }))
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages['blk_image']).toBeDefined()
    }, { timeout: 6000 })
  }, 25000)
})

describe('§8 우측 패널', () => {
  it('has no second place to connect a product image', async () => {
    await openStudioWith(sampleDoc())
    expect(document.querySelector('.studio-panel')).toBeNull()
    expect(document.querySelector('.studio-slot')).toBeNull()
    expect(screen.queryByRole('complementary', { name: '제품 이미지 연결' })).toBeNull()
    // 공통 편집기의 기본 우측 패널로 돌아온다.
    expect(screen.getByRole('complementary', { name: '선택 블록 설정' })).toBeTruthy()
  }, 20000)
})

describe('§9 제작 요청의 정확성', () => {
  it('counts a button once, and judges its link by its own pair', () => {
    const doc = sampleDoc()
    const request = buildGenerationRequest(doc, createStudioJob(doc, 1), doc.pages[0]!.id)

    // 버튼 문구는 버튼 목록에만 있다.
    expect(request.design.buttons.map((b) => b.text)).toEqual(['지금 예약하기', '매장 찾기'])
    expect(request.design.texts.some((t) => t.content === '지금 예약하기')).toBe(false)
    expect(request.design.texts.some((t) => t.content === '매장 찾기')).toBe(false)

    // 링크 판정은 그 버튼의 짝에 대해서만 참이다.
    const linked = request.design.buttons.find((b) => b.blockId === 'blk_button_linked')!
    const alone = request.design.buttons.find((b) => b.blockId === 'blk_button_alone')!
    expect(linked.hasLink).toBe(true)
    expect(alone.hasLink).toBe(false)
    expect(JSON.stringify(request.design)).not.toContain(CTA_URL)
  })

  it('compares the original against the document on screen, not a saved copy', () => {
    const doc = sampleDoc()
    const job = withSource(createStudioJob(doc, 1), doc, 1)
    expect(buildGenerationRequest(doc, job, doc.pages[0]!.id).sourceChanged).toBe(false)

    // 화면에서 방금 고친 문서로 만들면 즉시 달라졌다고 말한다.
    const edited: BriefDocument = { ...doc, project: { ...doc.project, title: '지금 고친 제목' } }
    expect(buildGenerationRequest(edited, job, edited.pages[0]!.id).sourceChanged).toBe(true)
  })

  it('says plainly that nothing is generated or sent, and calls no API', async () => {
    await openStudioWith(sampleDoc())
    const preview = screen.getByRole('button', { name: 'AI 제작 요청 미리보기' }) as HTMLButtonElement
    await waitFor(() => expect(preview.disabled).toBe(false), { timeout: 6000 })
    fireEvent.click(preview)

    const dialog = await screen.findByRole('dialog', { name: 'AI 제작 요청 미리보기' })
    expect(dialog.textContent).toContain('아직 이미지를 생성하거나 외부로 전송하지 않습니다')
    expect(dialog.textContent).toContain('AI에게 전달될 제작 요청만 미리 확인합니다')
    // 생성 버튼은 없다.
    expect(within(dialog).queryByRole('button', { name: /생성|만들기|전송/ })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 20000)

  it('shows both notes in the preview, told apart and marked as not printed', async () => {
    const doc = sampleDoc()
    doc.project.concept = '단정하게'
    doc.project.designerNote = '이 문구는 반드시 강조해 주세요.'
    await openStudioWith(doc)

    const aiField = await screen.findByLabelText('AI에게 추가로 전달할 말')
    fireEvent.change(aiField, { target: { value: '하단에는 그라데이션을 꼭 넣어 주세요.' } })

    const preview = screen.getByRole('button', { name: 'AI 제작 요청 미리보기' }) as HTMLButtonElement
    await waitFor(() => expect(preview.disabled).toBe(false), { timeout: 6000 })
    fireEvent.click(preview)

    const dialog = await screen.findByRole('dialog', { name: 'AI 제작 요청 미리보기' })
    expect(dialog.textContent).toContain('단정하게')
    expect(dialog.textContent).toContain('디자인팀에게 전달할 말')
    expect(dialog.textContent).toContain('이 문구는 반드시 강조해 주세요.')
    expect(dialog.textContent).toContain('AI에게 추가로 전달할 말')
    expect(dialog.textContent).toContain('하단에는 그라데이션을 꼭 넣어 주세요.')
    expect(dialog.textContent).toContain('인쇄하지 않음')
  }, 25000)
})

describe('§2 외부 호출', () => {
  it('has made no network call in this suite', async () => {
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await getAllAssets()).toBeTruthy()
  })
})

/** 페이지가 여럿인 파일도 자리마다 갈라져야 한다 (§9). */
describe('§9 여러 페이지', () => {
  it("keeps each page's own size and wording", () => {
    const doc = sampleDoc()
    const second = createPage({ id: 'page_2', title: '2페이지', canvasHeight: 1600 })
    second.blocks = [createBlock('free_text', { id: 'blk_two', content: '기간 한정 혜택' })]
    doc.pages.push(second)

    const job = createStudioJob(doc, 1)
    const first = buildGenerationRequest(doc, job, doc.pages[0]!.id)
    const other = buildGenerationRequest(doc, job, 'page_2')
    expect(first.design.document.canvas.height).not.toBe(other.design.document.canvas.height)
    expect(other.design.texts.map((t) => t.content)).toEqual(['기간 한정 혜택'])
  })
})
