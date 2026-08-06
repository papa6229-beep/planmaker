/**
 * 고정 이미지·컷아웃과 자유 텍스트 레이어 분리 집중검사 (한방 생성 Patch 2).
 *
 * §3이 요구한 원인 판별을 먼저 값으로 고정한다 — 브라우저 합성이 좌표를 옮기는가,
 * 아니면 모델이 받은 대로 다시 그리는가. 그 다음 세 겹 계약을 본다.
 *
 * 실물 이미지는 fixture로 넣지 않는다. 자산은 손으로 만든 바이트다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
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

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 800, height: 800 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }),
}))
vi.mock('../services/photoContent', () => ({
  PHOTO_MEASURE_MAX_SIDE: 256,
  measurePhoto: async () => ({ natural: { width: 800, height: 800 }, box: { x: 0, y: 0, width: 1, height: 1 } }),
}))
vi.mock('../services/paperCutoutShape', () => ({
  buildPaperShape: async () => ({ url: 'data:image/png;base64,AA', pad: 6, content: { width: 100, height: 100 } }),
  buildPaperCanvas: async () => null,
}))
// jsdom은 그림을 디코딩하지 않아 `Image`가 load도 error도 내지 않는다. 진짜
// 함수를 부르면 영영 기다리므로, 분석은 숫자를 바로 돌려주는 것으로 바꾼다.
vi.mock('../services/imageAnalysisRunner', () => ({
  ANALYSIS_MAX_SIDE: 256,
  analyzeImageBlob: async () => ({
    palette: [{ hex: '#b47040', share: 1 }],
    average: { r: 180, g: 112, b: 64 },
    brightness: 0.5,
    contrast: 0.4,
    saturation: 0.6,
    temperature: 0.3,
    // 전경 레이어가 투명하게 돌아온 자리 — 얹어도 아래가 덮이지 않는다.
    opaqueRatio: 0.2,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    light: { x: -0.3, y: 0, confidence: 'low' },
  }),
}))
vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async () => new Blob([new Uint8Array([5, 5, 5, 5, 5])], { type: 'image/png' }),
}))
vi.mock('../services/workingImage', async () => {
  const actual = await vi.importActual<typeof import('../services/workingImage')>('../services/workingImage')
  return {
    ...actual,
    toWorkingImage: async (blob: Blob, target: { width: number; height: number }) => ({
      blob,
      width: target.width,
      height: target.height,
      reencoded: false,
    }),
  }
})

const fetchSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch

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

/** 큰 컷아웃, 작은 컷아웃, 로고(일반 이미지), 큰 문구, 작은 문구. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('고정 오브젝트 시험'))
  doc.pages[0]!.id = 'page_1'
  doc.activePageId = 'page_1'
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', {
      id: 'blk_big',
      label: '큰 컷아웃',
      position: { x: 60, y: 520, width: 520, height: 520 },
    }),
    createBlock('sub_product_image', {
      id: 'blk_small',
      label: '작은 컷아웃',
      position: { x: 600, y: 700, width: 180, height: 180 },
    }),
    createBlock('logo', {
      id: 'blk_logo',
      label: '로고',
      position: { x: 340, y: 60, width: 160, height: 80 },
    }),
    createBlock('free_text', {
      id: 'blk_title',
      label: '큰 문구',
      content: '여름 감사제 40% + 사은품',
      position: { x: 80, y: 180, width: 640, height: 200 },
    }),
    createBlock('free_text', {
      id: 'blk_note',
      label: '작은 문구',
      content: '8/1 ~ 8/14 · 선착순 300명',
      position: { x: 80, y: 400, width: 300, height: 60 },
    }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  return doc
}

const CUTOUTS = { blk_big: { paperCutout: true }, blk_small: { paperCutout: true } }

async function seedJob(extra: Record<string, unknown> = {}) {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '고정.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_big: 'asset_big', blk_small: 'asset_small', blk_logo: 'asset_logo' },
    styleRefs: { page_1: 'asset_style' },
    ...extra,
  })
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

async function documentReady(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll('.canvas__sheet .block-card').length).toBe(5), {
    timeout: 5000,
  })
}

/** 상단 버튼 한 번. 응답은 stub이라 실제 결제는 없다. */
async function generateOnce(calls = 2): Promise<FormData[]> {
  sessionStorage.setItem('planmaker.openai-key', 'sk-stub')
  fetchSpy.mockResolvedValue(
    new Response(
      JSON.stringify({
        image: { b64: btoa('layer-bytes'), mimeType: 'image/png' },
        metadata: { requestedSize: '832x1184' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
  fireEvent.click(await screen.findByRole('button', { name: /이미지 생성하기|다시 생성/ }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /생성 시작|만들기|시작/ }))
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(calls), { timeout: 8000 })
  return fetchSpy.mock.calls.map((c) => c[1].body as FormData)
}

const fileNames = (form: FormData) =>
  form.getAll('images[]').filter((v): v is File => typeof v !== 'string').map((f) => f.name)
const promptOf = (form: FormData) => String(form.get('prompt'))

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
  await putAsset(storedAsset('asset_big', 1))
  await putAsset(storedAsset('asset_small', 2))
  await putAsset(storedAsset('asset_logo', 3))
  await putAsset(storedAsset('asset_style', 4))
})

// ── §3 원인 판별 ────────────────────────────────────────────────────────────

describe('§3 어디서 깨졌는가', () => {
  it('브라우저 최종 합성은 좌표·크기·비율을 그대로 옮긴다', async () => {
    const { fitSourceRect, cropToCanvas } = await load('domain/imageLayout')
    const rect = { x: 60, y: 520, width: 520, height: 520 }

    // 가로로 긴 원본을 `전체 보이기`로 넣으면 비율을 지키며 상자 안에 든다.
    const contain = fitSourceRect('contain', { width: 800, height: 400 }, rect)
    expect(contain.dest.width).toBe(520)
    expect(contain.dest.height).toBe(260)
    expect(contain.dest.width / contain.dest.height).toBeCloseTo(800 / 400, 5)
    expect(contain.dest.x).toBe(60)
    expect(contain.dest.y).toBe(520 + (520 - 260) / 2)

    // `블록 채우기`도 원본 비율을 지킨 채 상자를 채운다 — 늘어나지 않는다.
    const cover = fitSourceRect('cover', { width: 800, height: 400 }, rect)
    expect(cover.dest.width).toBe(520)
    expect(cover.dest.height).toBe(520)
    expect(cover.source.width / cover.source.height).toBeCloseTo(1, 5)

    // 캔버스 안쪽에 든 사각형은 잘리지 않는다.
    expect(cropToCanvas(rect, 840, 1200)).toMatchObject({ dx: 60, dy: 520, dWidth: 520, dHeight: 520 })
  })

  it('이제 어느 요청에도 사용자 이미지 원본이 실리지 않는다', async () => {
    await seedJob({ effects: CUTOUTS })
    const { container } = renderStudio()
    await documentReady(container)
    const [plate, foreground] = await generateOnce()

    for (const form of [plate!, foreground!]) {
      const names = fileNames(form)
      // 붙는 것은 스타일 레퍼런스 한 장뿐이다.
      expect(names).toEqual(['1-style-reference.png'])
      for (const banned of ['big', 'small', 'logo', 'page-layout']) {
        expect(names.some((n) => n.includes(banned))).toBe(false)
      }
      const prompt = promptOf(form)
      expect(prompt).not.toContain('asset_')
      expect(prompt).not.toContain('data:')
      expect(prompt).not.toContain('base64')
    }
  })
})

// ── §1 고정 오브젝트 ────────────────────────────────────────────────────────

describe('§1 이미지와 컷아웃은 고정이다', () => {
  it('배경 플레이트 주문은 모든 이미지 자리를 비우라 하고, 흰 패널·실루엣을 금지한다', async () => {
    const { buildPlatePrompt } = await load('domain/preserveDesign')
    const doc = sampleDoc()
    const prompt = buildPlatePrompt({
      size: { width: 840, height: 1200 },
      styleReferenceAssetId: 'asset_style',
      fixed: [
        { blockId: 'blk_big', assetId: 'asset_big', rect: doc.pages[0]!.blocks[0]!.position, layer: 0, cutout: true },
        { blockId: 'blk_logo', assetId: 'asset_logo', rect: doc.pages[0]!.blocks[2]!.position, layer: 2, cutout: false },
      ],
      note: '가을 느낌으로',
    })

    expect(prompt).toContain('비워 둘 자리')
    expect(prompt).toContain('인물·제품·로고·실루엣을 새로 만들지 않습니다')
    expect(prompt).toContain('흰 패널')
    expect(prompt).toContain('액자')
    // 배경 레이어다 — 완성 디자인이 아니다.
    expect(prompt).toContain('배경 레이어')
    expect(prompt).toContain('글자와 문구')
    expect(prompt).toContain('복제하지 않습니다')
    expect(prompt).toContain('가을 느낌으로')
    // 자리는 좌표로만 간다.
    expect(prompt).not.toContain('asset_big')
    expect(prompt).not.toContain('.png')
  })

  it('붙일 수 있는 것은 스타일 레퍼런스 하나뿐이다', async () => {
    const { preserveAttachmentIds, planPlateInputs, planForegroundInputs } = await load('domain/preserveDesign')
    expect(preserveAttachmentIds(undefined)).toEqual([])
    expect(preserveAttachmentIds('asset_style')).toEqual(['asset_style'])

    const fixed = [{ blockId: 'b', assetId: 'asset_big', rect: { x: 0, y: 0, width: 1, height: 1 }, layer: 0, cutout: true }]
    const plate = planPlateInputs({ size: { width: 840, height: 1200 }, fixed })
    const fore = planForegroundInputs({ size: { width: 840, height: 1200 }, fixed, texts: [] })
    // 레퍼런스가 없으면 아무것도 붙지 않는다 — 고정 오브젝트가 목록에 낄 자리가 없다.
    expect(plate).toEqual([])
    expect(fore).toEqual([])
  })

  it('최종 합성은 모든 이미지 블록을 문서 순서대로, 생성 전 좌표 그대로 얹는다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_plate', source: 'ai' },
      foreground: { assetId: 'asset_fore' },
      productImages: { blk_big: 'asset_big', blk_small: 'asset_small', blk_logo: 'asset_logo' },
      effects: CUTOUTS,
      onlyBlockIds: ['blk_big', 'blk_small', 'blk_logo'],
      includeTexts: false,
    })

    // 셋 다, 그리고 문서 차례 그대로 — 그 차례가 곧 레이어 순서다.
    expect(plan.layers.map((l: { blockId: string }) => l.blockId)).toEqual(['blk_big', 'blk_small', 'blk_logo'])
    expect(plan.layers[0]!.rect).toEqual({ x: 60, y: 520, width: 520, height: 520 })
    expect(plan.layers[1]!.rect).toEqual({ x: 600, y: 700, width: 180, height: 180 })
    expect(plan.layers[2]!.rect).toEqual({ x: 340, y: 60, width: 160, height: 80 })
    expect(plan.layers[0]!.effects.paperCutout).toBe(true)
    expect(plan.layers[2]!.effects.paperCutout).toBe(false)
    // 문구는 AI가 전경 레이어에 그렸다 — 여기서 다시 그리지 않는다.
    expect(plan.texts).toEqual([])
    expect(plan.foreground?.assetId).toBe('asset_fore')
    expect(plan.externalCalls).toBe(0)
  })
})

// ── §2 텍스트는 앞이고 자유롭다 ─────────────────────────────────────────────

describe('§2 문구는 전면 레이어다', () => {
  it('전경 주문은 원문을 그대로 싣고, 자리는 힌트라고 말한다', async () => {
    const { buildForegroundPrompt } = await load('domain/preserveDesign')
    const doc = sampleDoc()
    const blocks = doc.pages[0]!.blocks
    const prompt = buildForegroundPrompt({
      size: { width: 840, height: 1200 },
      styleReferenceAssetId: 'asset_style',
      texts: [
        { blockId: 'blk_note', content: '8/1 ~ 8/14 · 선착순 300명', rect: blocks[4]!.position, align: 'left', layer: 4 },
        { blockId: 'blk_title', content: '여름 감사제 40% + 사은품', rect: blocks[3]!.position, align: 'center', layer: 3 },
      ],
      fixed: [
        { blockId: 'blk_big', assetId: 'asset_big', rect: blocks[0]!.position, layer: 0, cutout: true },
      ],
      tone: { average: { r: 180, g: 112, b: 64 }, brightness: 0.5 },
    })

    // 원문 그대로.
    expect(prompt).toContain('여름 감사제 40% + 사은품')
    expect(prompt).toContain('8/1 ~ 8/14 · 선착순 300명')
    expect(prompt).toContain('문자·숫자·띄어쓰기·기호·줄바꿈')
    // 자리는 힌트다.
    expect(prompt).toContain('고정값이 아니라 힌트')
    expect(prompt).toContain('큰 상자는 핵심 타이틀')
    expect(prompt).toContain('자유롭게 디자인')
    // 넓은 상자가 먼저 온다 — 목록 차례가 위계의 첫 신호다.
    expect(prompt.indexOf('여름 감사제')).toBeLessThan(prompt.indexOf('8/1 ~ 8/14'))
    // 사진 위를 가로질러도 된다.
    expect(prompt).toContain('그 위로 글씨가 지나가도 좋습니다')
    // 배경은 투명해야 한다.
    expect(prompt).toContain('완전히 투명')
    expect(prompt).toContain('불투명한 배경')
    // 아래 배경의 색은 숫자로만 간다.
    expect(prompt).toContain('R180')
    expect(prompt).not.toContain('asset_')
  })

  it('두 번째 요청은 투명 배경을 요구하고, 첫 번째는 요구하지 않는다', async () => {
    await seedJob({ effects: CUTOUTS })
    const { container } = renderStudio()
    await documentReady(container)
    const [plate, foreground] = await generateOnce()

    expect(plate!.get('background')).toBeNull()
    expect(foreground!.get('background')).toBe('transparent')
    // 배경 주문에는 문구 원문이 없고, 전경 주문에는 있다.
    expect(promptOf(plate!)).not.toContain('여름 감사제 40% + 사은품')
    expect(promptOf(foreground!)).toContain('여름 감사제 40% + 사은품')
  })

  it('실패 기록은 항목 이름과 손질한 설명만 남긴다', async () => {
    const { safeProviderDetail } = await load('services/openAiImageClient')

    // 어느 값이 문제였는지는 남는다.
    expect(safeProviderDetail("Invalid value: 'transparent'. Supported values are: 'opaque'."))
      .toBe("Invalid value: 'transparent'. Supported values are: 'opaque'.")

    // 키는 어떤 모양이든 남지 않는다.
    for (const secret of [
      'Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrStUv.',
      'Authorization: Bearer sk-live-1234567890abcdefghij failed.',
    ]) {
      const out = safeProviderDetail(secret) ?? ''
      expect(out).toContain('[redacted]')
      expect(out).not.toContain('sk-')
    }

    // 우리가 보낸 글이 되돌아와도 남지 않는다.
    const echoed = safeProviderDetail(
      `Your prompt was rejected: "${'이벤트 페이지의 전경 문구 레이어 한 장을 만들어 주세요 여름 감사제 40퍼센트'}"`,
    )
    expect(echoed).not.toContain('여름 감사제')
    expect(echoed).toContain('[redacted]')

    // base64 덩어리도 남지 않는다.
    expect(safeProviderDetail(`image data ${'A'.repeat(120)} rejected`)).not.toContain('AAAA')

    // 길어도 200자를 넘기지 않고, 문자열이 아니면 아무것도 남기지 않는다.
    expect((safeProviderDetail('가'.repeat(400)) ?? '').length).toBe(200)
    expect(safeProviderDetail(undefined)).toBeUndefined()
  })

  it('서버 경계가 투명 배경을 그대로 공급자에게 넘긴다', async () => {
    const { handleGenerateImage } = await load('services/generateImageHandler')
    const seen: Record<string, unknown>[] = []
    const requestImage = async (req: Record<string, unknown>) => {
      seen.push(req)
      return { b64: btoa('x'), mimeType: 'image/png' }
    }

    const form = new FormData()
    form.set('prompt', '전경 문구 레이어')
    form.set('size', '832x1184')
    form.set('background', 'transparent')
    await handleGenerateImage(
      new Request('https://x/api/generate-image', {
        method: 'POST',
        headers: { 'X-OpenAI-API-Key': 'sk-stub' },
        body: form,
      }),
      { requestImage },
    )

    const plain = new FormData()
    plain.set('prompt', '배경 레이어')
    plain.set('size', '832x1184')
    await handleGenerateImage(
      new Request('https://x/api/generate-image', {
        method: 'POST',
        headers: { 'X-OpenAI-API-Key': 'sk-stub' },
        body: plain,
      }),
      { requestImage },
    )

    expect(seen[0]!.background).toBe('transparent')
    // 기존 요청은 이 값을 아예 보내지 않는다 — 바이트가 달라지지 않는다.
    expect(seen[1]!.background).toBeUndefined()
  })
})

// ── §4 그리는 순서 ──────────────────────────────────────────────────────────

describe('§4 배경 → 사진 → 문구', () => {
  it('전경 레이어는 모든 사진보다 뒤에 그려진다', async () => {
    // jsdom에는 2D 캔버스가 없다. 순서만 받아 적는 가짜 캔버스를 세운다 —
    // 무엇을 그리는지가 아니라 **어느 차례에** 그리는지가 이 검사의 전부다.
    const drawn: string[] = []
    const tags = new Map<Blob, string>()
    const bitmap = (blob: Blob) => ({ width: 100, height: 100, id: tags.get(blob) ?? '?' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).createImageBitmap = async (blob: Blob) => bitmap(blob)

    let first = true
    const makeCtx = (record: boolean) => ({
      save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, rect() {}, ellipse() {}, fill() {},
      fillRect() {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      drawImage(src: any) { if (record) drawn.push(`image:${String(src?.id ?? 'canvas')}`) },
      fillText(text: string) { if (record) drawn.push(`text:${text}`) },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
      }),
    })
    const original = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return original(tag) as HTMLElement
      const record = first
      first = false
      const ctx = makeCtx(record)
      return {
        width: 0, height: 0, style: {},
        getContext: () => ctx,
        toBlob: (cb: (b: Blob) => void) => cb(new Blob([new Uint8Array([1])], { type: 'image/png' })),
        toDataURL: () => 'data:image/png;base64,AA',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })

    try {
      // 이 파일은 위에서 렌더러를 stub으로 바꿔 두었다. 순서를 보려면 진짜가
      // 필요하므로 여기서만 원본을 불러온다.
      const { renderComposite } = await vi.importActual<typeof import('../services/compositeRenderer')>(
        '../services/compositeRenderer',
      )
      const plate = new Blob(['plate'])
      const photo = new Blob(['photo'])
      const fore = new Blob(['fore'])
      tags.set(plate, 'plate')
      tags.set(photo, 'photo')
      tags.set(fore, 'fore')

      await renderComposite(
        {
          size: { width: 840, height: 1200 },
          background: { assetId: 'a_plate', source: 'ai' },
          foreground: { assetId: 'a_fore' },
          layers: [
            {
              blockId: 'blk_big',
              assetId: 'a_photo',
              rect: { x: 60, y: 520, width: 520, height: 520 },
              fit: 'contain',
              crop: { sx: 0, sy: 0, sWidth: 100, sHeight: 100, dx: 60, dy: 520, dWidth: 520, dHeight: 520 },
              effects: {
                edge: 0, contactShadow: 0, wallShadow: 0, grading: 0, rimLight: 0,
                paperCutout: false, paperWeight: 'normal',
              },
            },
          ],
          texts: [],
          grain: 0,
          externalCalls: 0,
        },
        { blobs: new Map([['a_plate', plate], ['a_photo', photo], ['a_fore', fore]]) },
      )

      // 배경이 먼저, 사진이 그 위, 전경 문구 레이어가 맨 마지막.
      expect(drawn.indexOf('image:plate')).toBeLessThan(drawn.indexOf('image:photo'))
      expect(drawn.indexOf('image:photo')).toBeLessThan(drawn.indexOf('image:fore'))
      expect(drawn.at(-1)).toBe('image:fore')
    } finally {
      spy.mockRestore()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).createImageBitmap
    }
  })

  /**
   * 그린 자리를 받아 적는 가짜 캔버스 (진단 Patch B).
   *
   * jsdom에는 2D 캔버스가 없다. 무엇을 그렸는지가 아니라 **어디에** 그렸는지가
   * 이 검사들의 전부이므로, 좌표만 받아 적는다.
   */
  async function recordDraws(plan: unknown, sources: unknown) {
    const draws: { id: string; args: number[] }[] = []
    const clips: number[][] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).createImageBitmap = async (blob: Blob) => ({
      width: 400,
      height: 400,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: (blob as any).tag ?? '?',
    })
    let first = true
    const makeCtx = (record: boolean) => ({
      save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, ellipse() {}, fill() {},
      fillRect() {},
      rect(...args: number[]) { if (record) clips.push(args) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      drawImage(src: any, ...args: number[]) {
        if (record) draws.push({ id: String(src?.id ?? 'canvas'), args })
      },
      fillText() {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
      }),
    })
    const original = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return original(tag) as HTMLElement
      const record = first
      first = false
      const ctx = makeCtx(record)
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await renderComposite(plan as any, sources as any)
      return { draws, clips }
    } finally {
      spy.mockRestore()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).createImageBitmap
    }
  }

  /** 이 계획의 뼈대 — 검사마다 블록 하나만 바꾼다. */
  const onePhotoPlan = (rect: { x: number; y: number; width: number; height: number }, crop: unknown) => ({
    size: { width: 840, height: 1000 },
    layers: [
      {
        blockId: 'blk',
        assetId: 'a_photo',
        rect,
        fit: 'contain' as const,
        crop,
        effects: {
          edge: 0, contactShadow: 0, wallShadow: 0, grading: 0, rimLight: 0,
          paperCutout: true, paperWeight: 'normal' as const,
        },
      },
    ],
    texts: [],
    grain: 0,
    externalCalls: 0 as const,
  })

  it('내용 상자가 블록을 채우도록 앉히고, 종이는 블록에 붙는다', async () => {
    const photo = Object.assign(new Blob(['photo']), { tag: 'photo' })
    const rect = { x: 100, y: 200, width: 200, height: 200 }
    const { draws } = await recordDraws(
      onePhotoPlan(rect, { sx: 0, sy: 0, sWidth: 400, sHeight: 400, dx: 100, dy: 200, dWidth: 200, dHeight: 200 }),
      {
        blobs: new Map([['a_photo', photo]]),
        // 그림의 가운데 절반만 불투명한 진짜 누끼.
        boxes: new Map([['blk', { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }]]),
        papers: new Map([['blk', { canvas: { id: 'paper' }, pad: 6, content: { width: 100, height: 100 } }]]),
      },
    )

    // 사진: 내용 상자가 블록을 정확히 채우도록 그림 전체가 두 배로 앉는다.
    const image = draws.find((d) => d.id === 'photo' && d.args.length === 8)!
    expect(image.args.slice(4)).toEqual([0, 100, 400, 400])
    // → 가운데 절반은 (100, 200, 200, 200) = 블록 그대로.

    // 종이: 블록에서 pad 비율(6/100)만큼 사방으로 나간다 — 사진이 앉은 자리가
    // 아니라 **블록**이 기준이다.
    const paper = draws.find((d) => d.id === 'paper')!
    expect(paper.args).toEqual([100 - 200 * 0.06, 200 - 200 * 0.06, 200 * 1.12, 200 * 1.12])
  })

  it('캔버스 밖은 경계에서 잘리기만 하고, 그림은 줄지도 옮겨지지도 않는다', async () => {
    const { cropToCanvas } = await load('domain/imageLayout')
    const photo = Object.assign(new Blob(['photo']), { tag: 'photo' })
    // 왼쪽으로 50 걸친 블록.
    const rect = { x: -50, y: 0, width: 200, height: 200 }
    const crop = cropToCanvas(rect, 840, 1000)
    expect(crop).toMatchObject({ dx: 0, dy: 0, dWidth: 150, dHeight: 200 })

    const { draws, clips } = await recordDraws(onePhotoPlan(rect, crop), {
      blobs: new Map([['a_photo', photo]]),
      boxes: new Map([['blk', { x: 0, y: 0, width: 1, height: 1 }]]),
    })

    // 자르는 것은 캔버스 경계뿐이다.
    expect(clips).toContainEqual([0, 0, 150, 200])
    // 그림이 앉은 자리는 블록 그대로 — 잘린 만큼 줄어들지 않는다.
    const image = draws.find((d) => d.id === 'photo' && d.args.length === 8)!
    expect(image.args.slice(4)).toEqual([-50, 0, 200, 200])
  })

  it('한 번 눌러 두 번 나가고, 확인창이 그 수를 그대로 말한다', async () => {
    await seedJob({ effects: CUTOUTS })
    const { container } = renderStudio()
    await documentReady(container)

    sessionStorage.setItem('planmaker.openai-key', 'sk-stub')
    fireEvent.click(await screen.findByRole('button', { name: /이미지 생성하기|다시 생성/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('2회')
    expect(dialog.textContent).toContain('3장')
  })

  it('생성이 끝나면 합성 결과가 남고 원본 바이트는 그대로다', async () => {
    await seedJob({ effects: CUTOUTS })
    const { container } = renderStudio()
    await documentReady(container)
    await generateOnce()

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.results?.page_1?.assetId).toBeTruthy()
    }, { timeout: 8000 })

    for (const id of ['asset_big', 'asset_small', 'asset_logo']) {
      const asset = await getAsset(id)
      expect(asset?.byteSize).toBe(5)
      expect(asset?.fileName).toBe(`${id}.png`)
    }
  })
})
