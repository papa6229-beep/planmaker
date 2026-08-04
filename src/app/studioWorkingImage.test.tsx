/**
 * 최종 작업 이미지는 언제나 `840 × 페이지 세로길이` (마감 교정 §3).
 *
 * 모델이 받아 주는 크기와 우리가 쓰는 크기는 다르다. 모델은 두 변이 16의 배수인
 * 것만 받으므로 840을 보낼 수 없어 832가 되고, 쇼핑몰과 기획서는 840이어야 한다.
 * 그 차이를 화면이 감추면, 사람은 832짜리 파일을 840인 줄 알고 쓴다.
 *
 * 그리고 이 변환은 **이미 결제된 결과** 위에서 일어난다. 변환이 실패했다고 원본을
 * 버리면 돈만 쓰고 아무것도 남지 않는다. 그래서 실패해도 원본은 손에 남고, 다시
 * 맞추는 동안 OpenAI를 한 번도 부르지 않는다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, getAsset, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
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
import { toWorkingImage, workingImageTarget, WORKING_IMAGE_WIDTH } from '../services/workingImage'
import { resolveGptImageSize } from '../domain/gptImageSize'

/**
 * fake-indexeddb를 거쳐 온 Blob은 jsdom에서 다시 읽히지 않는다. 그래서 무엇이
 * 저장됐는지는 **바이트 수**로 가른다 — 가짜 캔버스가 크기를 글자로 적어 두므로
 * 길이가 곧 신원이다. 모델 원본('image-from-model')과 길이가 겹치지 않는다.
 */
function markerBytes(text: string): number {
  return new Blob([text]).size
}

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
}))

/**
 * 캔버스는 jsdom에 없다. 그림을 재고 다시 그리는 부분만 갈아 끼우고, 크기 규칙과
 * 저장·복구 흐름은 진짜 코드를 그대로 지나가게 한다. 실제 픽셀 확인은 브라우저
 * 인수검사가 맡는다.
 */
const fakeCanvas = {
  /** 다음에 재면 나올 크기 — 모델이 돌려준 그림의 크기를 흉내 낸다. */
  sourceSize: { width: 832, height: 1488 },
  drawCalls: 0,
  failDraw: false,
}
vi.mock('../services/canvasImageOps', () => ({
  measureImage: async () => ({ ...fakeCanvas.sourceSize }),
  drawToSize: async (_blob: Blob, width: number, height: number) => {
    fakeCanvas.drawCalls += 1
    if (fakeCanvas.failDraw) throw new Error('캔버스 변환 실패(주입)')
    // 크기를 바이트에 적어 둔다 — 나중에 저장된 것이 무엇인지 이걸로 본다.
    return new Blob([`drawn:${String(width)}x${String(height)}`], { type: 'image/png' })
  },
}))

const FAKE_KEY = 'sk-working-image-key'
const FAKE_PNG_B64 = 'aW1hZ2UtZnJvbS1tb2RlbA==' // "image-from-model"

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

function readyDoc(canvasHeight: number) {
  const doc = createEmptyDocument(createEmptyProject('작업본 크기'))
  const slot = createBlock('main_product_image', {
    id: 'blk_image',
    content: '제품 컷',
    assetId: 'asset_ref',
    position: { x: 100, y: 100, width: 600, height: 400 },
  })
  slot.image = { referenceOnly: true }
  doc.pages[0]!.blocks = [slot]
  doc.pages[0]!.canvasHeight = canvasHeight
  doc.assets = [{ id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' }]
  return doc
}

let calls: number
let respond: () => Promise<Response>

async function seed(canvasHeight: number): Promise<void> {
  const doc = readyDoc(canvasHeight)
  await saveStudioJob(
    linkProductImage(withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief'), 'blk_image', 'asset_cut'),
  )
  await putAsset(storedAsset('asset_ref', 1))
  await putAsset(storedAsset('asset_cut', 2))
}

beforeEach(async () => {
  calls = 0
  fakeCanvas.sourceSize = { width: 832, height: 1488 }
  fakeCanvas.drawCalls = 0
  fakeCanvas.failDraw = false
  respond = async () =>
    new Response(
      JSON.stringify({
        image: { b64: FAKE_PNG_B64, mimeType: 'image/png' },
        metadata: { model: 'gpt-image-2', quality: 'medium', requestedSize: '832x1488', requestId: 'req_1' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  globalThis.fetch = vi.fn(async () => {
    calls += 1
    return respond()
  }) as unknown as typeof fetch

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
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('작업본 크기')
  }, { timeout: 8000 })
}

async function generateOnce(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /이미지 생성하기|다시 생성하기/ }))
  const field = screen.queryByLabelText('테스트용 OpenAI API 키')
  if (field !== null) {
    fireEvent.change(field, { target: { value: FAKE_KEY } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
  } else {
    fireEvent.click(screen.getByRole('button', { name: '생성 시작' }))
  }
}

// ── 크기 규칙 (순수) ─────────────────────────────────────────────────────────

describe('§3 작업본 크기 규칙', () => {
  it('is always 840 wide and as tall as the page', () => {
    expect(workingImageTarget(1488)).toEqual({ width: 840, height: 1488 })
    expect(workingImageTarget(1000)).toEqual({ width: 840, height: 1000 })
    expect(WORKING_IMAGE_WIDTH).toBe(840)
  })

  it('redraws a 832x1488 model result as 840x1488', async () => {
    let drawn: { width: number; height: number } | null = null
    const result = await toWorkingImage(new Blob(['model']), workingImageTarget(1488), {
      measure: async () => ({ width: 832, height: 1488 }),
      draw: async (_b, width, height) => {
        drawn = { width, height }
        return new Blob(['drawn'])
      },
    })
    expect(drawn).toEqual({ width: 840, height: 1488 })
    expect(result).toMatchObject({ width: 840, height: 1488, reencoded: true })
  })

  it('follows the page height wherever it goes', async () => {
    for (const height of [960, 1488, 2100]) {
      const seen: number[] = []
      await toWorkingImage(new Blob(['m']), workingImageTarget(height), {
        measure: async () => ({ width: 832, height: 1488 }),
        draw: async (_b, w, h) => {
          seen.push(w, h)
          return new Blob(['d'])
        },
      })
      expect(seen).toEqual([840, height])
    }
  })

  it('leaves an image that is already the right size alone', async () => {
    const source = new Blob(['already right'])
    let drawCalls = 0
    const result = await toWorkingImage(source, workingImageTarget(1488), {
      measure: async () => ({ width: 840, height: 1488 }),
      draw: async () => {
        drawCalls += 1
        return new Blob(['d'])
      },
    })
    expect(drawCalls).toBe(0)
    expect(result.reencoded).toBe(false)
    // 받은 그대로다 — 다시 인코딩하지 않았다.
    expect(result.blob).toBe(source)
  })
})

// ── 생성 흐름 ────────────────────────────────────────────────────────────────

describe('§3 생성 결과는 840 작업본으로 저장된다', () => {
  it('stores the 840-wide working copy, not the model original', async () => {
    await seed(1488)
    await openStudio()
    await generateOnce()

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(Object.keys(job?.results ?? {})).toHaveLength(1)
    }, { timeout: 8000 })

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const result = job.results[job.doc.pages[0]!.id]!
    // 모델 규격과 작업본 규격이 따로 남는다.
    expect(result.requestedSize).toBe('832x1488')
    expect(result.workingSize).toBe('840x1488')

    const asset = await getAsset(result.assetId)
    expect(asset!.byteSize).toBe(markerBytes('drawn:840x1488'))
    expect(asset!.byteSize).not.toBe(markerBytes('image-from-model'))
    expect(fakeCanvas.drawCalls).toBe(1)
    // 변환에 외부 호출은 없다.
    expect(calls).toBe(1)
  }, 20000)

  it('uses the page height that is actually open', async () => {
    await seed(960)
    await openStudio()
    await generateOnce()
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(Object.keys(job?.results ?? {})).toHaveLength(1)
    }, { timeout: 8000 })

    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const result = job.results[job.doc.pages[0]!.id]!
    expect(result.workingSize).toBe('840x960')
    expect((await getAsset(result.assetId))!.byteSize).toBe(markerBytes('drawn:840x960'))
  }, 20000)

  it('does not re-encode a result that already arrives at the working size', async () => {
    fakeCanvas.sourceSize = { width: 840, height: 1488 }
    await seed(1488)
    await openStudio()
    await generateOnce()
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(Object.keys(job?.results ?? {})).toHaveLength(1)
    }, { timeout: 8000 })
    expect(fakeCanvas.drawCalls).toBe(0)
  }, 20000)

  it('tells the person both sizes before spending anything', async () => {
    await seed(1488)
    await openStudio()
    fireEvent.click(screen.getByRole('button', { name: '이미지 생성하기' }))
    const dialog = screen.getByRole('dialog', { name: '이미지 생성' })
    expect(dialog.textContent).toContain('AI 생성 규격')
    // 모델 규격은 16의 배수 규칙이 정한 값 그대로다 — 840은 여기 올 수 없다.
    const modelSize = resolveGptImageSize(840, 1488)
    expect(modelSize.ok).toBe(true)
    if (!modelSize.ok) return
    expect(modelSize.width).toBe(832)
    expect(dialog.textContent).toContain(modelSize.size)
    expect(dialog.textContent).toContain('최종 작업 이미지')
    expect(dialog.textContent).toContain('840x1488')
    expect(dialog.textContent).toContain('1회')
    expect(calls).toBe(0)
  }, 20000)
})

// ── 변환 실패 ────────────────────────────────────────────────────────────────

describe('§3 변환이 실패해도 결제한 결과를 잃지 않는다', () => {
  it('keeps the paid original and says exactly what failed', async () => {
    fakeCanvas.failDraw = true
    await seed(1488)
    await openStudio()
    await generateOnce()

    await waitFor(
      () => expect(screen.getByText('이미지는 생성됐지만 840px 작업본 변환에 실패했습니다')).toBeTruthy(),
      { timeout: 8000 },
    )
    expect(calls).toBe(1)
    // 저장된 결과는 아직 없다 — 그러나 원본은 손에 남아 있다.
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(Object.keys(job.results ?? {})).toHaveLength(0)
    expect(screen.getByRole('button', { name: '작업본 다시 만들기' })).toBeTruthy()
  }, 20000)

  it('re-converts the same original without calling OpenAI again', async () => {
    fakeCanvas.failDraw = true
    await seed(1488)
    await openStudio()
    await generateOnce()
    await waitFor(
      () => expect(screen.getByText('이미지는 생성됐지만 840px 작업본 변환에 실패했습니다')).toBeTruthy(),
      { timeout: 8000 },
    )

    fakeCanvas.failDraw = false
    fireEvent.click(screen.getByRole('button', { name: '작업본 다시 만들기' }))

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(Object.keys(job?.results ?? {})).toHaveLength(1)
    }, { timeout: 8000 })

    // 다시 만드는 동안 외부 호출은 한 번도 늘지 않는다.
    expect(calls).toBe(1)
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const result = job.results[job.doc.pages[0]!.id]!
    expect(result.workingSize).toBe('840x1488')
    expect((await getAsset(result.assetId))!.byteSize).toBe(markerBytes('drawn:840x1488'))
  }, 25000)

  it('leaves the brief exactly as it was', async () => {
    fakeCanvas.failDraw = true
    await seed(1488)
    await openStudio()
    const before = (await loadStudioJob(STUDIO_JOB_ID))!
    await generateOnce()
    await waitFor(
      () => expect(screen.getByText('이미지는 생성됐지만 840px 작업본 변환에 실패했습니다')).toBeTruthy(),
      { timeout: 8000 },
    )
    const after = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(after.doc).toEqual(before.doc)
    expect(after.productImages).toEqual(before.productImages)
    expect(after.source?.fileName).toBe(before.source?.fileName)
  }, 20000)
})
