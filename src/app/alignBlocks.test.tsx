/**
 * 줄 맞춤 (정렬 Patch).
 *
 * 지금까지 상자의 자리를 맞추는 길은 눈대중 하나뿐이었다 — 작업자가 그 자리에서
 * 말했다: "지금은 다 눈대중으로 위치를 맞추고 있는데… 각 블록들의 정렬 기능이
 * 있었으면 좋겠어."
 *
 * 정렬에서 헷갈리는 것은 언제나 **기준**이다. 그래서 여기서 가장 많이 재는 것도
 * 기준이다 — 하나면 캔버스, 여럿이면 마지막에 고른 것.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { createStudioJob, withSource, type StudioJob } from '../domain/studioJob'
import { alignRects, alignNeeds, ALIGN_MOVES } from '../domain/alignBlocks'
import { clearAll, putAsset, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { documentFingerprint } from '../domain/documentFingerprint'
import { resetFoldsForTests } from '../components/studio/PanelFold'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import type { BriefDocument } from '../domain/pageSchema'

// 그림을 재고 미리보기를 그리는 두 곳만 막는다. 줄 맞춤은 그림을 건드리지 않으니
// 그 밖의 것은 실물 그대로 둔다.
vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 800, height: 800 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
}))
// 완성본을 다시 합치는 일은 캔버스의 몫이다. 여기서 묻는 것은 자리이지 화소가 아니다.
vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async () => new Blob([new Uint8Array([5])], { type: 'image/png' }),
}))
vi.mock('../services/compositeSources', () => ({
  collectCompositeSources: async () => ({
    blobs: new Map(),
    analyses: new Map(),
    papers: new Map(),
    boxes: new Map(),
  }),
}))

// 화면 검사는 트리를 직접 뒤진다(`document.querySelectorAll`). 걷어 내지 않으면
// 지난 검사의 트리가 그대로 남아 같은 이름이 둘씩 잡힌다.
afterEach(() => {
  cleanup()
})

const CANVAS = { width: 840, height: 1000 }

describe('§A1 기준이 무엇인가', () => {
  it('하나만 주면 캔버스가 기준이다', () => {
    const box = { x: 10, y: 20, width: 200, height: 100 }
    expect(alignRects([box], 'hcenter', CANVAS)[0]).toEqual({ ...box, x: 320 })
    expect(alignRects([box], 'left', CANVAS)[0]).toEqual({ ...box, x: 0 })
    expect(alignRects([box], 'right', CANVAS)[0]).toEqual({ ...box, x: 640 })
    expect(alignRects([box], 'vcenter', CANVAS)[0]).toEqual({ ...box, y: 450 })
    expect(alignRects([box], 'top', CANVAS)[0]).toEqual({ ...box, y: 0 })
    expect(alignRects([box], 'bottom', CANVAS)[0]).toEqual({ ...box, y: 900 })
  })

  /**
   * 마지막에 고른 것을 기준으로 삼는 이유는, 그것이 편집기가 이미 "지금 것"으로
   * 삼는 상자이기 때문이다. "가장 왼쪽 것"을 기준으로 삼으면 사람이 고르지 않은
   * 상자가 기준이 되어, 누를 때마다 어디로 갈지 모른다.
   */
  it('여럿이면 마지막에 고른 것이 기준이고, 그 상자는 움직이지 않는다', () => {
    const a = { x: 10, y: 0, width: 100, height: 50 }
    const b = { x: 500, y: 200, width: 300, height: 50 }
    const anchor = { x: 200, y: 400, width: 200, height: 50 }

    const left = alignRects([a, b, anchor], 'left', CANVAS)
    expect(left.map((r) => r.x)).toEqual([200, 200, 200])
    expect(left[2]).toEqual(anchor)

    const right = alignRects([a, b, anchor], 'right', CANVAS)
    // 오른쪽 끝(400)이 맞춰진다 — 크기가 다르므로 시작점은 저마다 다르다.
    expect(right.map((r) => r.x + r.width)).toEqual([400, 400, 400])

    const center = alignRects([a, b, anchor], 'hcenter', CANVAS)
    expect(center.map((r) => r.x + r.width / 2)).toEqual([300, 300, 300])
  })

  it('세로도 같은 규칙이다', () => {
    const a = { x: 0, y: 10, width: 100, height: 40 }
    const anchor = { x: 0, y: 300, width: 100, height: 80 }
    expect(alignRects([a, anchor], 'top', CANVAS).map((r) => r.y)).toEqual([300, 300])
    expect(alignRects([a, anchor], 'bottom', CANVAS).map((r) => r.y + r.height)).toEqual([380, 380])
  })

  it('크기와 순서는 손대지 않는다', () => {
    const rects = [
      { x: 10, y: 10, width: 100, height: 50 },
      { x: 400, y: 200, width: 300, height: 90 },
    ]
    const after = alignRects(rects, 'left', CANVAS)
    expect(after.map((r) => `${String(r.width)}x${String(r.height)}`)).toEqual(['100x50', '300x90'])
    expect(after).toHaveLength(2)
  })
})

describe('§A2 고르게 늘어놓기', () => {
  /**
   * 양 끝은 제자리다. 가운데 것만 옮겨 **사이 간격**을 같게 만든다.
   *
   * 크기를 일부러 다 다르게 둔다. 셋이 같은 크기면 "사이 간격을 고르게"와
   * "중심 간격을 고르게"가 같은 답을 내서, 어느 쪽으로 짰든 검사가 통과한다.
   */
  it('양 끝을 두고 사이 간격을 같게 만든다', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 150, y: 0, width: 200, height: 10 },
      { x: 500, y: 0, width: 300, height: 10 },
    ]
    const after = alignRects(rects, 'hspread', CANVAS)
    // 양 끝은 그대로.
    expect(after[0]!.x).toBe(0)
    expect(after[2]!.x).toBe(500)
    // 폭 800 안에 상자 600이 차 있으니 남는 200을 두 칸으로 나눈다 → 간격 100.
    expect(after[1]!.x).toBe(200)
    // 실제로 두 사이가 같다.
    expect(after[1]!.x - (after[0]!.x + after[0]!.width)).toBe(100)
    expect(after[2]!.x - (after[1]!.x + after[1]!.width)).toBe(100)
    // 중심 간격으로 짰다면 가운데가 250에 섰을 것이다.
    expect(after[1]!.x).not.toBe(250)
  })

  it('고른 차례 그대로 돌려준다 — 자리 순서와 고른 순서는 다르다', () => {
    const rects = [
      { x: 500, y: 0, width: 300, height: 10 },
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 150, y: 0, width: 200, height: 10 },
    ]
    const after = alignRects(rects, 'hspread', CANVAS)
    expect(after[0]!.x).toBe(500)
    expect(after[1]!.x).toBe(0)
    expect(after[2]!.x).toBe(200)
  })

  it('셋이 안 되면 아무 일도 하지 않는다', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 500, y: 0, width: 100, height: 10 },
    ]
    expect(alignRects(rects, 'hspread', CANVAS)).toEqual(rects)
    expect(alignNeeds('hspread')).toBe(3)
    expect(alignNeeds('left')).toBe(1)
    // 목록에 있는 모든 움직임에 필요한 수가 적혀 있다.
    for (const move of ALIGN_MOVES) expect(move.min).toBeGreaterThan(0)
  })
})

// ── 화면 ────────────────────────────────────────────────────────────────────

function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('줄 맞춤 시험'))
  // 셋을 둔다. 둘뿐이면 기준(마지막에 고른 것)은 제자리이므로 실제로 움직이는
  // 상자가 하나뿐이고, "여러 개가 한 번에 되돌아오는가"를 잴 수 없다.
  doc.pages[0]!.blocks = [
    createBlock('free_text', { id: 'blk_a', content: '가', position: { x: 10, y: 100, width: 100, height: 50 } }),
    createBlock('free_text', { id: 'blk_b', content: '나', position: { x: 500, y: 300, width: 200, height: 50 } }),
    createBlock('free_text', { id: 'blk_c', content: '다', position: { x: 300, y: 500, width: 150, height: 50 } }),
  ]
  doc.pages[0]!.canvasHeight = 1000
  return doc
}

function Harness() {
  const studio = useStudioJob()
  if (studio === null) return null
  return <AppShell mode="studio" binding={studio.binding} />
}

describe('§A3 화면에서 줄을 맞춘다', () => {
  beforeEach(async () => {
    resetAssetStoreForTests()
    resetDocumentStoreForTests()
    resetStudioStoreForTests()
    resetFoldsForTests()
    await clearAll()
    await clearAllDocuments()
    await clearAllStudioJobs()
    const doc = sampleDoc()
    // 스튜디오는 언제나 `STUDIO_JOB_ID` 하나를 연다. 다른 이름으로 두면 화면은
    // 빈 문서를 열고, 상자가 하나도 나오지 않는다.
    await saveStudioJob(withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief'))
  })

  async function openEditor() {
    render(
      <MemoryRouter initialEntries={['/studio']}>
        <StudioJobProvider>
          <Harness />
        </StudioJobProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelectorAll('.canvas__sheet .block-card').length).toBe(3), {
      timeout: 5000,
    })
  }

  const cards = () => document.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')

  it('아무것도 안 골랐으면 이 칸 자체가 없다', async () => {
    await openEditor()
    expect(screen.queryByRole('button', { name: /줄 맞춤/ })).toBeNull()
  })

  it('하나를 고르면 캔버스가 기준이라고 말하고, 실제로 캔버스 가운데로 간다', async () => {
    await openEditor()
    fireEvent.pointerDown(cards()[0]!, { button: 0 })

    const panel = await screen.findByRole('group', { name: '줄 맞춤' })
    // 기준은 화면이 직접 말한다 — 눌러 보고서야 알게 되면 쓰지 않는다.
    // eslint-disable-next-line testing-library/no-node-access
    expect(panel.parentElement?.textContent).toContain('캔버스')

    fireEvent.click(screen.getByRole('button', { name: '가로 가운데 맞춤' }))
    await waitFor(() => {
      // 840 캔버스에서 폭 100짜리의 가운데는 370이다.
      expect(cards()[0]!.style.left).toBe('370px')
    })
    // 고르지 않은 것은 그대로다.
    expect(cards()[1]!.style.left).toBe('500px')
  })

  it('여럿을 고르면 마지막에 고른 것에 맞추고, 한 번의 실행 취소로 다 되돌아온다', async () => {
    await openEditor()
    fireEvent.pointerDown(cards()[1]!, { button: 0 })
    fireEvent.pointerDown(cards()[2]!, { button: 0, shiftKey: true })
    fireEvent.pointerDown(cards()[0]!, { button: 0, shiftKey: true })

    const panel = await screen.findByRole('group', { name: '줄 맞춤' })
    // eslint-disable-next-line testing-library/no-node-access
    expect(panel.parentElement?.textContent).toContain('마지막에 고른 상자')

    // 마지막에 고른 것은 `blk_a`(x 10)이므로 나머지 둘이 그쪽으로 온다.
    fireEvent.click(screen.getByRole('button', { name: '왼쪽 맞춤' }))
    await waitFor(() => expect(cards()[1]!.style.left).toBe('10px'))
    expect(cards()[2]!.style.left).toBe('10px')
    expect(cards()[0]!.style.left).toBe('10px')

    // 두 상자가 움직였어도 되돌리기는 **한 칸**이다. 블록마다 따로 옮기면
    // 여기서 하나만 돌아온다.
    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect(cards()[1]!.style.left).toBe('500px'))
    expect(cards()[2]!.style.left).toBe('300px')
  })

  it('셋이 필요한 버튼은 둘일 때 흐리다', async () => {
    await openEditor()
    fireEvent.pointerDown(cards()[0]!, { button: 0 })
    const spread = await screen.findByRole('button', { name: /가로 간격을 고르게/ })
    expect((spread as HTMLButtonElement).disabled).toBe(true)
  })

  it('줄을 맞추는 데 외부 호출은 없다', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    await openEditor()
    fireEvent.pointerDown(cards()[0]!, { button: 0 })
    fireEvent.click(await screen.findByRole('button', { name: '가로 가운데 맞춤' }))
    await waitFor(() => expect(cards()[0]!.style.left).toBe('370px'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ── 완성본 ──────────────────────────────────────────────────────────────────

/**
 * §A4 눈대중이 실제로 일어나는 자리는 여기다.
 *
 * 첫 판은 이 칸을 기획서 캔버스에만 뒀는데, 작업자가 자리를 맞추는 것은 만들고
 * 난 **뒤**다 — 완성본 위의 조각을 하나씩 끌어 맞춘다. 그래서 같은 칸이 이쪽에도
 * 선다. 움직이는 것은 블록이 아니라 조각이고, 자리는 작업 파일에 적힌다.
 */
function finishedJob(): StudioJob {
  const doc = sampleDoc()
  const pageId = doc.pages[0]!.id
  const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  return {
    ...job,
    backgrounds: { [pageId]: { assetId: 'asset_bg', source: 'ai' as const } },
    results: {
      [pageId]: {
        pageId,
        assetId: 'asset_result',
        model: 'gpt-image-2',
        quality: 'medium' as const,
        requestedSize: '832x1104',
        sourceFingerprint: documentFingerprint(doc),
        createdAt: 1,
      },
    },
    // 화면에 서는 차례는 `layer` 오름차순이다 — 가·나·다 순으로 세운다.
    textObjects: {
      [pageId]: [
        { blockId: 'blk_a', assetId: 'asset_t1', rect: { x: 100, y: 100, width: 200, height: 80 }, layer: 1 },
        { blockId: 'blk_b', assetId: 'asset_t2', rect: { x: 500, y: 300, width: 150, height: 60 }, layer: 2 },
        { blockId: 'blk_c', assetId: 'asset_t3', rect: { x: 300, y: 600, width: 120, height: 50 }, layer: 3 },
      ],
    },
  }
}

describe('§A4 완성본에서 조각을 줄 맞춘다', () => {
  let fetchSpy = vi.fn()

  beforeEach(async () => {
    fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    resetAssetStoreForTests()
    resetDocumentStoreForTests()
    resetStudioStoreForTests()
    resetFoldsForTests()
    await clearAll()
    await clearAllDocuments()
    await clearAllStudioJobs()
    await saveStudioJob(finishedJob())
    for (const id of ['asset_bg', 'asset_result', 'asset_t1', 'asset_t2', 'asset_t3']) {
      await putAsset({
        id,
        blob: new Blob([new Uint8Array([137, 80, 78, 71, 3])], { type: 'image/png' }),
        fileName: `${id}.png`,
        mimeType: 'image/png',
        byteSize: 5,
      })
    }
  })

  const pieces = () => document.querySelectorAll<HTMLElement>('.result-objects .result-object')

  async function openResult() {
    render(
      <MemoryRouter initialEntries={['/studio']}>
        <StudioJobProvider>
          <Harness />
        </StudioJobProvider>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('radio', { name: '완성본' }, { timeout: 8000 }))
    await waitFor(() => expect(pieces().length).toBe(3), { timeout: 8000 })
  }

  /** 작업 파일에 적힌 조각의 왼쪽 자리 — 화면의 백분율이 아니라 이것이 사실이다. */
  async function lefts(): Promise<number[]> {
    const job = await loadStudioJob(STUDIO_JOB_ID)
    const page = Object.keys(job?.textObjects ?? {})[0] ?? ''
    return (job?.textObjects?.[page] ?? []).map((o) => o.rect.x)
  }

  it('여럿을 고르면 마지막에 고른 조각에 맞춘다', async () => {
    await openResult()
    fireEvent.pointerDown(pieces()[1]!, { button: 0 })
    fireEvent.pointerDown(pieces()[2]!, { button: 0, shiftKey: true })
    fireEvent.pointerDown(pieces()[0]!, { button: 0, shiftKey: true })

    fireEvent.click(await screen.findByRole('button', { name: '왼쪽 맞춤' }))
    await waitFor(async () => expect(await lefts()).toEqual([100, 100, 100]), { timeout: 8000 })

    // 한 번 더 맞춘다. **두 번째** 정렬도 제 칸을 남기는지가 여기서 갈린다 —
    // 남기지 않으면 되돌리기 한 번이 두 번의 정렬을 함께 지운다.
    // 기준(`blk_a`)의 오른쪽 끝은 300이므로 저마다 폭만큼 물러선다.
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 맞춤' }))
    await waitFor(async () => expect(await lefts()).toEqual([100, 150, 180]), { timeout: 8000 })

    // 조각 둘이 함께 움직였어도 되돌리기는 한 칸이다.
    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(async () => expect(await lefts()).toEqual([100, 100, 100]), { timeout: 8000 })
  })

  it('조각 하나만 고르면 캔버스가 기준이다', async () => {
    await openResult()
    fireEvent.pointerDown(pieces()[1]!, { button: 0 })
    fireEvent.click(await screen.findByRole('button', { name: '가로 가운데 맞춤' }))
    // 840 캔버스에서 폭 150짜리의 가운데는 345다. 나머지는 제자리.
    await waitFor(async () => expect(await lefts()).toEqual([100, 345, 300]), { timeout: 8000 })
  })

  it('조각을 옮기는 데 모델을 부르지 않는다', async () => {
    await openResult()
    fireEvent.pointerDown(pieces()[1]!, { button: 0 })
    fireEvent.click(await screen.findByRole('button', { name: '가로 가운데 맞춤' }))
    await waitFor(async () => expect((await lefts())[1]).toBe(345), { timeout: 8000 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
