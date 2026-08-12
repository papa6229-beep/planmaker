/**
 * 투명한 그림의 그림자 (그림자 Patch).
 *
 * 작업자가 그 자리에서 말했다: "일반 이미지 블록에 이미지를 업로드할 때 그림자가
 * 기본으로 깔리는데… 이미지 내부가 투명한 그런 이미지를 올릴 때는 그 그림자가
 * 어색해."
 *
 * 접지 그림자는 **바닥에 놓인 덩어리** 하나를 가정한다. 로고·글자처럼 구멍 뚫린
 * 형태에서는 그 가정이 틀려, 글자 아래에 정체 모를 검은 타원이 생긴다.
 *
 * 그래서 두 가지를 잰다 — 어림짐작이 형태를 제대로 가르는가, 그리고 그 짐작을
 * 사람이 한 번에 되돌릴 수 있는가.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { cleanup, render, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { analyzeCutout, type ImageAnalysis } from '../domain/imageAnalysis'
import { SHADOW_FILL_MIN, shadowSuitsShape } from '../domain/shadowFit'
import { DEFAULT_COMPOSITE_EFFECTS, normalizeEffects } from '../domain/compositeEffects'
import { createStudioJob, withSource } from '../domain/studioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { clearAll, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import {
  clearAllStudioJobs,
  loadStudioJob,
  resetStudioStoreForTests,
  saveStudioJob,
  STUDIO_JOB_ID,
} from '../services/studioStore'
import { resetFoldsForTests } from '../components/studio/PanelFold'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 400, height: 400 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
}))
vi.mock('../services/photoContent', () => ({
  PHOTO_MEASURE_MAX_SIDE: 256,
  measurePhoto: async () => ({ natural: { width: 400, height: 400 }, box: { x: 0, y: 0, width: 1, height: 1 } }),
}))
vi.mock('../services/paperCutoutShape', () => ({
  buildPaperShape: async () => null,
  buildPaperCanvas: async () => null,
}))

/** 올린 그림을 잰 값. 검사마다 갈아 끼운다 — 화소는 §S1에서 따로 잰다. */
let measured: ImageAnalysis | null = null
vi.mock('../services/imageAnalysisRunner', () => ({
  ANALYSIS_MAX_SIDE: 256,
  analyzeImageBlob: async () => measured,
}))

afterEach(() => {
  cleanup()
})

// ── §S1 형태를 가르는 값 ────────────────────────────────────────────────────

/** 투명한 판 위에 불투명한 사각형 하나. */
function squarePixels(size: number, box: { x: number; y: number; side: number }) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = box.y; y < box.y + box.side; y += 1) {
    for (let x = box.x; x < box.x + box.side; x += 1) {
      const i = (y * size + x) * 4
      data[i] = 200
      data[i + 1] = 120
      data[i + 2] = 80
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

/** 글자처럼 — 상자 안에 듬성듬성 놓인 획들. */
function strokePixels(size: number) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 네 칸에 한 줄만 채운다 — 상자는 전부 쓰지만 속은 거의 비어 있다.
      if (x % 4 !== 0) continue
      const i = (y * size + x) * 4
      data[i] = 30
      data[i + 1] = 30
      data[i + 2] = 30
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

describe('§S1 형태를 가르는 값', () => {
  /**
   * 이것이 이 패치의 핵심이다. 작게 찍힌 제품은 `opaqueRatio`가 아주 낮지만
   * 실루엣은 꽉 찼다 — 그림자를 깔아야 한다. 비율만 보고 정했다면 그 반대로
   * 갔을 것이다.
   */
  it('작게 찍힌 덩어리는 넓이가 작아도 속이 꽉 찼다', () => {
    const analysis = analyzeCutout(squarePixels(20, { x: 4, y: 4, side: 4 }))!
    expect(analysis.opaqueRatio).toBeCloseTo(16 / 400, 5)
    expect(analysis.fill).toBe(1)
    expect(shadowSuitsShape(analysis)).toBe(true)
  })

  it('글자처럼 듬성듬성한 형태는 상자를 다 쓰고도 속이 비었다', () => {
    const analysis = analyzeCutout(strokePixels(20))!
    // 상자는 그림 전체다 — 넓이만 보면 사각형 사진과 구별되지 않는다.
    expect(analysis.bounds).toEqual({ x: 0, y: 0, width: 17, height: 20 })
    expect(analysis.fill).toBeLessThan(SHADOW_FILL_MIN)
    expect(shadowSuitsShape(analysis)).toBe(false)
  })

  it('꽉 찬 사각형 사진은 그대로 그림자를 깐다', () => {
    const analysis = analyzeCutout(squarePixels(10, { x: 0, y: 0, side: 10 }))!
    expect(analysis.fill).toBe(1)
    expect(shadowSuitsShape(analysis)).toBe(true)
  })

  it('재지 못했으면 켠다 — 못 읽었다는 이유로 결과가 달라지지 않는다', () => {
    expect(shadowSuitsShape(null)).toBe(true)
  })

  it('예전 작업 파일에는 이 항목이 없다 — 없으면 켜진 것이다', () => {
    expect(DEFAULT_COMPOSITE_EFFECTS.shadow).toBe(true)
    expect(normalizeEffects({}).shadow).toBe(true)
    expect(normalizeEffects({ contactShadow: 0.7 }).shadow).toBe(true)
    // 꺼 둔 것만 꺼진 채로 돌아온다.
    expect(normalizeEffects({ shadow: false }).shadow).toBe(false)
  })
})

// ── §S2 스위치가 실제로 그림을 막는가 ───────────────────────────────────────

describe('§S2 스위치가 그리는 자리까지 간다', () => {
  /**
   * 접지 그림자는 캔버스의 `ellipse` 하나다. 그 부름이 있었는가만 세면, 무엇을
   * 그렸는지는 몰라도 **그렸는가**는 안다.
   */
  async function ellipsesDrawn(shadow: boolean): Promise<number> {
    let ellipses = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).createImageBitmap = async () => ({ width: 100, height: 100 })
    const ctx = {
      save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, rect() {}, fill() {}, fillRect() {},
      ellipse() { ellipses += 1 },
      drawImage() {}, fillText() {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
      }),
    }
    const original = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return original(tag) as HTMLElement
      return {
        width: 0, height: 0, style: {},
        getContext: () => ctx,
        toBlob: (cb: (b: Blob) => void) => cb(new Blob([new Uint8Array([1])], { type: 'image/png' })),
        toDataURL: () => 'data:image/png;base64,AA',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })
    try {
      const { renderComposite } = await vi.importActual<typeof import('../services/compositeRenderer')>(
        '../services/compositeRenderer',
      )
      await renderComposite(
        {
          size: { width: 840, height: 1200 },
          background: { assetId: 'a_plate', source: 'ai' },
          layers: [
            {
              blockId: 'blk_logo',
              assetId: 'a_logo',
              rect: { x: 60, y: 520, width: 300, height: 200 },
              fit: 'contain',
              crop: { sx: 0, sy: 0, sWidth: 100, sHeight: 100, dx: 60, dy: 520, dWidth: 300, dHeight: 200 },
              effects: { ...DEFAULT_COMPOSITE_EFFECTS, shadow },
              order: 0,
            },
          ],
          texts: [],
          grain: 0,
          tone: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
          externalCalls: 0,
        },
        {
          blobs: new Map([
            ['a_plate', new Blob(['plate'])],
            ['a_logo', new Blob(['logo'])],
          ]),
          analyses: new Map(),
          papers: new Map(),
          boxes: new Map(),
        },
      )
    } finally {
      spy.mockRestore()
    }
    return ellipses
  }

  it('켜져 있으면 접지 그림자를 그린다', async () => {
    expect(await ellipsesDrawn(true)).toBeGreaterThan(0)
  })

  it('꺼져 있으면 한 번도 그리지 않는다', async () => {
    expect(await ellipsesDrawn(false)).toBe(0)
  })
})

// ── §S3 화면 ────────────────────────────────────────────────────────────────

function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('그림자 시험'))
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', {
      id: 'blk_photo',
      label: '제품 사진',
      position: { x: 60, y: 300, width: 300, height: 300 },
    }),
    createBlock('logo', { id: 'blk_logo', label: '로고 자리', position: { x: 420, y: 80, width: 200, height: 120 } }),
  ]
  doc.pages[0]!.canvasHeight = 1000
  return doc
}

function storedAsset(id: string): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, 3])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

function pngFile(name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71, 7])], name, { type: 'image/png' })
}

function Harness() {
  const studio = useStudioJob()
  if (studio === null) return null
  return <AppShell mode="studio" binding={studio.binding} />
}

/** 잰 값 하나 — `fill`만 이 검사가 정하고 나머지는 아무 값이나 둔다. */
function analysisWithFill(fill: number): ImageAnalysis {
  return {
    palette: [{ hex: '#b47040', share: 1 }],
    average: { r: 180, g: 112, b: 64 },
    brightness: 0.5,
    contrast: 0.4,
    saturation: 0.6,
    temperature: 0.3,
    opaqueRatio: 0.3,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    fill,
    light: { x: -0.3, y: 0, confidence: 'low' },
  }
}

describe('§S3 그림을 올린 자리에서 켜고 끈다', () => {
  beforeEach(async () => {
    measured = null
    globalThis.fetch = vi.fn() as unknown as typeof fetch
    resetAssetStoreForTests()
    resetDocumentStoreForTests()
    resetStudioStoreForTests()
    resetFoldsForTests()
    await clearAll()
    await clearAllDocuments()
    await clearAllStudioJobs()
    await putAsset(storedAsset('asset_photo'))
    const doc = sampleDoc()
    const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
    await saveStudioJob({ ...job, productImages: { blk_photo: 'asset_photo' } })
  })

  async function openStudio() {
    render(
      <MemoryRouter initialEntries={['/studio']}>
        <StudioJobProvider>
          <Harness />
        </StudioJobProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelectorAll('.canvas__sheet .block-card').length).toBe(2), {
      timeout: 8000,
    })
  }

  const cardOf = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')).find((el) =>
      (el.getAttribute('aria-label') ?? '').startsWith(label),
    )!

  async function shadowBox(label: string): Promise<HTMLInputElement> {
    const card = cardOf(label)
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
    return within(card).getByRole('checkbox', { name: '그림자' }) as HTMLInputElement
  }

  const effectsOf = async (blockId: string) =>
    (await loadStudioJob(STUDIO_JOB_ID))?.effects?.[blockId]

  it('그림이 걸린 블록에서 바로 끌 수 있고, 그 값이 남는다', async () => {
    await openStudio()
    const box = await shadowBox('제품 사진')
    expect(box.checked).toBe(true)

    fireEvent.click(box)
    await waitFor(async () => expect((await effectsOf('blk_photo'))?.shadow).toBe(false))
    // 껐다고 세기가 지워지지는 않는다 — 다시 켜면 맞춰 둔 값이 그대로 돌아온다.
    expect((await effectsOf('blk_photo'))?.contactShadow).toBe(DEFAULT_COMPOSITE_EFFECTS.contactShadow)

    fireEvent.click(box)
    await waitFor(async () => expect((await effectsOf('blk_photo'))?.shadow).toBe(true))
  })

  it('그림이 안 걸린 자리에는 스위치가 없다', async () => {
    await openStudio()
    const card = cardOf('로고 자리')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
    expect(within(card).queryByRole('checkbox', { name: '그림자' })).toBeNull()
  })

  it('속이 빈 그림을 올리면 꺼진 채로 온다', async () => {
    await openStudio()
    measured = analysisWithFill(0.12)
    const card = cardOf('로고 자리')
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.change(card.querySelector('.block-card__file') as HTMLInputElement, {
      target: { files: [pngFile('logo.png')] },
    })
    await waitFor(async () => expect((await effectsOf('blk_logo'))?.shadow).toBe(false), { timeout: 8000 })
    // 그리고 그 자리에서 바로 되돌릴 수 있다 — 어림짐작이지 판정이 아니다.
    const box = await shadowBox('로고 자리')
    expect(box.checked).toBe(false)
  })

  it('속이 꽉 찬 그림을 올리면 그대로 켜져 있다', async () => {
    await openStudio()
    measured = analysisWithFill(0.85)
    const card = cardOf('로고 자리')
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.change(card.querySelector('.block-card__file') as HTMLInputElement, {
      target: { files: [pngFile('bottle.png')] },
    })
    await waitFor(async () => {
      expect((await loadStudioJob(STUDIO_JOB_ID))?.productImages?.blk_logo).toBeTruthy()
    }, { timeout: 8000 })
    expect((await effectsOf('blk_logo'))?.shadow).not.toBe(false)
  })

  it('그림자를 켜고 끄는 데 외부 호출은 없다', async () => {
    await openStudio()
    const box = await shadowBox('제품 사진')
    fireEvent.click(box)
    await waitFor(async () => expect((await effectsOf('blk_photo'))?.shadow).toBe(false))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
