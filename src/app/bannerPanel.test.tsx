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
import { normalizeEffects } from '../domain/compositeEffects'
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
/**
 * 압축만 대신한다. jsdom의 IndexedDB를 한 번 다녀온 Blob은 JSZip이 읽지 못하는데,
 * 그것은 이 검사가 묻는 것(무엇이 몇 장 나가는가)과 상관없는 환경의 사정이다.
 * 자산을 꺼내는 `collectSavedImages`는 진짜를 쓴다 — 없는 자산을 조용히 넘기는
 * 결함은 그쪽에서 잡혀야 한다.
 */
vi.mock('../services/imageSave', async () => {
  const actual = await vi.importActual<typeof import('../services/imageSave')>('../services/imageSave')
  return { ...actual, zipSavedImages: async () => new Blob([new Uint8Array([80, 75])]) }
})

/**
 * GIF를 짜는 일은 캔버스가 필요하다. 여기서 묻는 것은 **켜고 끄는 길이 저장까지
 * 이어지는가**이고, 픽셀과 바이트는 각자의 검사가 붙든다.
 */
vi.mock('../services/blinkGif', () => ({
  BLINK_DELAY_CS: 50,
  renderBlinkGif: async () => new Blob([new Uint8Array([71, 73, 70])], { type: 'image/gif' }),
}))

/** `이미지 저장`이 실제로 내놓은 파일들. 이름만 봐도 무엇이 나갔는지 안다. */
let downloaded: string[] = []
vi.mock('../services/downloadFile', () => ({
  downloadBlob: (_blob: Blob, fileName: string) => {
    downloaded.push(fileName)
  },
}))
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
    // 제품 뭉치에 종이 컷아웃이 걸려 있다 — 이 설정이 배너 조각을 따라오는지가
    // 손검수에서 걸린 자리다.
    effects: { blk_prod: normalizeEffects({ paperCutout: true, paperWeight: 0.35, paperOpacity: 0.5 }) },
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
  downloaded = []
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
  fireEvent.click(within(bannerPanel()).getByRole('button', { name: '1020×70 뽑기' }))
  // 그려진 것만으로는 이르다 — 안내가 화면에 오를 때까지 기다린다.
  await waitFor(() => {
    expect(rendered.length).toBeGreaterThan(0)
    expect(within(bannerPanel()).queryByText(/끝단 색/)).not.toBeNull()
  }, { timeout: 8000 })
}

describe('§35-0 완성본을 보는 동안 기획서 탭이 없다', () => {
  it('완성본을 보고 있으면 중앙 보기 줄이 사라진다', async () => {
    // 손검수: "이미 이미지 생성하기 해서 부분수정만 남은 단계라면 저걸 그냥 눈에
    // 보이지만 않게라도 해야지. 왜 눈에 보여야 하는지 모르겠고."
    await openStudio()
    expect(screen.getByRole('radiogroup', { name: '중앙 보기' })).toBeTruthy()
    await showResult()
    expect(screen.queryByRole('radiogroup', { name: '중앙 보기' })).toBeNull()
  })

  it('기획서로 가는 문은 작업 메뉴에 남아 있다', async () => {
    // 길까지 없애면 기획서를 고쳐 다시 뽑을 수가 없다.
    await openStudio()
    await showResult()
    fireEvent.click(screen.getByRole('button', { name: '작업 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: '기획서 보기' }))
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: '중앙 보기' })).toBeTruthy())
  })
})

describe('§35-0b 작업 목록', () => {
  it('배너를 뽑기 전에도 이벤트 페이지 하나로 서 있다', async () => {
    // 목록이 배너가 생겨야만 나오면, 배너를 안 쓰는 사람은 저장 버튼을 영영 못 본다.
    await openStudio()
    await showResult()
    const strip = screen.getByRole('group', { name: '작업 목록' })
    expect(within(strip).getByText('이벤트 페이지')).toBeTruthy()
    expect(within(strip).queryByText('배너')).toBeNull()
    expect(within(strip).getByRole('button', { name: '이 이미지 저장' })).toBeTruthy()
  })

})

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

  it('첫 화면에는 조각이 하나도 올라오지 않는다', async () => {
    // 손검수: "이벤트 페이지는 자동 배치를 해 주지, 왜냐 크니까. 하지만 배너는
    // 작은 것들이 많아." 조각이 하나라도 실리면 걷어낸 자동 배치가 돌아온 것이다.
    await makeBanner()
    const plan = rendered.at(-1)!
    expect(plan.textObjects ?? []).toEqual([])
    expect(plan.layers).toEqual([])
  })

  it('작업에도 빈 목록으로 적힌다', async () => {
    // **없는 목록과 빈 목록은 다르다.** 없으면 다시 합칠 때 기획서 블록에서
    // 다시 세어 전부 그려 버린다.
    await makeBanner()
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      expect(job.textObjects?.[bannerId]).toEqual([])
      expect(job.imageObjects?.[bannerId]).toEqual([])
    }, { timeout: 9000 })
  }, 15_000)

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

describe('§35-4 뽑고 나서 알려 주는 것', () => {
  it('작업자가 적어 준 크기가 전부 버튼으로 서 있다', async () => {
    // 손검수: "내가 지정했던 사이즈는 기본으로 다 있어야해."
    await openStudio()
    await showResult()
    fireEvent.click(screen.getByRole('button', { name: /배너 뽑기/ }))
    for (const name of ['178×90', '840×640', '1020×70', '800×250', '602×70']) {
      expect(within(bannerPanel()).getByRole('button', { name: `${name} 뽑기` })).toBeTruthy()
    }
  })

  it('크기를 고쳐 저장하면 버튼이 바뀐다', async () => {
    // 손검수: "이 프리셋 사이즈는 수정 변경 저장 가능하게."
    await openStudio()
    await showResult()
    fireEvent.click(screen.getByRole('button', { name: /배너 뽑기/ }))
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '크기 고치기' }))
    const width = within(bannerPanel()).getByLabelText('프리셋 1 가로')
    fireEvent.change(width, { target: { value: '300' } })
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '저장' }))
    await waitFor(() => {
      expect(within(bannerPanel()).getByRole('button', { name: '300×90 뽑기' })).toBeTruthy()
      expect(within(bannerPanel()).queryByRole('button', { name: '178×90 뽑기' })).toBeNull()
    })
    // 그리고 **다시 열어도 남아 있어야** 한다. 화면 안에서만 바뀌면 저장이 아니다.
    cleanup()
    resetFoldsForTests()
    await openStudio()
    await showResult()
    fireEvent.click(screen.getByRole('button', { name: /배너 뽑기/ }))
    await waitFor(() => expect(within(bannerPanel()).getByRole('button', { name: '300×90 뽑기' })).toBeTruthy())
  }, 20_000)

  it('기본값으로 되돌릴 수 있다', async () => {
    await openStudio()
    await showResult()
    fireEvent.click(screen.getByRole('button', { name: /배너 뽑기/ }))
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '크기 고치기' }))
    fireEvent.change(within(bannerPanel()).getByLabelText('프리셋 1 가로'), { target: { value: '300' } })
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(within(bannerPanel()).getByRole('button', { name: '300×90 뽑기' })).toBeTruthy())
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '크기 고치기' }))
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '기본값으로' }))
    await waitFor(() => expect(within(bannerPanel()).getByRole('button', { name: '178×90 뽑기' })).toBeTruthy())
  }, 15_000)

  it('끝단 색을 함께 내놓는다', async () => {
    // 사람이 스포이드로 찍던 값이다.
    await makeBanner()
    expect(within(bannerPanel()).getAllByText(/#354151/).length).toBeGreaterThan(0)
  })

  it('형제 크기도 버튼으로 뽑을 수 있다', async () => {
    // 손검수: "같은 배치로 500×387도 저장하세요 라고 써 있는데 무슨 수로 저장해?"
    // 적어만 놓고 길을 주지 않았다.
    await makeBanner()
    for (const name of ['250×135', '500×387', '840×78', '700×153']) {
      expect(within(bannerPanel()).getByRole('button', { name: `${name} 뽑기` })).toBeTruthy()
    }
  }, 15_000)

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

  it('작업 목록에 나오고, 페이지 탭에는 나오지 않는다', async () => {
    // 페이지 탭이 뜻하는 것은 "이벤트 페이지가 몇 장인가"다. 배너가 끼면 흐려진다.
    await makeBanner()
    const strip = await screen.findByRole('group', { name: '작업 목록' }, { timeout: 9000 })
    expect(within(strip).getByRole('button', { name: '1020×70' })).toBeTruthy()
    // 이벤트 페이지와 배너가 이름 붙은 두 무리로 갈린다 (작업 목록 Patch).
    expect(within(strip).getByText('이벤트 페이지')).toBeTruthy()
    expect(within(strip).getByText('배너')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /배너 1020×70/ })).toBeNull()
  }, 15_000)

  it('같은 줄에서 이벤트 페이지로 돌아간다', async () => {
    // 손검수: "이벤트 페이지로 돌아가는 버튼이 없어." 좌상단 `기획서`를 눌러
    // 합치기 전 화면을 보고, 거기서 `1페이지`를 누르고, 다시 `완성본`을 눌러야
    // 제자리로 왔다 — 세 번 눌러 두 번 엉뚱한 화면을 지나는 길이었다.
    await makeBanner()
    const strip = await screen.findByRole('group', { name: '작업 목록' }, { timeout: 9000 })
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const bannerId = Object.keys(job.bannerPages ?? {})[0]!
    const source = job.doc.pages.find((p) => !p.id.startsWith('banner_'))!
    // 배너를 보고 있다. 돌아갈 자리가 이 줄에 함께 서 있어야 한다.
    expect(within(strip).getByRole('button', { name: source.title })).toBeTruthy()
    // 기획서를 한 번 들렀다 오는 길을 그대로 재현한다 — 손검수가 걸린 자리다.
    // 기획서로 가는 문은 상단 `작업 메뉴` 안에 있다 (기획서 탭 감추기 Patch).
    fireEvent.click(screen.getByRole('button', { name: '작업 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: '기획서 보기' }))
    fireEvent.click(within(strip).getByRole('button', { name: source.title }))
    await waitFor(async () => {
      const after = (await loadStudioJob(STUDIO_JOB_ID))!
      expect(after.doc.activePageId).toBe(source.id)
      expect(after.doc.activePageId).not.toBe(bannerId)
    }, { timeout: 9000 })
    // 그리고 곧장 완성본이다 — 기획서를 한 번 더 지나지 않는다. 완성본을 보고
    // 있으면 그 줄 자체가 사라진다 (기획서 탭 감추기 Patch).
    await waitFor(() => {
      expect(screen.queryByRole('radiogroup', { name: '중앙 보기' })).toBeNull()
    }, { timeout: 3500 })
  }, 20_000)

  it('배너의 블록은 원본과 다른 번호를 받는다', async () => {
    // 같은 번호를 쓰면 배너 조각 하나를 어둡게 눌렀을 뿐인데 메인 이벤트 페이지의
    // 같은 조각도 함께 어두워진다 — 효과·톤·제품 이미지가 전부 블록 번호에 매달려
    // 있기 때문이다.
    await makeBanner()
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      const banner = job.doc.pages.find((p) => p.id === bannerId)
      // 블록은 **전부** 데려온다 — 이미지 조각은 제 블록이 페이지에 있어야
      // 합성에 실리므로, 하나라도 빠지면 서랍에서 꺼내도 안 그려진다.
      expect(banner?.blocks).toHaveLength(9)
      expect(banner!.blocks.every((b) => b.id.startsWith(bannerId))).toBe(true)
      expect(banner!.blocks.some((b) => b.id === 'blk_title')).toBe(false)
    }, { timeout: 9000 })
  }, 15_000)
})

async function openDrawer(): Promise<HTMLElement> {
  await makeBanner()
  fireEvent.click(await screen.findByRole('button', { name: /조각 서랍/ }, { timeout: 3500 }))
  return screen.getByRole('region', { name: '조각 서랍' })
}

describe('§35-7 배너 저장과 이어받기', () => {
  it('배너를 보면서 저장하면 그 배너 한 장이다', async () => {
    // 손검수: "저대로 이미지 저장하면 840×640, 원본 이벤트 이미지, 그리고 다른
    // 사이즈 작업 완료한 배너가 압축파일로 저장되던데?"
    await makeBanner()
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 3500 })
    // 이름도 페이지 번호가 아니라 크기다 — 폴더에서 찾는 것은 언제나 크기다.
    expect(downloaded[0]).toContain('1020x70')
    expect(downloaded[0]).not.toContain('.zip')
  }, 15_000)

  it('전부 저장은 이벤트 페이지와 배너를 한 묶음으로 낸다', async () => {
    // 손검수: "단독 저장도 중요하지만 전체 이미지 저장도 중요해." 작업이 끝나면
    // 한꺼번에 넘긴다 — 하나씩 눌러 내려받고 폴더에서 다시 모으면 실수가 난다.
    await makeBanner()
    const strip = await screen.findByRole('group', { name: '작업 목록' }, { timeout: 9000 })
    fireEvent.click(within(strip).getByRole('button', { name: '전부 저장 2장' }))
    // 압축은 jsdom에서 느리다. 그리고 실패하면 화면이 그렇게 말하므로 함께 본다.
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: '이미지 저장 실패' })).toBeNull()
      expect(downloaded).toHaveLength(1)
    }, { timeout: 12000 })
    expect(downloaded[0]).toContain('.zip')
  }, 20_000)

  it('저장할 것이 한 장뿐이면 전부 저장은 없다', async () => {
    // 두 버튼이 같은 일을 하면 어느 쪽이 무엇인지 아무도 모른다.
    await openStudio()
    await showResult()
    const strip = screen.getByRole('group', { name: '작업 목록' })
    expect(within(strip).queryByRole('button', { name: /전부 저장/ })).toBeNull()
  })

  it('이벤트 페이지에서 저장하면 배너가 딸려 나가지 않는다', async () => {
    await makeBanner()
    const strip = await screen.findByRole('group', { name: '작업 목록' }, { timeout: 9000 })
    const job = (await loadStudioJob(STUDIO_JOB_ID))!
    const source = job.doc.pages.find((p) => !p.id.startsWith('banner_'))!
    fireEvent.click(within(strip).getByRole('button', { name: source.title }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이 이미지 저장' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 3500 })
    expect(downloaded[0]).toContain('page-01')
  }, 20_000)

  it('형제 크기를 뽑으면 앞선 배너의 조각이 옮겨 온다', async () => {
    // 손검수: "유사 사이즈 배너 하나를 작업했다면 다른 사이즈 배너 작업창을
    // 불러왔을 때 그 내용이 남아 있으면 좋겠다."
    await makeBanner()
    fireEvent.click(await screen.findByRole('button', { name: /조각 서랍/ }, { timeout: 3500 }))
    const drawer = screen.getByRole('region', { name: '조각 서랍' })
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      expect((job.textObjects?.[Object.keys(job.bannerPages ?? {})[0]!] ?? []).length).toBe(1)
    }, { timeout: 3500 })

    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '840×78 뽑기' }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const sibling = Object.keys(job.bannerPages ?? {}).find((id) => id.includes('840x78'))
      expect(sibling).toBeDefined()
      const carried = job.textObjects?.[sibling!] ?? []
      expect(carried).toHaveLength(1)
      // 번호는 새 배너의 것으로 갈아입고, 그림은 그대로 쓴다.
      expect(carried[0]!.blockId.startsWith(sibling!)).toBe(true)
      expect(carried[0]!.assetId).toBe('asset_title')
    }, { timeout: 9000 })
  }, 25_000)

  it('다시 뽑아도 놓아 둔 조각이 살아 있다', async () => {
    // `다시 뽑기`는 배경을 다시 굽는 일이지 작업을 버리는 일이 아니다.
    await makeBanner()
    fireEvent.click(await screen.findByRole('button', { name: /조각 서랍/ }, { timeout: 3500 }))
    const drawer = screen.getByRole('region', { name: '조각 서랍' })
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      expect((job.textObjects?.[Object.keys(job.bannerPages ?? {})[0]!] ?? []).length).toBe(1)
    }, { timeout: 3500 })
    const before = rendered.length
    fireEvent.click(within(bannerPanel()).getByRole('button', { name: '1020×70 다시 뽑기' }))
    // **다시 뽑기가 끝난 뒤에** 센다. 끝나기 전에 세면 지워지기 직전의 값을 보고
    // 통과해 버려, 지우는 결함을 잡지 못한다.
    await waitFor(() => expect(rendered.length).toBeGreaterThan(before), { timeout: 9000 })
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      expect((job.textObjects?.[Object.keys(job.bannerPages ?? {})[0]!] ?? []).length).toBe(1)
    }, { timeout: 9000 })
  }, 25_000)
})

/**
 * 깜빡이는 버튼은 **만들기만** 한다 (깜빡이는 버튼 Patch, 손검수 2차).
 *
 * 앞선 판은 버튼 하나가 만들고 곧장 내려받기까지 했다. 작업자의 말이 정확했다 —
 * "버튼만 만들어야지, 저장은 기존 전부 저장·이 이미지 저장으로만 처리해야지."
 * 그러면 낱장을 저마다 따로 받게 되고 묶어 저장하는 길과 어긋난다.
 */
describe('§35-8 깜빡이는 버튼', () => {
  const blinkButton = () => within(screen.getByRole('group', { name: '작업 목록' })).getByRole('button', { name: /깜빡이는 버튼/ })

  it('버튼 조각이 있는 페이지에만 나온다', async () => {
    // 깜빡일 것이 없는데 GIF로 만들면 화질만 잃는다.
    await openStudio()
    await showResult()
    expect(blinkButton()).toBeTruthy()
  })

  it('눌러도 저장하지 않는다 — 켜기만 한다', async () => {
    await openStudio()
    await showResult()
    fireEvent.click(blinkButton())
    await waitFor(() => expect(blinkButton().getAttribute('aria-pressed')).toBe('true'), { timeout: 8000 })
    expect(downloaded).toEqual([])
  }, 20_000)

  it('켜면 저장이 GIF로 나간다 — 버튼은 그대로 둘뿐', async () => {
    // 저장하는 길은 하나여야 한다. 만드는 일과 저장하는 일은 다른 일이다.
    await openStudio()
    await showResult()
    fireEvent.click(blinkButton())
    await waitFor(() => expect(blinkButton().getAttribute('aria-pressed')).toBe('true'), { timeout: 8000 })
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 8000 })
    expect(downloaded[0]!.endsWith('.gif')).toBe(true)
  }, 25_000)

  it('끄면 다시 PNG로 나간다', async () => {
    await openStudio()
    await showResult()
    fireEvent.click(blinkButton())
    await waitFor(() => expect(blinkButton().getAttribute('aria-pressed')).toBe('true'), { timeout: 8000 })
    fireEvent.click(blinkButton())
    await waitFor(() => expect(blinkButton().getAttribute('aria-pressed')).toBe('false'), { timeout: 8000 })
    fireEvent.click(screen.getByRole('button', { name: '이 이미지 저장' }))
    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 8000 })
    expect(downloaded[0]!.endsWith('.png')).toBe(true)
  }, 25_000)
})

describe('§35-6 조각 서랍', () => {
  it('이벤트 페이지의 조각이 전부 들어 있다', async () => {
    // 손검수: "작업창에 조각은 더 있는데 서랍에는 문구 2개와 똑같은 컷오프 큰 거
    // 2개뿐이야. 작업창에는 이벤트 페이지에 있는 모든 오브젝트들이 다 있어야지."
    // 앞선 판은 **자동이 뺀 것만** 서랍에 넣었다.
    const drawer = await openDrawer()
    // 문구 조각 다섯(제목·CTA·사은품 셋)과 그림 둘(제품 그룹·로고).
    expect(within(drawer).getAllByRole('button')).toHaveLength(7)
  }, 15_000)

  it('부분수정과 같은 이름으로 부른다', async () => {
    // 앞선 판은 기획서 블록의 이름표를 썼다 — 이미지가 넷이면 넷 다 `이미지`라
    // 무엇을 꺼내는지 알 수 없었다. 두 화면이 같은 것을 같은 이름으로 부른다.
    const drawer = await openDrawer()
    expect(within(drawer).getByRole('button', { name: /문구 1/ })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: /이미지 1/ })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: /텐가 사고, 선물 받자/ })).toBeTruthy()
  }, 15_000)

  it('꺼내면 배너에 놓인다', async () => {
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      expect((job.textObjects?.[bannerId] ?? []).length).toBe(1)
    }, { timeout: 3500 })
  }, 15_000)

  it('올라온 뒤에도 서랍에 남고, 다시 누르면 한 벌 더 놓인다', async () => {
    // 지운 것을 되살릴 길이 없으면 안 된다. 그리고 같은 조각을 두 벌 쓰는 배너가
    // 실제로 있다.
    const drawer = await openDrawer()
    const pick = () => within(drawer).getByRole('button', { name: /문구 1/ })
    fireEvent.click(pick())
    await waitFor(() => expect(within(drawer).getByText('올림 1')).toBeTruthy(), { timeout: 3500 })
    fireEvent.click(pick())
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      const objects = job.textObjects?.[bannerId] ?? []
      expect(objects).toHaveLength(2)
      // 번호가 같으면 하나가 다른 하나를 덮어써, 누른 만큼 늘지 않는다.
      expect(new Set(objects.map((o) => o.blockId)).size).toBe(2)
    }, { timeout: 3500 })
  }, 20_000)

  it('컷아웃의 두께 설정이 조각을 따라온다', async () => {
    // 손검수: "배너에서는 컷오프의 두께 조절하는 부분이 없는데?" 앞선 판은 조각만
    // 올렸고, 배너 블록은 새 번호라 컷아웃이 켜진 것이 하나도 없어 `종이 테두리
    // 다듬기` 칸이 아예 나오지 않았다.
    const drawer = await openDrawer()
    // `이미지 2`가 제품 뭉치다 — 목록은 위에서 아래로 세므로 로고가 먼저다.
    fireEvent.click(within(drawer).getByRole('button', { name: /이미지 2/ }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      const placed = (job.imageObjects?.[bannerId] ?? [])[0]!
      // 새 번호로 복사된다 — 배너에서 두께를 고쳐도 원본은 그대로여야 한다.
      expect(job.effects?.[placed.blockId]?.paperCutout).toBe(true)
      expect(placed.blockId).not.toBe('blk_prod')
      expect(job.effects?.blk_prod?.paperWeight).toBe(0.35)
    }, { timeout: 3500 })
  }, 15_000)

  it('컷아웃을 올리면 종이 테두리 다듬기가 나온다', async () => {
    // 손검수가 없다고 한 그 칸이다. 설정이 안 따라오면 이 칸은 영영 안 나온다.
    const drawer = await openDrawer()
    expect(screen.queryByRole('region', { name: '완성본 종이 테두리' })).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: /이미지 2/ }))
    const open = await screen.findByRole('button', { name: /종이 테두리 다듬기/ }, { timeout: 3500 })
    fireEvent.click(open)
    expect(screen.getByRole('region', { name: '완성본 종이 테두리' })).toBeTruthy()
  }, 15_000)

  it('꺼낸 조각의 번호가 원본과 다르다', async () => {
    // 같은 번호를 쓰면 배너 조각에 건 톤이 메인 이벤트 페이지까지 바꾼다.
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    await waitFor(async () => {
      const job = (await loadStudioJob(STUDIO_JOB_ID))!
      const bannerId = Object.keys(job.bannerPages ?? {})[0]!
      const objects = job.textObjects?.[bannerId] ?? []
      expect(objects[0]!.blockId.startsWith(bannerId)).toBe(true)
    }, { timeout: 3500 })
  }, 15_000)

  it('올린 조각이 부분수정 목록에 선다', async () => {
    // 손검수: "여기 배너에서도 이벤트 이미지 부분처럼 부분 수정이 되어야 해...
    // 이벤트 이미지에서는 3줄이었던 문구가 2줄, 1줄이 될 수도 있는데."
    const drawer = await openDrawer()
    // 아직 올린 것이 없으면 고칠 것도 없다.
    expect(screen.queryByRole('region', { name: 'AI 부분수정' })).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    const panel = await screen.findByRole('region', { name: 'AI 부분수정' }, { timeout: 3500 })
    expect(within(panel).getByText(/문구 조각/)).toBeTruthy()
    expect(within(panel).getByText(/원본 이벤트 페이지에도 옆 조각에도 영향이 없습니다/)).toBeTruthy()
  }, 15_000)

  it('값을 치른 결과가 하나뿐이면 결과 줄이 없다', async () => {
    // 손검수: "결과 1/1 이전결과 다음결과 최초 생성본으로 복원, 이게 뭐였지?
    // 어떤 버튼도 활성화 되지 않는데." 배너는 AI 없이 만드니 늘 한 칸이고, 그때
    // 꺼진 버튼 넷은 소음이다.
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    const panel = await screen.findByRole('region', { name: 'AI 부분수정' }, { timeout: 3500 })
    expect(within(panel).queryByRole('button', { name: '최초 생성본으로 복원' })).toBeNull()
    expect(within(panel).queryByText(/결과 1 \/ 1/)).toBeNull()
  }, 15_000)

  it('부분수정 목록에 이미지 조각과 전체 배경은 없다', async () => {
    // 그 둘을 고치는 길은 한 장을 통째로 다시 그리는 것이고, 배너에서 그것을 하면
    // 애써 놓은 조각이 전부 사라진다.
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: /문구 1/ }))
    fireEvent.click(within(drawer).getByRole('button', { name: /이미지 2/ }))
    const panel = await screen.findByRole('region', { name: 'AI 부분수정' }, { timeout: 3500 })
    await waitFor(() => {
      expect(within(panel).queryByText('전체 배경')).toBeNull()
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(1)
    }, { timeout: 3500 })
  }, 15_000)

  it('이벤트 페이지에는 서랍이 없다', async () => {
    // 이벤트 페이지에는 조각이 이미 다 놓여 있다.
    await openStudio()
    await showResult()
    expect(screen.queryByRole('region', { name: '조각 서랍' })).toBeNull()
  })
})
