/**
 * Studio 작업파일의 무손실 저장·복원 (Studio 파일 결함 마감 §1, §6).
 *
 * 디자인팀이 작업판에서 연결한 실제 제품 이미지는 기획서 문서 밖에 있다. 그것이
 * 원본을 지키는 올바른 경계이지만, 파일로 저장할 때 그 경계 바깥이 통째로
 * 빠지면 저장한 파일은 작업을 이어갈 수 없는 파일이 된다 — 실제로 사용자가 저장한
 * 파일에는 이미지 폴더도, 자산도, 블록 연결도 없었다.
 *
 * 그래서 파일은 세 가지를 함께 지녀야 한다: 기획서와 참고 이미지(지금까지처럼),
 * 실제 제품 이미지 **원본**, 그리고 어느 블록에 연결됐는지. 셋이 함께 돌아와야
 * 새 브라우저에서 저장 직전 상태로 작업을 이어갈 수 있다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import JSZip from 'jszip'
import { AppRoutes } from './AppRoutes'
import {
  clearAll,
  getAllAssets,
  putAsset,
  resetAssetStoreForTests,
  type StoredAsset,
} from '../services/assetStore'
import { clearAllDocuments, resetDocumentStoreForTests } from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearAllStudioJobs, loadStudioJob, resetStudioStoreForTests, STUDIO_JOB_ID } from '../services/studioStore'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { resolveAssetCollisions } from '../services/importAssets'
import { EventBriefError } from '../services/eventBriefArchive'
import {
  createStudioJob,
  linkProductImage,
  unlinkProductImage,
  withSource,
  type StudioJob,
} from '../domain/studioJob'
import {
  parseStudioFileState,
  remapStudioFileState,
  studioFileAssetIds,
  toStudioFileState,
  STUDIO_FILE_VERSION,
} from '../domain/studioFile'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { documentFingerprint } from '../domain/documentFingerprint'
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

function bytesOf(seed: number, size = 8): Uint8Array {
  return new Uint8Array(Array.from({ length: size }, (_, i) => (seed * 31 + i) % 251))
}

function storedAsset(id: string, seed: number): StoredAsset {
  return {
    id,
    blob: new Blob([bytesOf(seed)], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 8,
  }
}

/**
 * 기획서: 이미지 자리 둘(하나에는 작성자의 참고 캡처), 문구 하나, 페이지 전체
 * 참고 이미지, 컨셉과 두 메모.
 */
function sampleDoc(): BriefDocument {
  const project = createEmptyProject('작업 파일 시험')
  project.concept = '단정하고 신뢰감 있게'
  project.designerNote = '이 문구는 반드시 강조해 주세요.'
  const doc = createEmptyDocument(project)

  const text = createBlock('free_text', {
    id: 'blk_text',
    content: '가을 신상 예약판매',
    position: { x: 84, y: 100, width: 420, height: 120 },
    layoutHint: { emphasis: 'high', alignment: 'center' },
  })
  const slotA = createBlock('main_product_image', {
    id: 'blk_a',
    content: '니트 정면 컷',
    assetId: 'asset_ref',
    position: { x: 20, y: 300, width: 300, height: 200 },
  })
  slotA.image = { referenceOnly: true }
  const slotB = createBlock('main_product_image', {
    id: 'blk_b',
    content: '가방 측면 컷',
    position: { x: 400, y: 300, width: 300, height: 200 },
  })

  doc.pages[0]!.blocks = [text, slotA, slotB]
  doc.pages[0]!.canvasHeight = 1400
  doc.pages[0]!.reference = { ...doc.pages[0]!.reference, assetId: 'asset_page', viewMode: 'overlay', visible: true }
  doc.assets = [
    { id: 'asset_ref', fileName: 'asset_ref.png', mimeType: 'image/png' },
    { id: 'asset_page', fileName: 'asset_page.png', mimeType: 'image/png' },
  ]
  return doc
}

/** 저장 직전의 Studio 작업: 원본을 채택하고 제품 이미지 둘을 연결한 상태. */
function jobWithProducts(doc: BriefDocument = sampleDoc()): StudioJob {
  let job = withSource(createStudioJob(doc, 1, STUDIO_JOB_ID), doc, 1, '받은 기획서.eventbrief')
  job = linkProductImage(job, 'blk_a', 'asset_cut_a')
  job = linkProductImage(job, 'blk_b', 'asset_cut_b')
  return job
}

const BRIEF_ASSETS = () => [storedAsset('asset_ref', 3), storedAsset('asset_page', 4)]
const PRODUCT_ASSETS = () => [storedAsset('asset_cut_a', 9), storedAsset('asset_cut_b', 11)]

/** 지금 Studio가 저장하는 것과 같은 방식으로 파일을 만든다. */
async function saveStudioFile(job: StudioJob, extraAssets: StoredAsset[] = []) {
  return packageEventDocument({
    doc: job.doc,
    assets: [...BRIEF_ASSETS(), ...PRODUCT_ASSETS(), ...extraAssets],
    previews: job.doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    createdAt: new Date(0).toISOString(),
    studio: toStudioFileState(job),
  })
}

/**
 * Blob 의 바이트. jsdom·fake-indexeddb 를 오간 Blob 은 `arrayBuffer`가 없기도 하고
 * FileReader 가 거부하기도 해서, 되는 길을 차례로 쓴다.
 */
async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(blob)
  })
}

async function zipEntries(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(blob)
  return Object.keys(zip.files).filter((p) => !zip.files[p]!.dir).toSorted()
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

describe('§6-1·2·4·5 파일에 무엇이 들어가는가', () => {
  it('writes the product image originals, the reference images, and the links', async () => {
    const job = jobWithProducts()
    const pkg = await saveStudioFile(job)
    const entries = await zipEntries(pkg.blob)

    // 기획서·미리보기·Studio 상태 파일
    expect(entries).toContain('manifest.json')
    expect(entries).toContain('document.json')
    expect(entries).toContain('studio.json')
    // 작성자의 참고 이미지와 페이지 참고 이미지
    expect(entries.filter((p) => p.startsWith('references/'))).toHaveLength(2)
    // 디자인팀의 실제 제품 이미지 원본 2장
    const products = entries.filter((p) => p.startsWith('products/'))
    expect(products).toHaveLength(2)
    expect(products.some((p) => p.includes('asset_cut_a'))).toBe(true)
    expect(products.some((p) => p.includes('asset_cut_b'))).toBe(true)

    // manifest 는 자산 4건 전부를 가리킨다.
    expect(pkg.manifest.assets).toHaveLength(4)
    expect(pkg.manifest.assets.filter((a) => a.area === 'product')).toHaveLength(2)

    // studio.json 의 연결정보가 정확하다.
    const zip = await JSZip.loadAsync(pkg.blob)
    const state = parseStudioFileState(JSON.parse(await zip.file('studio.json')!.async('string')))!
    expect(state.version).toBe(STUDIO_FILE_VERSION)
    expect(state.productImages).toEqual({ blk_a: 'asset_cut_a', blk_b: 'asset_cut_b' })
    expect(state.source?.fingerprint).toBe(documentFingerprint(job.doc))
  })

  it('stores one binary when the same product image is on two blocks', async () => {
    let job = jobWithProducts()
    job = linkProductImage(job, 'blk_b', 'asset_cut_a')
    const pkg = await packageEventDocument({
      doc: job.doc,
      assets: [...BRIEF_ASSETS(), storedAsset('asset_cut_a', 9)],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
      studio: toStudioFileState(job),
    })
    const entries = await zipEntries(pkg.blob)
    expect(entries.filter((p) => p.startsWith('products/'))).toHaveLength(1)
    expect(pkg.manifest.assets.filter((a) => a.area === 'product')).toHaveLength(1)

    const zip = await JSZip.loadAsync(pkg.blob)
    const state = parseStudioFileState(JSON.parse(await zip.file('studio.json')!.async('string')))!
    expect(state.productImages).toEqual({ blk_a: 'asset_cut_a', blk_b: 'asset_cut_a' })
  })

  /**
   * 앞선 판은 여기서 저장을 **거부**했다. 손상된 파일을 만들지 않겠다는 뜻이었고
   * 그 판단 자체는 옳았지만, 대가가 너무 컸다 — 그림 하나 때문에 하루치 작업을
   * 저장할 방법이 아예 없어진다. 실제로 팀원 화면에서 그 자리에서 걸렸다
   * (저장 인질 Patch).
   *
   * 이제 **끊어진 연결만 빼고 저장한다.** 손상이 아니다: 그 블록에 그림이 없다는
   * 것은 지금 화면의 사실이고, 파일은 그 사실을 그대로 적을 뿐이다. 대신 무엇이
   * 빠졌는지 반드시 돌려준다 — 조용히 빼는 것이 진짜 손상이다.
   */
  it('원본을 잃은 연결은 빼고 저장하며, 무엇이 빠졌는지 말한다', async () => {
    const job = jobWithProducts()
    const pkg = await packageEventDocument({
      doc: job.doc,
      assets: BRIEF_ASSETS(), // 제품 이미지 원본이 없다
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
      studio: toStudioFileState(job),
    })
    // 파일은 나온다.
    expect(pkg.blob.size).toBeGreaterThan(0)
    // 무엇이 어디서 빠졌는지 이름으로 말한다.
    expect(pkg.dropped?.map((d) => d.kind)).toEqual(['productImage', 'productImage'])
    expect(pkg.dropped?.map((d) => d.at).toSorted()).toEqual(['blk_a', 'blk_b'])
    // 저장된 작업 상태에는 죽은 연결이 남지 않는다 — 남으면 다시 열 때 또 걸린다.
    const zip = await JSZip.loadAsync(pkg.blob)
    const state = parseStudioFileState(JSON.parse(await zip.file('studio.json')!.async('string')))!
    expect(state.productImages).toEqual({})
  })

  it('keeps a writer file exactly as it was — no studio.json, version 2.0.0', async () => {
    const doc = sampleDoc()
    const pkg = await packageEventDocument({
      doc,
      assets: BRIEF_ASSETS(),
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    expect(await zipEntries(pkg.blob)).not.toContain('studio.json')
    expect(pkg.manifest.version).toBe('2.0.0')
  })
})

describe('§6-6·7·8·9·10 저장된 상태가 지금 상태와 같다', () => {
  it('saves only the newest link after a replace, and drops a removed one', async () => {
    let job = jobWithProducts()
    job = linkProductImage(job, 'blk_a', 'asset_cut_b') // 교체
    job = unlinkProductImage(job, 'blk_b') // 제거
    const state = toStudioFileState(job)
    expect(state.productImages).toEqual({ blk_a: 'asset_cut_b' })
    expect(studioFileAssetIds(state)).toEqual(['asset_cut_b'])

    const pkg = await packageEventDocument({
      doc: job.doc,
      assets: [...BRIEF_ASSETS(), storedAsset('asset_cut_b', 11)],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
      studio: state,
    })
    // 더 이상 연결되지 않은 이미지의 바이너리는 파일에 들어가지 않는다.
    const entries = await zipEntries(pkg.blob)
    expect(entries.filter((p) => p.startsWith('products/'))).toHaveLength(1)
    expect(entries.some((p) => p.includes('asset_cut_a'))).toBe(false)
  })

  it('brings back the wording, coordinates, page length, concept and both notes', async () => {
    const doc = sampleDoc()
    doc.project.aiNote = '하단에는 그라데이션을 꼭 넣어 주세요.'
    const job = jobWithProducts(doc)
    const pkg = await saveStudioFile(job)

    const imported = await readEventDocument(pkg.blob)
    expect(imported.doc.project.concept).toBe('단정하고 신뢰감 있게')
    expect(imported.doc.project.designerNote).toBe('이 문구는 반드시 강조해 주세요.')
    expect(imported.doc.project.aiNote).toBe('하단에는 그라데이션을 꼭 넣어 주세요.')
    expect(imported.doc.pages[0]!.canvasHeight).toBe(1400)
    const text = imported.doc.pages[0]!.blocks.find((b) => b.id === 'blk_text')!
    expect(text.content).toBe('가을 신상 예약판매')
    expect(text.position).toEqual({ x: 84, y: 100, width: 420, height: 120 })
    expect(text.layoutHint.alignment).toBe('center')
    // 원본과 작업본을 견줄 상태도 함께 돌아온다.
    expect(imported.studio?.source?.fingerprint).toBe(documentFingerprint(job.doc))
    expect(imported.studio?.source?.fileName).toBe('받은 기획서.eventbrief')
  })
})

describe('§6-11·13·14 불러오기의 안전', () => {
  it('renumbers the brief references and the product links with one mapping', async () => {
    const job = jobWithProducts()
    const pkg = await saveStudioFile(job)

    // 같은 id에 다른 그림이 이미 저장돼 있는 브라우저.
    await putAsset(storedAsset('asset_ref', 77))
    await putAsset(storedAsset('asset_cut_a', 88))

    const imported = await readEventDocument(pkg.blob)
    const resolved = await resolveAssetCollisions(imported.doc, imported.assets)
    const state = remapStudioFileState(imported.studio!, resolved.renamed)

    const refBefore = 'asset_ref'
    const refAfter = resolved.doc.pages[0]!.blocks.find((b) => b.id === 'blk_a')!.assetId!
    expect(refAfter).not.toBe(refBefore)
    expect(resolved.renamed.get('asset_cut_a')).toBeDefined()
    // 제품 연결도 같은 매핑으로 함께 움직인다.
    expect(state.productImages['blk_a']).toBe(resolved.renamed.get('asset_cut_a'))
    // 충돌하지 않은 것은 그대로다.
    expect(state.productImages['blk_b']).toBe('asset_cut_b')
  })

  it('rejects a damaged studio.json instead of opening half a file', async () => {
    const pkg = await saveStudioFile(jobWithProducts())
    const zip = await JSZip.loadAsync(pkg.blob)
    zip.file('studio.json', '{ this is not json')
    const broken = await zip.generateAsync({ type: 'blob' })

    await expect(readEventDocument(broken)).rejects.toThrow(EventBriefError)
  })

  it('still opens an ordinary v2 file, with no product links', async () => {
    const doc = sampleDoc()
    const pkg = await packageEventDocument({
      doc,
      assets: BRIEF_ASSETS(),
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    const imported = await readEventDocument(pkg.blob)
    expect(imported.studio).toBeUndefined()
    expect(imported.doc.pages[0]!.blocks.find((b) => b.id === 'blk_a')?.assetId).toBe('asset_ref')
  })
})

describe('§1 새 브라우저에서 작업을 이어갈 수 있다', () => {
  it('restores the brief, the reference and both product images in a fresh store', async () => {
    // 저장 직전 상태를 만든다.
    const job = jobWithProducts()
    const pkg = await saveStudioFile(job)
    const file = new File([pkg.blob], '작업.eventbrief', { type: 'application/zip' })

    // 새 브라우저 저장소: 기획서도 이미지도 Studio 작업도 없다.
    expect(await getAllAssets()).toHaveLength(0)
    expect(await loadStudioJob(STUDIO_JOB_ID)).toBeNull()

    render(
      <MemoryRouter initialEntries={['/studio']}>
        <AppRoutes surface="studio" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })
    fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, { target: { files: [file] } })

    await waitFor(() => {
      expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('작업 파일 시험')
    }, { timeout: 8000 })

    // 제품 이미지 원본 2장과 참고 이미지 2장이 저장소에 들어왔다.
    await waitFor(async () => expect(await getAllAssets()).toHaveLength(4), { timeout: 8000 })

    // 각 블록에 같은 제품 이미지가 다시 연결됐다.
    const restored = (await loadStudioJob(STUDIO_JOB_ID))!
    expect(Object.keys(restored.productImages).toSorted()).toEqual(['blk_a', 'blk_b'])
    const idA = restored.productImages['blk_a']!
    const idB = restored.productImages['blk_b']!
    expect(idA).not.toBe(idB)

    const byId = new Map((await getAllAssets()).map((a) => [a.id, a]))
    expect(byId.get(idA)?.fileName).toBe('asset_cut_a.png')
    expect(byId.get(idB)?.fileName).toBe('asset_cut_b.png')
    expect(byId.get(idA)?.byteSize).toBe(8)

    // 파일이 실어 나른 원본 바이트가 그대로다 (저장소를 오간 Blob 은 이 환경에서
    // 읽을 수 없으므로, 파일에서 읽은 원본으로 확인한다).
    const fromFile = await readEventDocument(pkg.blob)
    const products = new Map(fromFile.assets.map((a) => [a.id, a]))
    expect(await readBytes(products.get('asset_cut_a')!.blob)).toEqual(bytesOf(9))
    expect(await readBytes(products.get('asset_cut_b')!.blob)).toEqual(bytesOf(11))

    // 참고 이미지는 계속 참고 이미지고, 제품 이미지가 그 자리를 덮지 않았다.
    const blockA = restored.doc.pages[0]!.blocks.find((b) => b.id === 'blk_a')!
    expect(blockA.image?.referenceOnly).toBe(true)
    expect(blockA.assetId).not.toBe(idA)
    expect(restored.doc.pages[0]!.reference.assetId).toBeDefined()

    // 화면에서도 실제 제품 이미지가 우선한다.
    await waitFor(() => {
      const card = [...document.querySelectorAll('.block-card')].find((c) =>
        (c.getAttribute('aria-label') ?? '').includes('니트 정면 컷'),
      )
      expect(card).toBeTruthy()
      expect(within(card as HTMLElement).getByAltText('실제 사용 제품 이미지')).toBeTruthy()
    }, { timeout: 8000 })

    expect(fetchSpy).not.toHaveBeenCalled()
  }, 30000)
})


describe('§교정1 2.1 파일의 Studio 상태는 있어야 하고, 버전이 맞아야 한다', () => {
  it('refuses a 2.1 file whose studio.json is gone', async () => {
    const pkg = await saveStudioFile(jobWithProducts())
    const zip = await JSZip.loadAsync(pkg.blob)
    zip.remove('studio.json')
    const stripped = await zip.generateAsync({ type: 'blob' })

    // 제품 이미지 연결을 잃은 채 조용히 열리면 안 된다.
    await expect(readEventDocument(stripped)).rejects.toThrow(EventBriefError)
  })

  it('refuses a studio.json written by a version it does not know', async () => {
    const pkg = await saveStudioFile(jobWithProducts())
    const zip = await JSZip.loadAsync(pkg.blob)
    const raw = JSON.parse(await zip.file('studio.json')!.async('string'))
    zip.file('studio.json', JSON.stringify({ ...raw, version: '999.0.0' }))
    const future = await zip.generateAsync({ type: 'blob' })

    await expect(readEventDocument(future)).rejects.toThrow(EventBriefError)
    // 순수 계층에서도 같은 판정이다.
    expect(parseStudioFileState({ ...raw, version: '999.0.0' })).toBeNull()
  })

  it('still opens v1 and v2 writer files, which carry no studio state at all', async () => {
    const doc = sampleDoc()
    const pkg = await packageEventDocument({
      doc,
      assets: BRIEF_ASSETS(),
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    const imported = await readEventDocument(pkg.blob)
    expect(imported.manifest.version).toBe('2.0.0')
    expect(imported.studio).toBeUndefined()
  })
})

describe('§교정3 전체 용량 한도는 제품 이미지까지 함께 센다', () => {
  it('counts brief assets and product images against one total', async () => {
    const pkg = await saveStudioFile(jobWithProducts())
    // 자산 4장 × 8바이트 = 32바이트. 장당 한도는 넉넉하고 합계만 넘긴다.
    await expect(readEventDocument(pkg.blob, { maxTotalBytes: 20 })).rejects.toThrow(EventBriefError)
    // 합계가 한도 안이면 그대로 열린다.
    const fine = await readEventDocument(pkg.blob, { maxTotalBytes: 64 })
    expect(fine.assets).toHaveLength(4)
  })
})
