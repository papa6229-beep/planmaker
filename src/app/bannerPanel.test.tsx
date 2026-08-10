/**
 * `배너 뽑기` 버튼 한 번 (배너 Patch §4).
 *
 * 앞의 세 조각 — 규칙표·배치기·조각 잇기 — 은 각각 검사가 있다. 여기서 붙드는 것은
 * 그것들이 **화면에서 실제로 이어져 있는가**다. 배치기가 아무리 옳아도, 버튼이
 * 그것을 부르지 않거나 결과를 화면에 못 올리면 아무 일도 일어나지 않는다.
 *
 * 그리고 여기서만 볼 수 있는 것이 하나 있다. **배너를 만드는 데 모델을 부르지
 * 않는가.** 도메인 함수는 계획에 `externalCalls: 0`을 적을 뿐이고, 그 계획을
 * 실행하는 자리에서 누가 `fetch`를 하는지는 화면을 켜 봐야 안다. 이 값이 깨지면
 * 배너 다섯 장이 다섯 번의 유료 호출이 된다.
 *
 * 나머지 절반은 **버린 것을 말하는가**다. 배너는 버리는 일이고, 무엇을 버렸는지
 * 말하지 않으면 사람이 그 배너를 믿고 그대로 내보낸다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearAllStudioJobs, loadStudioJob, resetStudioStoreForTests, saveStudioJob, STUDIO_JOB_ID } from '../services/studioStore'
import { createStudioJob, withSource, type StudioJob } from '../domain/studioJob'
import { createEmptyDocument, type BriefDocument } from '../domain/pageSchema'
import { documentFingerprint } from '../domain/documentFingerprint'
import { createBlock, createEmptyProject } from '../domain/factory'
import { resetFoldsForTests } from '../components/studio/PanelFold'
import type { CompositePlan } from '../domain/composite'

/** 합성기가 받은 계획들. 배너가 무엇을 그리라고 했는지는 여기에만 남는다. */
let rendered: CompositePlan[] = []

vi.mock('../services/compositeRenderer', () => ({
  renderComposite: async (plan: CompositePlan) => {
    rendered.push(plan)
    return new Blob([new Uint8Array([137, 80, 78, 71, 9])], { type: 'image/png' })
  },
}))
vi.mock('../services/compositeSources', () => ({
  collectCompositeSources: async () => ({
    blobs: new Map(),
    analyses: new Map(),
    papers: new Map(),
    boxes: new Map(),
  }),
}))
// 화소를 읽는 두 자리는 캔버스가 필요하다. 규칙 자체는 각자의 검사가 붙든다.
vi.mock('../services/bannerPixels', () => ({
  pickQuietRegion: async () => ({ x: 0, y: 640, width: 840, height: 58 }),
  cropBackground: async () => new Blob([new Uint8Array([137, 80, 78, 71, 5])], { type: 'image/png' }),
  readEdgeColors: async () => [{ side: 'left', hex: '#354151' }, { side: 'right', hex: '#354151' }],
}))
vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 640, height: 640 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
}))

function storedAsset(id: string): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, 3])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 5,
  }
}

/**
 * 이벤트 하나 — 제목·CTA·상품 뭉치·기간·로고·주의 문구.
 *
 * 규격 하나에 다 들어가지 않는 구성이다. 그래야 "무엇을 버렸는지 말하는가"를
 * 볼 수 있다.
 */
function sampleDoc(): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject('텐가 사고 선물받자'))
  doc.pages[0]!.blocks = [
    createBlock('main_headline', { id: 'blk_title', label: '메인 문구', content: '텐가 사고, 선물 받자', position: { x: 60, y: 100, width: 520, height: 150 } }),
    createBlock('cta_button', { id: 'blk_cta', label: 'CTA 버튼', content: '바로 보러 가기', position: { x: 300, y: 980, width: 220, height: 60 } }),
    createBlock('product_group_image', { id: 'blk_prod', label: '제품 그룹', assetId: 'asset_prod', position: { x: 80, y: 400, width: 620, height: 430 } }),
    createBlock('gift', { id: 'blk_g1', label: '사은품 1', content: '텐가 스피너', position: { x: 80, y: 860, width: 240, height: 260 } }),
    createBlock('gift', { id: 'blk_g2', label: '사은품 2', content: '플레이 젤', position: { x: 340, y: 860, width: 240, height: 260 } }),
    createBlock('gift', { id: 'blk_g3', label: '사은품 3', content: '추가 증정', position: { x: 600, y: 860, width: 240, height: 260 } }),
    createBlock('period', { id: 'blk_period', label: '기간', content: '07.01 ~ 07.31', position: { x: 300, y: 300, width: 260, height: 56 } }),
    createBlock('logo', { id: 'blk_logo', label: '로고', assetId: 'asset_logo', position: { x: 60, y: 40, width: 300, height: 60 } }),
    createBlock('caution_text', { id: 'blk_caution', label: '주의 문구', content: '재고 소진 시 조기종료', position: { x: 60, y: 1080, width: 620, height: 60 } }),
  ]
  doc.pages[0]!.canvasHeight = 1180
  doc.assets = []
  return doc
}

/** 완성본까지 끝난 작업 — 배경과 문구 조각이 남아 있다. */
function finishedJob(): StudioJob {
  const doc = sampleDoc()
  const pageId = doc.pages[0]!.id
  const job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, 'a.eventbrief')
  // 진짜 지문을 쓴다. 가짜를 쓰면 처음부터 낡은 것이라 "배너 때문에 낡았는가"를
  // 물을 수가 없다.
  const fingerprint = documentFingerprint(doc)
  return {
    ...job,
    productImages: { blk_prod: 'asset_prod', blk_logo: 'asset_logo' },
    backgrounds: { [pageId]: { assetId: 'asset_bg', source: 'ai' } },
    results: { [pageId]: { pageId, assetId: 'asset_result', model: 'gpt-image-2', quality: 'medium', requestedSize: '832x1104', sourceFingerprint: fingerprint, createdAt: 1 } },
    textObjects: {
      [pageId]: [
        { blockId: 'blk_title', assetId: 'asset_title', rect: { x: 60, y: 100, width: 520, height: 150 }, layer: 8 },
        { blockId: 'blk_cta', assetId: 'asset_cta', rect: { x: 300, y: 980, width: 220, height: 60 }, layer: 9 },
        { blockId: 'blk_g1', assetId: 'asset_g1', rect: { x: 80, y: 860, width: 240, height: 260 }, layer: 4 },
        { blockId: 'blk_g2', assetId: 'asset_g2', rect: { x: 340, y: 860, width: 240, height: 260 }, layer: 5 },
        { blockId: 'blk_g3', assetId: 'asset_g3', rect: { x: 600, y: 860, width: 240, height: 260 }, layer: 6 },
      ],
    },
    imageObjects: {
      [pageId]: [{ blockId: 'blk_prod', assetId: 'asset_prod', rect: { x: 80, y: 400, width: 620, height: 430 }, layer: 2 }],
    },
  }
}

let fetched: string[] = []

beforeEach(async () => {
  rendered = []
  fetched = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

  sessionStorage.clear()
  localStorage.clear()
  resetFoldsForTests()
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
  await saveStudioJob(finishedJob())
  for (const id of ['asset_prod', 'asset_logo', 'asset_bg', 'asset_result', 'asset_title', 'asset_cta', 'asset_g1', 'asset_g2', 'asset_g3']) {
    await putAsset(storedAsset(id))
  }
})

afterEach(() => cleanup())

async function openStudio(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
  await waitFor(
    () => {
      expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('텐가 사고 선물받자')
    },
    { timeout: 8000 },
  )
}

const bannerPanel = () => screen.getByRole('region', { name: '배너 뽑기' })

/** 완성본 화면으로 넘어간다 — 오른쪽 패널이 거기서만 나온다. */
async function showResult(): Promise<void> {
  fireEvent.click(screen.getByRole('radio', { name: '완성본' }))
  await screen.findByRole('button', { name: /배너 뽑기/ }, { timeout: 8000 })
}

async function makeBanner(): Promise<void> {
  await openStudio()
  await showResult()
  fireEvent.click(screen.getByRole('button', { name: /배너 뽑기/ }))
  fireEvent.click(within(bannerPanel()).getByRole('button', { name: '1020×70 만들기' }))
  // 그려진 것만으로는 이르다 — 안내가 화면에 오를 때까지 기다린다.
  await waitFor(() => {
    expect(rendered.length).toBeGreaterThan(0)
    expect(within(bannerPanel()).queryByText(/끝단 색/)).not.toBeNull()
  }, { timeout: 8000 })
}

describe('§35-1 완성본이 있어야 나온다', () => {
  it('결과가 없으면 배너 자리도 없다', async () => {
    // 만든 적 없는 완성본에서 배너를 지어낼 수는 없다.
    const job = finishedJob()
    await saveStudioJob({ ...job, results: {} })
    await openStudio()
    expect(screen.queryByRole('button', { name: /배너 뽑기/ })).toBeNull()
  })

  it('결과가 있으면 배너를 뽑을 수 있다', async () => {
    await openStudio()
    await showResult()
    expect(screen.getByRole('button', { name: /배너 뽑기/ })).toBeTruthy()
  })
})

describe('§35-2 배너는 규격대로 그려진다', () => {
  it('합성기가 배너 크기를 받는다', async () => {
    await makeBanner()
    expect(rendered.at(-1)!.size).toEqual({ width: 1020, height: 70 })
  })

  it('완성본의 조각을 그대로 쓴다 — 다시 만들지 않는다', async () => {
    await makeBanner()
    const plan = rendered.at(-1)!
    expect(plan.textObjects?.map((t) => t.assetId).toSorted()).toEqual([
      'asset_cta',
      'asset_g1',
      'asset_g2',
      'asset_g3',
      'asset_title',
    ])
  })

  it('조각이 배너 안으로 들어온다', async () => {
    await makeBanner()
    for (const object of rendered.at(-1)!.textObjects ?? []) {
      expect(object.rect.x).toBeGreaterThanOrEqual(0)
      expect(object.rect.x + object.rect.width).toBeLessThanOrEqual(1020)
      expect(object.rect.y + object.rect.height).toBeLessThanOrEqual(70)
    }
  })

  it('잘라 구운 배경을 쓴다 — 원본 배경이 아니다', async () => {
    // 계획에 크롭을 실어 보내면 사람이 조각을 옮긴 뒤 다시 합칠 때 그 경로가
    // 크롭을 몰라 배경이 가운데로 돌아간다. 잘라서 한 장으로 구워 두면 그런
    // 자리가 아예 없다.
    await makeBanner()
    const used = rendered.at(-1)!.background?.assetId
    expect(used).toBeDefined()
    expect(used).not.toBe('asset_bg')
  })
})

describe('§35-3 배너를 만드는 데 돈이 들지 않는다', () => {
  it('모델을 한 번도 부르지 않는다', async () => {
    // 이 검사가 깨지면 배너 다섯 장이 다섯 번의 유료 호출이 된다.
    await makeBanner()
    expect(fetched.filter((url) => url.includes('/api/'))).toEqual([])
  })

  it('계획 스스로도 외부 호출이 없다고 말한다', async () => {
    await makeBanner()
    expect(rendered.at(-1)!.externalCalls).toBe(0)
  })
})

describe('§35-4 버린 것을 말한다', () => {
  it('자리가 없어 뺀 것을 이름으로 알린다', async () => {
    // 아무 말 없이 빠지면 사람이 그 배너를 믿고 그대로 내보낸다. 로고는 제목·제품·
    // 사은품이 자리를 다 채워 들어갈 곳이 없다.
    await makeBanner()
    const note = within(bannerPanel()).getByText(/자리가 없어 뺐습니다/).textContent ?? ''
    expect(note).toContain('로고')
  })

  it('완성본에 그림이 없는 블록을 알린다', async () => {
    // 기간은 자리를 얻었지만 그 블록의 조각이 없다. 조용히 넘기면 그 자리는 빈
    // 채로 나가고, 아무도 왜 비었는지 모른다.
    await makeBanner()
    const note = within(bannerPanel()).getByText(/이 블록의 그림이 없습니다/).textContent ?? ''
    expect(note).toContain('기간')
  })

  it('배너에 가지 않는 것은 알리지 않는다', async () => {
    // 주의 문구는 애초에 갈 것이 아니다. 이것까지 적으면 경고가 늘 켜져 있어
    // 아무도 안 읽게 된다.
    await makeBanner()
    expect(within(bannerPanel()).queryByText(/주의 문구/)).toBeNull()
  })

  it('끝단 색을 함께 내놓는다', async () => {
    // 사람이 스포이드로 찍던 값이다.
    await makeBanner()
    expect(within(bannerPanel()).getAllByText(/#354151/).length).toBeGreaterThan(0)
  })

  it('형제 규격을 함께 일러 준다', async () => {
    // 840×78은 따로 배치하지 않고 이 배치를 다른 크기로 저장하는 것이다.
    await makeBanner()
    expect(within(bannerPanel()).getByText(/840×78/)).toBeTruthy()
  })

  it('저장은 완성본과 같은 길로 간다고 알려 준다', async () => {
    // 배너도 한 장의 완성본이다. 저장 버튼을 두 개 두면 어느 것이 무엇을 내놓는지
    // 사람이 매번 헷갈린다.
    await makeBanner()
    expect(within(bannerPanel()).getByText(/이미지 저장/)).toBeTruthy()
  })
})

describe('§35-5 배너는 페이지가 된다', () => {
  it('만들면 그 배너 페이지로 넘어간다', async () => {
    // 페이지가 되어야 완성본 화면의 편집이 통째로 따라온다 — 끌어 옮기기, 크기
    // 조절, 앞뒤, 삭제, 확대.
    await makeBanner()
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]
      expect(bannerId).toBeDefined()
      expect(job.doc.pages.some((p) => p.id === bannerId)).toBe(true)
    }, { timeout: 9000 })
  }, 15_000)

  it('배너 줄에 나오고, 페이지 탭에는 나오지 않는다', async () => {
    // 페이지 탭이 뜻하는 것은 "이벤트 페이지가 몇 장인가"다. 배너가 끼면 흐려진다.
    await makeBanner()
    const strip = await screen.findByRole('group', { name: '만든 배너' }, { timeout: 9000 })
    expect(within(strip).getByRole('button', { name: '1020×70' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /배너 1020×70/ })).toBeNull()
  }, 15_000)

  it('배너의 블록은 원본과 다른 번호를 받는다', async () => {
    // 같은 번호를 쓰면 배너 조각 하나를 어둡게 눌렀을 뿐인데 메인 이벤트 페이지의
    // 같은 조각도 함께 어두워진다 — 효과·톤·제품 이미지가 전부 블록 번호에 매달려
    // 있기 때문이다.
    await makeBanner()
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      const ids = new Set((job.textObjects?.[bannerId] ?? []).map((o) => o.blockId))
      expect(ids.size).toBeGreaterThan(0)
      expect([...ids].every((id) => id.startsWith(bannerId))).toBe(true)
      expect(ids.has('blk_title')).toBe(false)
    }, { timeout: 9000 })
  }, 15_000)
})

describe('§35-6 조각 서랍', () => {
  it('배너에 없는 조각을 이름으로 늘어놓는다', async () => {
    // 자동은 버리는 일을 한다. 뺀 것을 되돌릴 방법이 없으면, 가장 작은 규격은
    // 아무것도 못 만드는 화면이 된다.
    await makeBanner()
    fireEvent.click(await screen.findByRole('button', { name: /조각 서랍/ }, { timeout: 3500 }))
    const drawer = screen.getByRole('region', { name: '조각 서랍' })
    // 로고는 자리가 없어 빠졌다. 서랍에는 있어야 한다.
    expect(within(drawer).getByRole('button', { name: /로고/ })).toBeTruthy()
  }, 15_000)

  it('꺼내면 배너에 놓인다', async () => {
    await makeBanner()
    fireEvent.click(await screen.findByRole('button', { name: /조각 서랍/ }, { timeout: 3500 }))
    const drawer = screen.getByRole('region', { name: '조각 서랍' })
    fireEvent.click(within(drawer).getByRole('button', { name: /로고/ }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      const ids = (job.imageObjects?.[bannerId] ?? []).map((o) => o.blockId)
      expect(ids.some((id) => id.endsWith('blk_logo'))).toBe(true)
    }, { timeout: 3500 })
  }, 15_000)

  it('이벤트 페이지에는 서랍이 없다', async () => {
    // 이벤트 페이지에는 조각이 이미 다 놓여 있다.
    await openStudio()
    await showResult()
    expect(screen.queryByRole('region', { name: '조각 서랍' })).toBeNull()
  })
})
