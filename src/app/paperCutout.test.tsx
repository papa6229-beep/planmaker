/**
 * 종이 컷아웃 집중검사 (Studio Patch §6).
 *
 * 열 항목을 구현 **전에** 실패로 고정한다. 새 모듈은 검사 안에서 부르므로,
 * 없는 모듈이 파일 전체를 무너뜨리지 않고 몇 항목이 빨간지 세어진다.
 *
 * 실물 이미지는 fixture로 넣지 않는다. 알파 채널이 필요한 자리에는 손으로 만든
 * 원·사각형 픽셀 배열을 쓴다 — 지시서의 두 시험 파일과 같은 성질(투명 배경 +
 * 0~255 알파)이면 계약을 고정하는 데 충분하다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { StudioJobProvider, useStudioJob } from '../features/studio/useStudioJob'
import { createBlock, createEmptyProject } from '../domain/factory'
import { createEmptyDocument } from '../domain/pageSchema'
import { documentFingerprint } from '../domain/documentFingerprint'
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
  return { ...actual, readImageSize: async () => ({ width: 670, height: 670 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

const fetchSpy = vi.fn()
globalThis.fetch = fetchSpy as unknown as typeof fetch

const PARENT = '../'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): Promise<any> => import(/* @vite-ignore */ `${PARENT}${name}`)

// ── fixtures ────────────────────────────────────────────────────────────────

/** 투명 배경 위의 원 하나 — 사각형이 아닌 알파 외곽. */
function circlePixels(size: number, radius: number) {
  const data = new Uint8ClampedArray(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      if ((x - c) ** 2 + (y - c) ** 2 > radius * radius) continue
      data[i] = 210
      data[i + 1] = 120
      data[i + 2] = 80
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
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

/** 제품 이미지 두 자리와 로고 한 자리, 그리고 문구 하나. */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('종이 컷아웃 시험'))
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', {
      id: 'blk_a',
      label: '이미지 가',
      position: { x: 60, y: 400, width: 300, height: 300 },
    }),
    createBlock('sub_product_image', {
      id: 'blk_b',
      label: '이미지 나',
      position: { x: 420, y: 400, width: 300, height: 300 },
    }),
    createBlock('logo', { id: 'blk_logo', label: '로고', position: { x: 340, y: 80, width: 160, height: 120 } }),
    createBlock('sub_product_image', {
      id: 'blk_empty',
      label: '빈 이미지',
      position: { x: 60, y: 780, width: 200, height: 200 },
    }),
    createBlock('free_text', {
      id: 'blk_text',
      label: '문구',
      content: '여름 감사제',
      position: { x: 200, y: 240, width: 320, height: 100 },
    }),
  ]
  doc.pages[0]!.canvasHeight = 1200
  return doc
}

async function seedJob(extra: Record<string, unknown> = {}) {
  const doc = sampleDoc()
  const job = withSource(createStudioJob(doc, 1_000, STUDIO_JOB_ID), doc, 1_000, '종이 컷아웃.eventbrief')
  await saveStudioJob({
    ...job,
    productImages: { blk_a: 'asset_a', blk_b: 'asset_b', blk_logo: 'asset_logo' },
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

async function cardOf(container: HTMLElement, label: string): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('.canvas__sheet .block-card')).toBeTruthy())
  const card = Array.from(container.querySelectorAll<HTMLElement>('.canvas__sheet .block-card')).find(
    (el) => (el.getAttribute('aria-label') ?? '').startsWith(label),
  )
  expect(card, `"${label}" 카드를 찾지 못함`).toBeTruthy()
  return card!
}

/** 그 카드를 고르고, 도구막대의 종이 컷아웃 체크를 돌려준다. */
async function cutoutBox(container: HTMLElement, label: string): Promise<HTMLInputElement> {
  const card = await cardOf(container, label)
  fireEvent.pointerDown(card, { button: 0 })
  await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
  return within(card).getByRole('checkbox', { name: '종이 컷아웃' }) as HTMLInputElement
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
  await putAsset(storedAsset('asset_a', 1))
  await putAsset(storedAsset('asset_b', 2))
  await putAsset(storedAsset('asset_logo', 3))
})

// ── 1·2. 어디에 보이고, 무엇이 기본값인가 ────────────────────────────────────

describe('§6-1·2 체크 항목의 자리와 기본값', () => {
  it('제품 이미지가 연결된 블록에만 나타난다', async () => {
    await seedJob()
    const { container } = renderStudio()

    // 연결된 자리에는 있다.
    expect(await cutoutBox(container, '이미지 가')).toBeTruthy()

    // 빈 이미지 자리와 문구에는 없다.
    for (const label of ['빈 이미지', '문구']) {
      const card = await cardOf(container, label)
      fireEvent.pointerDown(card, { button: 0 })
      await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
      expect(within(card).queryByRole('checkbox', { name: '종이 컷아웃' })).toBeNull()
    }
  })

  it('기본값은 꺼짐이다', async () => {
    await seedJob()
    const { container } = renderStudio()
    expect((await cutoutBox(container, '이미지 가')).checked).toBe(false)

    const { paperCutoutOf } = await load('domain/studioJob')
    expect(paperCutoutOf(null, 'blk_a')).toBe(false)
    expect(paperCutoutOf({ effects: {} }, 'blk_a')).toBe(false)
    expect(paperCutoutOf({ effects: { blk_a: {} } }, 'blk_a')).toBe(false)
  })
})

// ── 3·4·6. 고른 하나에만, 껐다 켰다 ──────────────────────────────────────────

describe('§6-3·4·6 한 블록에만 걸리고 원래대로 돌아온다', () => {
  it('체크한 블록에만 효과가 붙고 다른 이미지·로고는 그대로다', async () => {
    await seedJob()
    const { container } = renderStudio()
    const box = await cutoutBox(container, '이미지 가')
    fireEvent.click(box)

    await waitFor(async () =>
      expect((await cardOf(container, '이미지 가')).className).toContain('block-card--paper'),
    )
    expect((await cardOf(container, '이미지 나')).className).not.toContain('block-card--paper')
    expect((await cardOf(container, '로고')).className).not.toContain('block-card--paper')

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_a?.paperCutout).toBe(true)
      expect(job?.effects?.blk_b?.paperCutout ?? false).toBe(false)
      expect(job?.effects?.blk_logo?.paperCutout ?? false).toBe(false)
    })
  })

  it('체크를 해제하면 원본 모습으로 돌아온다', async () => {
    await seedJob({ effects: { blk_a: { paperCutout: true } } })
    const { container } = renderStudio()
    const box = await cutoutBox(container, '이미지 가')
    expect(box.checked).toBe(true)
    expect((await cardOf(container, '이미지 가')).className).toContain('block-card--paper')

    fireEvent.click(box)
    await waitFor(async () =>
      expect((await cardOf(container, '이미지 가')).className).not.toContain('block-card--paper'),
    )
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_a?.paperCutout).toBe(false)
    })
  })
})

// ── 5. 사각형이 아니라 실제 알파 외곽 ────────────────────────────────────────

describe('§6-5 알파 외곽을 따르는 종이 테두리', () => {
  it('원 이미지에서 원형 테두리가 나오고 모서리는 비어 있다', async () => {
    const { paperMask, paperOffsets, paperPad, paperSeed } = await load('domain/paperCutout')
    const size = 64
    const radius = 20
    const source = circlePixels(size, radius)
    const pad = paperPad({ width: size, height: size })
    expect(pad).toBeGreaterThan(1)

    const mask = paperMask(source, pad, paperOffsets(pad, paperSeed('asset_a')))
    // 바깥으로 확장된 만큼 커진다.
    expect(mask.width).toBe(size + pad * 2)
    expect(mask.height).toBe(size + pad * 2)

    const at = (x: number, y: number) => mask.data[y * mask.width + x] ?? 0
    // 사각형이 아니다 — 네 모서리는 비어 있어야 한다.
    for (const [x, y] of [
      [0, 0],
      [mask.width - 1, 0],
      [0, mask.height - 1],
      [mask.width - 1, mask.height - 1],
    ]) {
      expect(at(x!, y!)).toBe(0)
    }
    // 원 안쪽은 종이다.
    const c = pad + (size - 1) / 2
    expect(at(Math.round(c), Math.round(c))).toBeGreaterThan(0)
    // 원 바로 바깥, 확장 폭의 절반쯤 되는 자리도 종이다.
    expect(at(Math.round(c + radius + pad * 0.4), Math.round(c))).toBeGreaterThan(0)
    // 확장 폭을 훨씬 넘어선 자리는 종이가 아니다.
    expect(at(Math.round(c + radius + pad * 2.2), Math.round(c))).toBe(0)
  })

  it('같은 블록은 언제나 같은 외곽 형태다', async () => {
    const { paperOffsets, paperSeed } = await load('domain/paperCutout')
    const a = paperOffsets(8, paperSeed('asset_a'))
    const b = paperOffsets(8, paperSeed('asset_a'))
    const other = paperOffsets(8, paperSeed('asset_b'))
    expect(a).toEqual(b)
    expect(a).not.toEqual(other)
    // 규칙적인 원이 아니다 — 반지름이 각도마다 흔들린다.
    const radii = a.map((o: { dx: number; dy: number }) => Math.hypot(o.dx, o.dy))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.5)
  })
})

// ── 7·8. 편집과 왕복을 지나도 남는다 ─────────────────────────────────────────

describe('§6-7·8 편집과 저장을 지나도 남는다', () => {
  it('이동·크기 조절·레이어 변경 뒤에도 상태가 그대로다', async () => {
    await seedJob({ effects: { blk_a: { paperCutout: true } } })
    const { container } = renderStudio()
    const card = await cardOf(container, '이미지 가')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))

    // 레이어 순서를 바꾼다.
    fireEvent.click(within(card).getByRole('button', { name: '레이어 순서' }))
    fireEvent.click(within(card).getByRole('button', { name: '맨 앞으로' }))
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('.canvas__sheet .block-card')).at(-1)?.getAttribute('aria-label'),
      ).toContain('이미지 가'),
    )

    const moved = await cardOf(container, '이미지 가')
    expect(moved.className).toContain('block-card--paper')
    expect((within(moved).getByRole('checkbox', { name: '종이 컷아웃' }) as HTMLInputElement).checked).toBe(true)
  })

  it('작업 파일에 담기고 예전 파일은 꺼짐으로 읽힌다', async () => {
    const mod = await load('domain/studioFile')
    const studioJob = await load('domain/studioJob')
    const doc = sampleDoc()
    let job = createStudioJob(doc, 1_000, STUDIO_JOB_ID)
    job = studioJob.withBlockEffects(job, 'blk_a', { paperCutout: true }, 2_000)

    const state = mod.toStudioFileState(job)
    const parsed = mod.parseStudioFileState(JSON.parse(JSON.stringify(state)))
    expect(parsed?.effects?.blk_a?.paperCutout).toBe(true)

    // 이 값을 모르는 예전 파일은 꺼짐이다.
    const old = mod.parseStudioFileState({
      version: '0.2.0',
      source: null,
      productImages: { blk_a: 'asset_a' },
      effects: { blk_a: { grading: 0.5 } },
    })
    expect(old?.effects?.blk_a?.paperCutout).toBe(false)
    expect(old?.effects?.blk_a?.grading).toBeCloseTo(0.5)
  })
})

// ── 복제와 삭제 ──────────────────────────────────────────────────────────────

describe('§4 복제와 삭제', () => {
  it('블록을 복제하면 효과 상태도 함께 간다', async () => {
    await seedJob({ effects: { blk_a: { paperCutout: true } } })
    const { container } = renderStudio()
    const card = await cardOf(container, '이미지 가')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))

    // ⋯ 메뉴는 <summary>라 버튼 역할이 아니다. 열고 나서 항목을 누른다.
    fireEvent.click(card.querySelector('.block-card__menu-trigger')!)
    fireEvent.click(within(card).getByRole('button', { name: '블록 복제' }))

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      const on = Object.entries(job?.effects ?? {}).filter(([, e]) => (e as { paperCutout?: boolean }).paperCutout)
      expect(on.length).toBe(2)
    })
  })

  it('블록을 지우면 그 상태도 함께 정리된다', async () => {
    await seedJob({ effects: { blk_a: { paperCutout: true }, blk_b: { paperCutout: true } } })
    const { container } = renderStudio()
    const card = await cardOf(container, '이미지 나')
    fireEvent.pointerDown(card, { button: 0 })
    await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))

    fireEvent.click(card.querySelector('.block-card__menu-trigger')!)
    fireEvent.click(within(card).getByRole('button', { name: '삭제' }))

    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_b).toBeUndefined()
      expect(job?.effects?.blk_a?.paperCutout).toBe(true)
    })
  })
})

// ── 9·10. 원본과 외부 호출 ───────────────────────────────────────────────────

describe('§6-9·10 원본과 외부 호출', () => {
  it('원본 바이트와 기획서 지문이 그대로다', async () => {
    await seedJob()
    const before = await getAsset('asset_a')
    const fingerprintBefore = documentFingerprint(sampleDoc())

    const { container } = renderStudio()
    fireEvent.click(await cutoutBox(container, '이미지 가'))
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_a?.paperCutout).toBe(true)
    })

    const after = await getAsset('asset_a')
    expect(after?.byteSize).toBe(before?.byteSize)
    expect(after?.fileName).toBe(before?.fileName)
    const job = await loadStudioJob(STUDIO_JOB_ID)
    expect(documentFingerprint(job!.doc)).toBe(fingerprintBefore)
  })

  it('외부 호출이 0건이다', async () => {
    await seedJob()
    const { container } = renderStudio()
    fireEvent.click(await cutoutBox(container, '이미지 가'))
    await waitFor(async () => {
      const job = await loadStudioJob(STUDIO_JOB_ID)
      expect(job?.effects?.blk_a?.paperCutout).toBe(true)
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('합성 계획이 종이 컷아웃 여부를 그대로 실어 나른다', async () => {
    const { planLocalComposite } = await load('domain/composite')
    const doc = sampleDoc()
    const plan = planLocalComposite({
      page: doc.pages[0]!,
      background: { assetId: 'asset_bg', source: 'manual' },
      productImages: { blk_a: 'asset_a', blk_b: 'asset_b' },
      effects: { blk_a: { paperCutout: true } },
    })
    const a = plan.layers.find((l: { blockId: string }) => l.blockId === 'blk_a')
    const b = plan.layers.find((l: { blockId: string }) => l.blockId === 'blk_b')
    expect(a.effects.paperCutout).toBe(true)
    expect(b.effects.paperCutout).toBe(false)
    // 미리보기와 같은 씨앗을 쓴다 — 두 화면의 외곽선이 같아야 하기 때문이다.
    expect(a.assetId).toBe('asset_a')
  })
})

// ── 화면에 없는 것 ───────────────────────────────────────────────────────────

describe('§2 우측 패널에는 같은 기능을 두지 않는다', () => {
  it('블록 배치 칸에 종이 컷아웃이 없다', async () => {
    await seedJob()
    const { container } = renderStudio()
    await cutoutBox(container, '이미지 가')
    const panel = await screen.findByRole('region', { name: '블록 배치' })
    expect(within(panel).queryByRole('checkbox', { name: '종이 컷아웃' })).toBeNull()
    expect(panel.textContent).not.toContain('종이 컷아웃')
  })
})
