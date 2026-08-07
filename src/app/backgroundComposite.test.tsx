/**
 * 배경 전용 생성·레이어 합성 집중검사 (배경 합성 1차 §13).
 *
 * 열두 항목을 구현 **전에** 실패로 고정한다. 각 항목은 서로 다른 계약이므로
 * 한 파일이 통째로 무너지지 않게 새 모듈은 검사 안에서 `await import`한다 —
 * 그래야 "몇 개가 빨간가"가 실제 수치로 세어진다.
 *
 * 민감한 실물 이미지는 fixture로 넣지 않는다. 여기서 쓰는 그림은 전부 손으로
 * 만든 투명 배경 PNG 또는 기하학 도형이다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell, AppShellProviders } from './AppShell'
import { BackgroundDialog } from '../components/studio/BackgroundDialog'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { useBackgroundComposite } from '../features/studio/useBackgroundComposite'
import { useBriefDocument } from '../features/document/useBriefDocument'
import { briefReducer, createInitialEditorState } from '../features/editor/briefEditor'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
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
import { createStudioJob, withSource } from '../domain/studioJob'
import type { BriefDocument } from '../domain/pageSchema'
import type { EditorState } from '../features/editor/briefEditor'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))
vi.mock('../services/referenceUpload', () => ({
  // 참고 그림 줄이기는 캔버스를 쓴다. 규칙은 §순수 검사에서 숫자로 재고, 여기서는
  // 원본을 그대로 흘려 보내 "무엇을 보냈는가"만 본다.
  shrinkReference: async (blob: Blob) => blob,
}))
// jsdom에는 2D 캔버스가 없다. 그리는 일 자체는 브라우저 인수검사에서 보고,
// 여기서는 **누가 무엇을 부르는가**를 본다 — 특히 외부로 나가는 호출 수를.
vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async () => new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }),
}))
// 알파 경계 재기도 캔버스 일이다. jsdom은 그림을 디코딩하지 않아 `Image`가
// load도 error도 내지 않으므로, 진짜 함수를 부르면 영영 기다린다.
vi.mock('../services/photoContent', () => ({
  PHOTO_MEASURE_MAX_SIDE: 256,
  measurePhoto: async () => null,
}))
vi.mock('../services/imageAnalysisRunner', () => ({
  ANALYSIS_MAX_SIDE: 256,
  analyzeImageBlob: async () => ({
    palette: [{ hex: '#b47040', share: 1 }],
    average: { r: 180, g: 112, b: 64 },
    brightness: 0.5,
    contrast: 0.4,
    saturation: 0.6,
    temperature: 0.3,
    opaqueRatio: 0.25,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    light: { x: -0.3, y: 0, confidence: 'low' },
  }),
}))

const fetchSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch

/**
 * 아직 없는 모듈을 검사 안에서 부른다.
 *
 * 정적 `import`로 적으면 파일 하나가 통째로 수집 실패가 되어 "몇 항목이
 * 빨간가"를 셀 수 없다. 경로를 실행 시점에 만들어 번들러의 정적 해석을 비켜
 * 가면, 없는 모듈은 그 검사 하나만 무너뜨린다.
 */
const PARENT = '../'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Promise<any> => import(/* @vite-ignore */ `${PARENT}${name}`)

// ── fixtures ────────────────────────────────────────────────────────────────

/** 투명 배경 위의 단색 사각형 — 누끼 대역. 실물 사진이 아니다. */
function cutoutPixels(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const inside = x >= width / 4 && x < (width * 3) / 4 && y >= height / 4 && y < (height * 3) / 4
      if (!inside) continue
      // 왼쪽이 밝고 오른쪽이 어둡다 — 광원 방향 추정이 읽을 기울기.
      const shade = 60 + Math.round((1 - x / width) * 150)
      data[i] = shade
      data[i + 1] = Math.round(shade * 0.6)
      data[i + 2] = Math.round(shade * 0.4)
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/** 이미지 한 장과 그 위에 겹치는 문구 하나. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('배경 합성 시험'))
  const image = createBlock('main_product_image', {
    id: 'blk_image',
    label: '이미지',
    assetId: 'asset_ref',
    position: { x: 120, y: 300, width: 400, height: 400 },
  })
  const text = createBlock('free_text', {
    id: 'blk_text',
    content: '여름 감사제',
    position: { x: 160, y: 340, width: 320, height: 120 },
  })
  doc.pages[0]!.blocks = [image, text]
  doc.pages[0]!.canvasHeight = 1200
  doc.assets = [{ id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' }]
  return doc
}

async function seedJob(doc: BriefDocument) {
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '배경 합성 시험.eventbrief')
  await saveStudioJob({ ...job, productImages: { blk_image: 'asset_product' } })
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

/**
 * 배경 생성 + 원본 합성을 **화면 없이** 부르는 자리.
 *
 * 한방 생성 Patch §1에서 이 방식은 새 화면의 기본 경로가 아니게 됐다 — 상단
 * `이미지 생성하기` 하나가 메인 실행이고, `생성 방식` 카드와 두 단계 버튼은
 * 화면에서 내렸다. 코드는 그대로 있으므로, 이 검사도 그대로 남아 **같은 경계**를
 * 본다: 무엇이 나가는가, 몇 번 나가는가, 무엇이 저장되는가.
 *
 * 확인창(`BackgroundDialog`)은 함께 세운다. 사람이 읽는 문장까지가 §6의 요구였고,
 * 그 문장은 provider의 상태에서 나온다.
 */
function CompositeControls() {
  const composite = useBackgroundComposite()
  const { document: doc } = useBriefDocument()
  if (composite === null) return null
  const page = doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0]
  return (
    <div>
      <span data-testid="composite-blocks">{page?.blocks.length ?? 0}</span>
      <label>
        어떤 배경이면 좋을까요
        <textarea value={composite.wish} onChange={(e) => composite.setWish(e.target.value)} />
      </label>
      {/* 실행은 확인창의 `배경 만들기`뿐이다 — 여기 같은 이름의 버튼을 하나 더
          두면 사람이 확인 없이 지나가는 길이 검사에만 생긴다. */}
      <button type="button" onClick={composite.beginGenerate}>AI로 배경 생성</button>
      <button type="button" onClick={composite.saveComposite}>원본 합성으로 저장</button>
      <BackgroundDialog />
    </div>
  )
}

function CompositeHost() {
  const studio = useStudioJob()
  if (studio === null) return null
  return (
    <AppShellProviders binding={studio.binding} freePlacement>
      <CompositeControls />
    </AppShellProviders>
  )
}

function renderComposite() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <StudioJobProvider>
        <CompositeHost />
      </StudioJobProvider>
    </MemoryRouter>,
  )
}

/** 문서가 붙기 전에 누르면 아직 이 페이지가 아니다. 블록이 선 뒤에 시작한다. */
async function compositeReady(blocks: number) {
  await waitFor(() => expect(screen.getByTestId('composite-blocks').textContent).toBe(String(blocks)), {
    timeout: 5000,
  })
}

/** 캔버스 위의 카드만 — 팔레트와 상단바에도 "이미지"가 붙은 버튼이 있다. */
async function imageCard(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('.canvas__sheet .block-card')).toBeTruthy())
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.canvas__sheet .block-card'))
  const card = cards.find((el) => (el.getAttribute('aria-label') ?? '').startsWith('이미지'))
  expect(card).toBeTruthy()
  return card!
}

/** 이 상태를 편집기 리듀서에 그대로 태운다. */
function editorStateOf(doc: BriefDocument): EditorState {
  const page = doc.pages[0]!
  const base = createInitialEditorState()
  return {
    ...base,
    brief: {
      ...base.brief,
      project: { ...base.brief.project, canvasWidth: page.canvasWidth, canvasHeight: page.canvasHeight },
      blocks: page.blocks.map((b) => ({ ...b, position: { ...b.position } })),
      assets: doc.assets,
    },
    selectedIds: [],
  }
}

beforeEach(async () => {
  fetchSpy.mockReset()
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
  await putAsset(storedAsset('asset_background', 3))
})

// ── 1. 이미지 맞춤 방식 ──────────────────────────────────────────────────────

describe('§13-1 이미지 블록 맞춤 방식', () => {
  it('선택한 이미지 블록에 전체 보이기 / 블록 채우기를 고르는 자리가 있다', async () => {
    await seedJob(sampleDoc())
    const { container } = renderStudio()
    fireEvent.pointerDown(await imageCard(container), { button: 0 })

    expect(await screen.findByRole('button', { name: '전체 보이기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '블록 채우기' })).toBeTruthy()
  })

  it('맞춤 방식은 블록에 기록되고, 없으면 전체 보이기다', async () => {
    const { imageFitOf, DEFAULT_IMAGE_FIT } = await load('domain/imageLayout')
    const plain = createBlock('main_product_image', { id: 'b1' })
    expect(imageFitOf(plain)).toBe(DEFAULT_IMAGE_FIT)
    expect(imageFitOf({ ...plain, image: { fit: 'cover' } })).toBe('cover')
  })
})

// ── 2. 캔버스 밖 배치와 결과 크롭 ────────────────────────────────────────────

describe('§13-2 캔버스 밖 배치', () => {
  it('Studio 편집에서는 블록이 캔버스 위쪽 밖으로 나갈 수 있다', () => {
    const state = { ...editorStateOf(sampleDoc()), freePlacement: true }
    const moved = briefReducer(state, { type: 'MOVE_BLOCK', blockId: 'blk_image', x: 120, y: -220 })
    expect(moved.brief.blocks.find((b) => b.id === 'blk_image')!.position.y).toBe(-220)
  })

  it('작성기 표면의 기존 되돌림은 그대로다', () => {
    const state = editorStateOf(sampleDoc())
    const moved = briefReducer(state, { type: 'MOVE_BLOCK', blockId: 'blk_image', x: 120, y: -220 })
    expect(moved.brief.blocks.find((b) => b.id === 'blk_image')!.position.y).toBe(0)
  })

  it('최종 결과는 캔버스 안쪽만 남긴다', async () => {
    const { cropToCanvas } = await load('domain/imageLayout')
    // 세로 400 블록의 위 220px가 캔버스 밖 → 안쪽 180px만, 원본에서도 위 220을 버린다.
    expect(cropToCanvas({ x: 120, y: -220, width: 400, height: 400 }, 840, 1200)).toEqual({
      sx: 0,
      sy: 220,
      sWidth: 400,
      sHeight: 180,
      dx: 120,
      dy: 0,
      dWidth: 400,
      dHeight: 180,
    })
  })
})

// ── 3. 선택·교체가 레이어 순서를 바꾸지 않는다 ────────────────────────────────

describe('§13-3 선택·교체와 레이어 순서', () => {
  it('블록을 선택해도 그리는 순서가 바뀌지 않는다', async () => {
    await seedJob(sampleDoc())
    const { container } = renderStudio()
    const orderOf = () =>
      Array.from(container.querySelectorAll('.canvas__sheet .block-card')).map((el) =>
        el.getAttribute('aria-label'),
      )
    await waitFor(() => expect(orderOf().length).toBe(2))
    const before = orderOf()

    const card = await imageCard(container)
    fireEvent.pointerDown(card, { button: 0 })

    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
    expect(orderOf()).toEqual(before)
    // 선택만으로 앞으로 끌어올리는 표시가 붙으면 안 된다.
    expect(card.className).not.toContain('is-front')
  })

  it('이미지를 교체해도 배열 순서가 그대로다', () => {
    const state = editorStateOf(sampleDoc())
    const next = briefReducer(state, {
      type: 'ASSIGN_IMAGE',
      blockId: 'blk_image',
      asset: { id: 'asset_new', fileName: 'new.png', mimeType: 'image/png' },
    })
    expect(next.brief.blocks.map((b: { id: string }) => b.id)).toEqual(['blk_image', 'blk_text'])
  })
})

// ── 4. 명시적 레이어 순서 ────────────────────────────────────────────────────

describe('§13-4 수동 레이어 순서', () => {
  it('네 가지 이동이 보이는 블록 사이에서만 자리를 옮긴다', async () => {
    const { reorderBlocks } = await load('domain/layerOrder')
    const blocks = editorStateOf(sampleDoc()).brief.blocks
    expect(reorderBlocks(blocks, 'blk_image', 'front').map((b: { id: string }) => b.id)).toEqual(['blk_text', 'blk_image'])
    expect(reorderBlocks(blocks, 'blk_text', 'back').map((b: { id: string }) => b.id)).toEqual(['blk_text', 'blk_image'])
    expect(reorderBlocks(blocks, 'blk_image', 'forward').map((b: { id: string }) => b.id)).toEqual(['blk_text', 'blk_image'])
    expect(reorderBlocks(blocks, 'blk_image', 'backward').map((b: { id: string }) => b.id)).toEqual(['blk_image', 'blk_text'])
  })

  it('리듀서가 순서를 바꾸고 되돌릴 수 있다', () => {
    const state = editorStateOf(sampleDoc())
    const front = briefReducer(state, { type: 'REORDER_BLOCK', blockId: 'blk_image', move: 'front' })
    expect(front.brief.blocks.map((b: { id: string }) => b.id)).toEqual(['blk_text', 'blk_image'])
    const back = briefReducer(front, { type: 'REORDER_BLOCK', blockId: 'blk_image', move: 'back' })
    expect(back.brief.blocks.map((b: { id: string }) => b.id)).toEqual(['blk_image', 'blk_text'])
  })

  it('고른 블록의 도구막대에서 네 동작을 부른다', async () => {
    await seedJob(sampleDoc())
    const { container } = renderStudio()
    const card = await imageCard(container)
    fireEvent.pointerDown(card, { button: 0 })
    // 순서는 블록 바로 옆에서 바꾼다 — 우측 패널이 아니다 (긴급 Patch §2).
    fireEvent.click(await screen.findByRole('button', { name: '레이어 순서' }))
    for (const name of ['맨 앞으로', '한 단계 앞으로', '한 단계 뒤로', '맨 뒤로']) {
      expect(await screen.findByRole('button', { name })).toBeTruthy()
    }
  })
})

// ── 5. 배경 전용 레이어 ──────────────────────────────────────────────────────

describe('§13-5 배경 전용 레이어', () => {
  it('작업이 페이지별 배경을 하나만 지닌다', async () => {
    const mod = await load('domain/studioJob')
    const doc = sampleDoc()
    const pageId = doc.pages[0]!.id
    const job = createStudioJob(doc, 1_000, STUDIO_JOB_ID)
    const withBg = mod.withPageBackground(job, pageId, { assetId: 'asset_background', source: 'manual' }, 2_000)
    expect(mod.pageBackgroundOf(withBg, pageId)?.assetId).toBe('asset_background')

    const replaced = mod.withPageBackground(withBg, pageId, { assetId: 'asset_ref', source: 'manual' }, 3_000)
    expect(Object.keys(replaced.backgrounds ?? {})).toHaveLength(1)
    expect(mod.pageBackgroundOf(replaced, pageId)?.assetId).toBe('asset_ref')

    const cleared = mod.withoutPageBackground(replaced, pageId, 4_000)
    expect(mod.pageBackgroundOf(cleared, pageId)).toBeUndefined()
  })

  it('배경 자산은 자산 정리가 지우면 안 되는 목록에 든다', async () => {
    const mod = await load('domain/studioJob')
    const doc = sampleDoc()
    const job = mod.withPageBackground(
      createStudioJob(doc, 1_000, STUDIO_JOB_ID),
      doc.pages[0]!.id,
      { assetId: 'asset_background', source: 'manual' },
      2_000,
    )
    expect(mod.studioLiveAssetIds(job)).toContain('asset_background')
  })

  it('배경 넣기·제거 자리가 작업판에 있다', async () => {
    await seedJob(sampleDoc())
    renderStudio()
    expect(await screen.findByRole('button', { name: /배경 넣기/ })).toBeTruthy()
  })
})

// ── 6. 직접 넣은 배경으로 외부 호출 없이 저장 ────────────────────────────────

describe('§13-6 원본 합성으로 저장', () => {
  it('배경이 있으면 API 호출 없이 결과를 만든다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_background', source: 'manual' },
      productImages: { blk_image: 'asset_product' },
      effects: {},
    })
    expect(plan.externalCalls).toBe(0)
    expect(plan.background?.assetId).toBe('asset_background')
    expect(plan.size).toEqual({ width: 840, height: 1200 })
  })
})

// ── 7. 배경 생성 요청에 원본이 실리지 않는다 ─────────────────────────────────

describe('§13-7 배경 요청에 원본 없음', () => {
  it('요청 본문에 파일명·바이트·data URL·Base64·이미지 URL이 없다', async () => {
    const { buildBackgroundRequest } = await load('domain/backgroundRequest')
    const { analyzeCutout } = await load('domain/imageAnalysis')
    const analysis = analyzeCutout(cutoutPixels(64, 64))
    const body = buildBackgroundRequest({
      wish: '따뜻한 베이지 스튜디오 배경',
      size: { width: 840, height: 1200 },
      page: analysis === null ? null : { images: [analysis] },
      images: [{ blockId: 'blk_image', analysis, rect: { x: 120, y: 300, width: 400, height: 400 } }],
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('data:')
    expect(serialized).not.toContain('base64')
    expect(serialized).not.toContain('.png')
    expect(serialized).not.toContain('blob:')
    expect(serialized).not.toContain('http')
    expect(body.prompt.length).toBeGreaterThan(0)
  })

  it('금지 목록이 프롬프트에 그대로 실린다', async () => {
    const { buildBackgroundPrompt } = await load('domain/backgroundPrompt')
    const prompt = buildBackgroundPrompt({
      wish: '따뜻한 베이지 스튜디오 배경',
      size: { width: 840, height: 1200 },
      analysis: null,
      reserved: [],
    })
    for (const banned of ['사람', '제품', '손', '로고', '글자', '가격', '버튼', '워터마크']) {
      expect(prompt).toContain(banned)
    }
    // 정책 우회·역할극 문구는 쓰지 않는다.
    for (const forbidden of ['DAN', '역할극', '무시하고', 'jailbreak']) {
      expect(prompt).not.toContain(forbidden)
    }
  })
})

// ── 8. 생성된 배경이 작업에 저장된다 ─────────────────────────────────────────

describe('§13-8 생성 배경 보존', () => {
  it('배경 생성 결과가 Studio 작업 행에 남는다', async () => {
    const mod = await load('domain/studioJob')
    const doc = sampleDoc()
    const pageId = doc.pages[0]!.id
    const job = mod.withPageBackground(
      createStudioJob(doc, 1_000, STUDIO_JOB_ID),
      pageId,
      { assetId: 'asset_background', source: 'ai', requestedSize: '832x1184' },
      2_000,
    )
    await saveStudioJob(job)
    const reloaded = await loadStudioJob(STUDIO_JOB_ID)
    expect(mod.pageBackgroundOf(reloaded, pageId)?.source).toBe('ai')
    expect(mod.pageBackgroundOf(reloaded, pageId)?.requestedSize).toBe('832x1184')
  })
})

// ── 9. 원본 자산 불변 ────────────────────────────────────────────────────────

describe('§13-9 원본 제품 이미지 불변', () => {
  it('합성 계획은 원본 자산을 읽기만 한다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const before = await getAsset('asset_product')
    const doc = sampleDoc()
    planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_background', source: 'manual' },
      productImages: { blk_image: 'asset_product' },
      effects: { blk_image: { grading: 0.6, rimLight: 0.4 } },
    })
    const after = await getAsset('asset_product')
    expect(after?.byteSize).toBe(before?.byteSize)
    expect(after?.fileName).toBe(before?.fileName)
  })

  it('효과는 렌더링 값으로만 나오고 자산 id를 새로 만들지 않는다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_background', source: 'manual' },
      productImages: { blk_image: 'asset_product' },
      effects: { blk_image: { grading: 0.6 } },
    })
    const layer = plan.layers.find((l: { blockId: string }) => l.blockId === 'blk_image')!
    expect(layer.assetId).toBe('asset_product')
    expect(layer.effects.grading).toBeCloseTo(0.6)
  })
})

// ── 10. 접지 그림자 ──────────────────────────────────────────────────────────

describe('§13-10 그림자', () => {
  it('균일한 외곽 후광이 아니라 접지 그림자를 만든다', async () => {
    const { contactShadow, wallShadow } = await load('domain/compositeEffects')
    const { analyzeCutout } = await load('domain/imageAnalysis')
    const analysis = analyzeCutout(cutoutPixels(64, 64))!
    const rect = { x: 120, y: 300, width: 400, height: 400 }

    const contact = contactShadow(rect, analysis, 1)
    // 제품 하단에 붙은 납작한 타원이다 — 사방으로 같은 거리를 번지지 않는다.
    expect(contact.cy).toBeGreaterThan(rect.y + rect.height * 0.8)
    expect(contact.ry).toBeLessThan(contact.rx / 2)
    expect(contact.opacity).toBeGreaterThan(0)

    const wall = wallShadow(rect, analysis, 1)
    // 광원 반대편으로 밀린다. 이 fixture는 왼쪽이 밝으므로 오른쪽으로.
    expect(wall.dx).toBeGreaterThan(0)
    expect(wall.opacity).toBeLessThan(contact.opacity)
  })

  it('광원 방향은 낮은 신뢰도로 표기된다', async () => {
    const { analyzeCutout } = await load('domain/imageAnalysis')
    const analysis = analyzeCutout(cutoutPixels(64, 64))!
    expect(analysis.light.confidence).toBe('low')
    expect(analysis.light.x).toBeLessThan(0) // 왼쪽에서 오는 빛
    expect(analysis.opaqueRatio).toBeGreaterThan(0.2)
    expect(analysis.opaqueRatio).toBeLessThan(0.3)
    expect(analysis.palette.length).toBeGreaterThanOrEqual(3)
    expect(analysis.palette.length).toBeLessThanOrEqual(5)
  })
})

// ── 11. 작업 파일 왕복 ───────────────────────────────────────────────────────

describe('§13-11 Studio 작업 파일 왕복', () => {
  it('배경·효과 설정이 파일 상태에 담기고 자산 id 재매핑을 따라간다', async () => {
    const mod = await load('domain/studioFile')
    const studioJobMod = await load('domain/studioJob')
    const doc = sampleDoc()
    const pageId = doc.pages[0]!.id
    let job = createStudioJob(doc, 1_000, STUDIO_JOB_ID)
    job = studioJobMod.withPageBackground(job, pageId, { assetId: 'asset_background', source: 'ai' }, 2_000)
    job = studioJobMod.withBlockEffects(job, 'blk_image', { grading: 0.5, contactShadow: 0.8 }, 3_000)

    const state = mod.toStudioFileState(job)
    expect(mod.studioFileAssetIds(state)).toContain('asset_background')

    const remapped = mod.remapStudioFileState(state, new Map([['asset_background', 'asset_bg_2']]))
    expect(remapped.backgrounds?.[pageId]?.assetId).toBe('asset_bg_2')

    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(remapped)))
    expect(parsed?.backgrounds?.[pageId]?.assetId).toBe('asset_bg_2')
    expect(parsed?.effects?.blk_image?.grading).toBeCloseTo(0.5)
  })

  it('예전 판 파일도 그대로 열린다', async () => {
    const mod = await load('domain/studioFile')
    const parsed = mod.parseStudioFileState({
      version: '0.1.0',
      source: null,
      productImages: { blk_image: 'asset_product' },
    })
    expect(parsed?.productImages.blk_image).toBe('asset_product')
    expect(parsed?.backgrounds ?? {}).toEqual({})
  })
})

// ── 12. 기존 전체 AI 생성 무회귀 ─────────────────────────────────────────────

describe('§13-12 기존 전체 AI 생성', () => {
  it('전체 AI 방식은 지금까지처럼 편집 엔드포인트에 이미지를 실어 보낸다', async () => {
    const { requestOpenAiImage } = await load('services/openAiImageClient')
    const captured: { url: string; body: unknown }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured.push({ url, body: init.body })
      return new Response(JSON.stringify({ data: [{ b64_json: 'AAA' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await requestOpenAiImage(
      {
        apiKey: 'sk-test',
        prompt: '기존 방식',
        size: '832x1184',
        images: [{ fileName: 'a.png', blob: new Blob([new Uint8Array([1])], { type: 'image/png' }) }],
      },
      { fetch: fakeFetch },
    )
    expect(captured[0]!.url).toContain('/v1/images/edits')
    expect(captured[0]!.body).toBeInstanceOf(FormData)
  })

  it('배경 전용은 이미지 없이 생성 엔드포인트로 나간다', async () => {
    const { requestOpenAiImage } = await load('services/openAiImageClient')
    const captured: { url: string; body: unknown }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured.push({ url, body: init.body })
      return new Response(JSON.stringify({ data: [{ b64_json: 'AAA' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await requestOpenAiImage(
      { apiKey: 'sk-test', prompt: '빈 광고 배경', size: '832x1184', images: [] },
      { fetch: fakeFetch },
    )
    expect(captured).toHaveLength(1)
    expect(captured[0]!.url).toContain('/v1/images/generations')
    const sent = JSON.parse(String(captured[0]!.body)) as Record<string, unknown>
    expect(sent.model).toBe('gpt-image-2')
    expect(sent.image).toBeUndefined()
    expect(String(captured[0]!.body)).not.toContain('base64')
  })
})

// ── 두 방식이 실제로 다르게 나간다 (§6, §8, §14) ─────────────────────────────

describe('배경 생성 + 원본 합성 흐름', () => {
  it('확인창이 §6의 다섯 가지 사실을 말하고, 실행은 정확히 1회 나간다', async () => {
    await seedJob(sampleDoc())
    sessionStorage.setItem('planmaker.openai-key', 'sk-test-key')
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ image: { b64: btoa('bg'), mimeType: 'image/png' }, metadata: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    renderComposite()
    await compositeReady(2)
    fireEvent.change(await screen.findByRole('textbox', { name: /어떤 배경/ }), {
      target: { value: '따뜻한 베이지 스튜디오' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI로 배경 생성' }))

    const dialog = await screen.findByRole('dialog', { name: '배경 생성 확인' })
    expect(dialog.textContent).toContain('빈 배경 1장')
    expect(dialog.textContent).toContain('1회')
    expect(dialog.textContent).toContain('0회')
    expect(dialog.textContent).toContain('840 × 1200')

    fireEvent.click(screen.getByRole('button', { name: '배경 만들기' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    // 보낸 것: 프롬프트와 크기뿐. 이미지 칸은 비어 있다.
    const body = fetchSpy.mock.calls[0]![1].body as FormData
    expect(body.getAll('images[]')).toHaveLength(0)
    const prompt = String(body.get('prompt'))
    expect(prompt).toContain('따뜻한 베이지 스튜디오')
    expect(prompt).not.toContain('data:')
    expect(prompt).not.toContain('base64')

    // 만든 배경은 이 페이지의 배경으로 저장된다.
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      const pageId = Object.keys(job?.backgrounds ?? {})[0]
      expect(pageId).toBeTruthy()
      expect(job!.backgrounds![pageId!]!.source).toBe('ai')
      expect(job!.backgrounds![pageId!]!.wish).toBe('따뜻한 베이지 스튜디오')
    })
  })

  it('직접 넣은 배경으로 저장하면 외부 호출이 0건이다', async () => {
    const doc = sampleDoc()
    const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000)
    await saveStudioJob({
      ...job,
      productImages: { blk_image: 'asset_product' },
      backgrounds: { [doc.pages[0]!.id]: { assetId: 'asset_background', source: 'manual' } },
      method: 'background_composite',
    })

    renderComposite()
    // 문서가 붙기 전에 누르면 아직 이 페이지가 아니다 — 블록이 선 뒤에.
    await compositeReady(2)
    fireEvent.click(await screen.findByRole('button', { name: '원본 합성으로 저장' }))

    const dialog = await screen.findByRole('dialog', { name: '배경 생성 상태' })
    await waitFor(() => expect(dialog.textContent).toContain('외부 호출 0건'))
    expect(fetchSpy).not.toHaveBeenCalled()

    // 원본 제품 이미지는 그대로다.
    const product = await getAsset('asset_product')
    expect(product?.byteSize).toBe(5)
    expect(product?.fileName).toBe('asset_product.png')
  })
})
