/**
 * 긴급 Patch 집중검사 — 제품 이미지 블록의 군더더기 제거 + 블록 위 레이어 메뉴.
 *
 * 네 가지 불편을 구현 **전에** 실패로 고정한다. 새 모듈은 검사 안에서 부르므로
 * 없는 모듈이 파일 전체를 무너뜨리지 않고, 몇 항목이 빨간지 그대로 세어진다.
 *
 * 실물 이미지는 fixture로 넣지 않는다. 여기서 쓰는 그림은 손으로 만든 바이트다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { clearAll, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllStudioJobs,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { createStudioJob, withSource } from '../domain/studioJob'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 640, height: 480 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

globalThis.fetch = vi.fn() as unknown as typeof fetch

const PARENT = '../'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Promise<any> => import(/* @vite-ignore */ `${PARENT}${name}`)

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/** 이미지 두 장과 문구 하나 — 순서를 다툴 만큼은 된다. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('사진 블록 시험'))
  const withRef = createBlock('main_product_image', {
    id: 'blk_image',
    label: '이미지',
    content: '니트 정면 컷이 들어갑니다',
    assetId: 'asset_ref',
    position: { x: 120, y: 300, width: 400, height: 400 },
  })
  withRef.image = { referenceOnly: true }
  const empty = createBlock('sub_product_image', {
    id: 'blk_empty',
    label: '빈 이미지',
    position: { x: 560, y: 300, width: 240, height: 240 },
  })
  const text = createBlock('free_text', {
    id: 'blk_text',
    label: '문구',
    content: '여름 감사제',
    position: { x: 160, y: 340, width: 320, height: 120 },
  })
  doc.pages[0]!.blocks = [withRef, empty, text]
  doc.pages[0]!.canvasHeight = 1200
  doc.assets = [{ id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' }]
  return doc
}

/** 제품 이미지가 이미 연결된 작업. */
async function seedJob(links: Record<string, string> = { blk_image: 'asset_product' }) {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '사진 블록 시험.eventbrief')
  await saveStudioJob({ ...job, productImages: links })
}

function StudioHarness() {
  const studio = useStudioJob()
  if (studio === null) return null
  return <AppShell mode="studio" binding={studio.binding} />
}

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <StudioJobProvider>
        <StudioHarness />
      </StudioJobProvider>
    </MemoryRouter>,
  )
}

/** 캔버스 위의 카드만 — 팔레트와 상단바에도 같은 낱말이 있다. */
async function cardOf(container: HTMLElement, blockLabelStart: string, index = 0): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('.canvas__sheet .block-card')).toBeTruthy())
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')).filter((el) =>
    (el.getAttribute('aria-label') ?? '').startsWith(blockLabelStart),
  )
  expect(cards.length).toBeGreaterThan(index)
  return cards[index]!
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
  sessionStorage.clear()
  await putAsset(storedAsset('asset_ref', 1))
  await putAsset(storedAsset('asset_product', 2))
})

// ── 1. 연결된 제품 이미지 주변의 군더더기 ────────────────────────────────────

describe('Patch-1 제품 이미지 블록은 이미지 그 자체다', () => {
  it('카드 껍데기 없이 사진만 그린다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const card = await cardOf(container, '이미지')

    await waitFor(() => expect(card.querySelector('.block-card__thumb')).toBeTruthy())
    // 사진 표현임을 클래스로 말한다 — CSS가 이 하나로 껍데기를 전부 걷는다.
    expect(card.className).toContain('block-card--photo')
    // 라벨·배지·설명·안내는 남지 않는다.
    expect(card.querySelector('.block-card__head')).toBeNull()
    expect(card.querySelector('.block-card__title')).toBeNull()
    expect(card.querySelector('.block-card__slot')).toBeNull()
    expect(card.querySelector('.block-card__ref-note')).toBeNull()
    expect(card.textContent).not.toContain('니트 정면 컷이 들어갑니다')
    expect(card.textContent).not.toContain('실제 사용 제품 이미지')
  })

  it('선택을 해제하면 이미지 말고는 아무 UI도 없다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const card = await cardOf(container, '이미지')
    await waitFor(() => expect(card.querySelector('.block-card__thumb')).toBeTruthy())

    // 처음부터 선택돼 있지 않다.
    expect(card.getAttribute('aria-pressed')).toBe('false')
    expect(card.querySelector('.block-toolbar')).toBeNull()
    expect(card.querySelector('.block-card__handle')).toBeNull()

    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
    // 고르면 조작점과 작은 도구막대가 나타난다.
    expect(card.querySelector('.block-toolbar')).toBeTruthy()
    expect(card.querySelectorAll('.block-card__handle').length).toBe(4)

    // 다른 곳을 누르면 다시 사라진다.
    const sheet = container.querySelector('.canvas__sheet')!
    fireEvent.pointerDown(sheet)
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('false'))
    expect(card.querySelector('.block-toolbar')).toBeNull()
    expect(card.querySelector('.block-card__handle')).toBeNull()
  })

  it('제품 이미지가 없는 자리는 지금까지처럼 안내를 보여 준다', async () => {
    await seedJob({})
    const { container } = renderStudio()
    const empty = await cardOf(container, '빈 이미지')
    expect(empty.className).not.toContain('block-card--photo')
    expect(empty.textContent).toContain('어떤 이미지가 들어갈지 적어주세요')
  })

  it('작성기 표면의 이미지 블록은 그대로다', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <DocumentsProvider>
          <AppShell mode="brief" />
        </DocumentsProvider>
      </MemoryRouter>,
    )
    // 작업판이 아니면 provider 자체가 없으므로 사진 표현으로 바뀔 길이 없다.
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).toBeTruthy())
    expect(document.querySelector('.block-card--photo')).toBeNull()
  })
})

// ── 2. 실제 이미지 경계와 선택 영역의 일치 ───────────────────────────────────

describe('Patch-2 선택 영역이 실제 이미지 경계와 같다', () => {
  it('알파 경계를 0..1 비율로 읽는다', async () => {
    const { alphaContentBox, FULL_CONTENT_BOX } = await load('domain/photoBox')
    // 10×10 중 가운데 4×4(x 3..6, y 2..5)만 불투명.
    const width = 10
    const height = 10
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 3; x <= 6; x += 1) {
        const i = (y * width + x) * 4
        data[i] = 200
        data[i + 3] = 255
      }
    }
    expect(alphaContentBox({ data, width, height })).toEqual({ x: 0.3, y: 0.2, width: 0.4, height: 0.4 })

    // 전부 투명하면 잘라낼 근거가 없다 — 이미지 전체가 내용이다.
    const empty = new Uint8ClampedArray(width * height * 4)
    expect(alphaContentBox({ data: empty, width, height })).toEqual(FULL_CONTENT_BOX)
  })

  it('연결 순간 블록을 내용 비율에 맞춘다', async () => {
    const { photoRect } = await load('domain/photoBox')
    // 400×400 블록에 가로가 두 배 긴 내용(=800×400 상당)이 들어오면 가로로 눕는다.
    const fitted = photoRect(
      { x: 120, y: 300, width: 400, height: 400 },
      { width: 1000, height: 1000 },
      { x: 0.1, y: 0.3, width: 0.8, height: 0.4 },
    )
    expect(fitted.width / fitted.height).toBeCloseTo(2, 5)
    // 넓이는 대체로 유지하고 가운데를 지킨다.
    expect(fitted.x + fitted.width / 2).toBeCloseTo(320, 5)
    expect(fitted.y + fitted.height / 2).toBeCloseTo(500, 5)
  })

  it('내용 상자가 블록을 정확히 채우도록 그림을 앉힌다', async () => {
    const { photoImageStyle } = await load('domain/photoBox')
    // 내용이 그림의 가운데 절반이면, 그림은 블록의 두 배 크기로 그려지고
    // 좌우·상하로 그만큼 밀려나 내용만 블록 안에 남는다.
    expect(photoImageStyle({ width: 200, height: 100 }, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })).toEqual({
      width: 400,
      height: 200,
      left: -100,
      top: -50,
    })
    // 잘라낼 것이 없으면 그림이 곧 블록이다.
    expect(photoImageStyle({ width: 200, height: 100 }, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
      width: 200,
      height: 100,
      left: 0,
      top: 0,
    })
  })

  it('사진 블록의 크기 조절은 비율을 지킨다', async () => {
    const { keepAspect } = await load('domain/photoBox')
    // 2:1 사진을 오른쪽 아래로 끌면 가로가 늘어난 만큼 세로도 따라온다.
    const resized = keepAspect({ x: 0, y: 0, width: 200, height: 100 }, 'se', 100, 0, 2)
    expect(resized.width / resized.height).toBeCloseTo(2, 5)
    expect(resized.x).toBe(0)
    expect(resized.y).toBe(0)
    // 왼쪽 위 모서리를 끌면 반대 모서리가 제자리에 남는다.
    const nw = keepAspect({ x: 100, y: 50, width: 200, height: 100 }, 'nw', -100, 0, 2)
    expect(nw.width / nw.height).toBeCloseTo(2, 5)
    expect(nw.x + nw.width).toBeCloseTo(300, 5)
    expect(nw.y + nw.height).toBeCloseTo(150, 5)
  })
})

// ── 3. 블록 위 레이어 메뉴 ───────────────────────────────────────────────────

describe('Patch-3 레이어 순서를 블록에서 바로 바꾼다', () => {
  it('선택한 블록의 도구막대에 레이어 메뉴가 있다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const card = await cardOf(container, '문구')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))

    const trigger = within(card).getByRole('button', { name: /레이어 순서/ })
    fireEvent.click(trigger)
    for (const name of ['맨 앞으로', '한 단계 앞으로', '한 단계 뒤로', '맨 뒤로']) {
      expect(within(card).getByRole('button', { name })).toBeTruthy()
    }
  })

  it('순서를 바꿔도 선택은 유지되고 메뉴만 닫힌다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const orderOf = () =>
      Array.from(container.querySelectorAll('.canvas__sheet .block-card')).map((el) =>
        el.getAttribute('aria-label'),
      )
    const card = await cardOf(container, '이미지')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
    expect(orderOf().at(-1)).toContain('문구')

    fireEvent.click(within(card).getByRole('button', { name: /레이어 순서/ }))
    fireEvent.click(within(card).getByRole('button', { name: '맨 앞으로' }))

    await waitFor(() => expect(orderOf().at(-1)).toContain('이미지'))
    // 선택은 그대로, 메뉴는 닫힌다.
    const moved = await cardOf(container, '이미지')
    expect(moved.getAttribute('aria-pressed')).toBe('true')
    expect(within(moved).queryByRole('button', { name: '맨 앞으로' })).toBeNull()
  })

  it('맨 앞 블록에서는 앞으로 가는 두 동작이 막힌다', async () => {
    await seedJob()
    const { container } = renderStudio()
    // 문구가 맨 뒤에서 셋째 — 배열의 마지막이므로 이미 맨 앞이다.
    const front = await cardOf(container, '문구')
    fireEvent.pointerDown(front, { button: 0 })
    await waitFor(() => expect(front.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(within(front).getByRole('button', { name: /레이어 순서/ }))
    expect(within(front).getByRole('button', { name: '맨 앞으로' }).hasAttribute('disabled')).toBe(true)
    expect(within(front).getByRole('button', { name: '한 단계 앞으로' }).hasAttribute('disabled')).toBe(true)
    expect(within(front).getByRole('button', { name: '맨 뒤로' }).hasAttribute('disabled')).toBe(false)
  })

  it('맨 뒤 블록에서는 뒤로 가는 두 동작이 막힌다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const back = await cardOf(container, '이미지')
    fireEvent.pointerDown(back, { button: 0 })
    await waitFor(() => expect(back.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(within(back).getByRole('button', { name: /레이어 순서/ }))
    expect(within(back).getByRole('button', { name: '한 단계 뒤로' }).hasAttribute('disabled')).toBe(true)
    expect(within(back).getByRole('button', { name: '맨 뒤로' }).hasAttribute('disabled')).toBe(true)
    expect(within(back).getByRole('button', { name: '맨 앞으로' }).hasAttribute('disabled')).toBe(false)
  })

  it('레이어 위치를 순수 함수로 읽는다', async () => {
    const { visibleLayerPosition } = await load('domain/layerOrder')
    const blocks = sampleDoc().pages[0]!.blocks
    expect(visibleLayerPosition(blocks, 'blk_image')).toEqual({ index: 0, count: 3 })
    expect(visibleLayerPosition(blocks, 'blk_text')).toEqual({ index: 2, count: 3 })
    expect(visibleLayerPosition(blocks, 'nope')).toBeNull()
  })
})

// ── 4. 우측 패널의 중복 조작 제거 ────────────────────────────────────────────

describe('Patch-4 우측 패널에 같은 조작을 두지 않는다', () => {
  it('블록 배치 칸에는 레이어 버튼이 없고 맞춤 방식만 남는다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const card = await cardOf(container, '이미지')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))

    const panel = await screen.findByRole('region', { name: '블록 배치' })
    expect(within(panel).getByRole('button', { name: '전체 보이기' })).toBeTruthy()
    for (const name of ['맨 앞으로', '한 단계 앞으로', '한 단계 뒤로', '맨 뒤로']) {
      expect(within(panel).queryByRole('button', { name })).toBeNull()
    }
    void container
  })
})
