/**
 * v1 동결 전 저장 경계 — what must never be lost.
 *
 * The authoring features are done; these are the edges where data can quietly
 * disappear: opening a file must not take another brief's images with it, a
 * document's asset list must say what the document actually uses, an imported
 * file must land in the brief that is open, an overwrite must be asked about
 * whenever there is anything to lose, and 실행 취소 must undo the last thing
 * that happened rather than a page deletion from five edits ago.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { AppShell } from './AppShell'
import { AppSurfaceProvider } from './AppSurfaceContext'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import {
  clearAll,
  getAllAssets,
  putAsset,
  resetAssetStoreForTests,
  type StoredAsset,
} from '../services/assetStore'
import { clearAllRequests, putRequest, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllDocuments,
  createDocument,
  loadDocumentById,
  resetDocumentStoreForTests,
  saveDocumentById,
} from '../services/documentStore'
import { createEmptyDocument, createPage } from '../domain/pageSchema'
import { NEW_PAGE_HEIGHT } from '../domain/briefSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { deletePage, hasUserWork, referencedAssetIds, withReferencedAssets } from '../domain/pageOps'
import { requestAssetIds, createWorkRequest } from '../domain/workRequest'
import { packageEventDocument } from '../services/eventBriefExport'
import { readEventDocument } from '../services/eventBriefImport'
import { resolveAssetCollisions } from '../services/importAssets'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 800, height: 1200 }) }
})
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

/** A stored blob whose bytes are derived from `seed`, so two can differ. */
function asset(id: string, seed: number, fileName = `${id}.png`): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71, seed, seed, seed, seed])], { type: 'image/png' }),
    fileName,
    mimeType: 'image/png',
    byteSize: 8,
  }
}

/** A one-page document using `assetId` on a block. */
function docWithImage(title: string, assetId: string, fileName = `${assetId}.png`): BriefDocument {
  const doc = createEmptyDocument(createEmptyProject(title))
  doc.assets = [{ id: assetId, fileName, mimeType: 'image/png' }]
  doc.pages[0]!.blocks = [
    createBlock('main_product_image', { id: `blk_${assetId}`, label: '이미지', assetId }),
  ]
  return doc
}

/** Packages a document into a real archive file. */
async function fileOf(doc: BriefDocument, assets: StoredAsset[], name = 'in.eventbrief'): Promise<File> {
  const pkg = await packageEventDocument({
    doc,
    assets,
    previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    createdAt: new Date(0).toISOString(),
  })
  return new File([pkg.blob], name, { type: 'application/zip' })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {/* delivering is a studio feature (타 팀 배포 §5). */}
      <AppRoutes surface="studio" />
    </MemoryRouter>,
  )
}

function renderShell(binding: { load: () => Promise<BriefDocument | null>; save: (d: BriefDocument) => Promise<void> }) {
  return render(
    <MemoryRouter initialEntries={['/briefs/x']}>
      <AppSurfaceProvider surface="studio">
        <RequestsProvider>
          <DocumentsProvider>
            <AppShell binding={binding} />
          </DocumentsProvider>
        </RequestsProvider>
      </AppSurfaceProvider>
    </MemoryRouter>,
  )
}

const importFile = async (file: File) => {
  const input = document.querySelector('.toolbar__file-input') as HTMLInputElement
  const { fireEvent } = await import('@testing-library/react')
  fireEvent.change(input, { target: { files: [file] } })
}

/** Opens a file and answers the replace confirmation when there is work to lose. */
const importOver = async (file: File) => {
  const { fireEvent } = await import('@testing-library/react')
  await importFile(file)
  await waitFor(() => expect(screen.getByRole('alertdialog', { name: '현재 작업 교체 확인' })).toBeTruthy(), {
    timeout: 8000,
  })
  fireEvent.click(screen.getByRole('button', { name: '교체' }))
}

const storedIds = async () => (await getAllAssets()).map((a) => a.id).toSorted()

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§3 공용 자산 저장소 보호', () => {
  it('leaves every other brief and delivered snapshot untouched when a file is opened', async () => {
    const a = await createDocument(docWithImage('가 기획서', 'asset_a'), 1000)
    await createDocument(docWithImage('나 기획서', 'asset_b'), 2000)
    await putAsset(asset('asset_a', 1))
    await putAsset(asset('asset_b', 2))
    await putAsset(asset('asset_request', 3))
    const delivered = createWorkRequest('req_1', docWithImage('전달본', 'asset_request'), new Date(0).toISOString())
    await putRequest(delivered)

    const imported = docWithImage('불러온 기획서', 'asset_import')
    const file = await fileOf(imported, [asset('asset_import', 4)])

    renderAt(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy())
    await importOver(file)

    // Nothing that belongs to anyone else is taken away: 나 기획서's picture and
    // the delivered snapshot's stay, and the imported one arrives. 가 기획서's own
    // old picture goes, because 가 기획서 is exactly what was just replaced — no
    // brief and no delivered snapshot references it any more.
    await waitFor(async () => {
      expect(await storedIds()).toEqual(['asset_b', 'asset_import', 'asset_request'])
    }, { timeout: 8000 })
    expect((await loadDocumentById(a))!.pages[0]!.blocks[0]!.assetId).toBe('asset_import')
  })

  it('gives a colliding asset id a new one, and rewrites every reference to it', async () => {
    const a = await createDocument(docWithImage('가 기획서', 'asset_shared', 'mine.png'), 1000)
    // 나 기획서 uses the same id — it is the one that must not be disturbed.
    await createDocument(docWithImage('나 기획서', 'asset_shared', 'mine.png'), 2000)
    await putAsset(asset('asset_shared', 1, 'mine.png'))

    // Same id, different bytes: the file's image is not the stored one.
    const imported = docWithImage('불러온 기획서', 'asset_shared', 'theirs.png')
    imported.pages.push(
      createPage({
        title: '2페이지',
        reference: { assetId: 'asset_shared', viewMode: 'overlay', opacity: 0.4, fit: 'width', visible: true },
      }),
    )
    const file = await fileOf(imported, [asset('asset_shared', 9, 'theirs.png')])

    renderAt(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy())
    await importOver(file)

    // 불러오기는 화면을 바꾸기 전에 실패할 수 있는 일을 모두 끝낸다. 그래서 자산
    // 개수는 행이 쓰이기 전에 이미 2가 된다 — 기다릴 신호는 행 자체다.
    await waitFor(async () => {
      const row = await loadDocumentById(a)
      expect(row?.pages[0]?.blocks[0]?.assetId).not.toBe('asset_shared')
    }, { timeout: 8000 })
    expect((await getAllAssets()).length).toBe(2)
    const saved = (await loadDocumentById(a))!
    const newId = saved.pages[0]!.blocks[0]!.assetId!
    expect(newId).not.toBe('asset_shared')
    // Every reference moved together: metadata, block, and the page reference.
    expect(saved.assets.map((x) => x.id)).toContain(newId)
    expect(saved.pages[1]!.reference.assetId).toBe(newId)
    // 나 기획서's picture is the one it always had — not the file's.
    const stored = await getAllAssets()
    const original = stored.find((x) => x.id === 'asset_shared')!
    expect(original).toBeDefined()
    expect(original.fileName).toBe('mine.png')
    expect(stored.find((x) => x.id === newId)!.fileName).toBe('theirs.png')
  })

  it('reuses a stored picture that is byte-identical, and renames one that is not', async () => {
    const doc = docWithImage('불러온 기획서', 'asset_x')
    doc.pages.push(
      createPage({
        title: '2페이지',
        reference: { assetId: 'asset_x', viewMode: 'overlay', opacity: 0.4, fit: 'width', visible: true },
      }),
    )

    // The very same picture already in the pool: nothing to write, nothing renamed.
    const same = await resolveAssetCollisions(doc, [asset('asset_x', 5)], async () => asset('asset_x', 5))
    expect(same.assets).toEqual([])
    expect(same.renamed.size).toBe(0)
    expect(same.doc.pages[0]!.blocks[0]!.assetId).toBe('asset_x')

    // A different picture under the same id: renamed, with every reference moved.
    const clash = await resolveAssetCollisions(doc, [asset('asset_x', 9)], async () => asset('asset_x', 5))
    const newId = clash.renamed.get('asset_x')!
    expect(newId).toBeDefined()
    expect(clash.assets.map((a) => a.id)).toEqual([newId])
    expect(clash.doc.assets.map((a) => a.id)).toEqual([newId])
    expect(clash.doc.pages[0]!.blocks[0]!.assetId).toBe(newId)
    expect(clash.doc.pages[1]!.reference.assetId).toBe(newId)

    // An id nobody has stored is written as it is.
    const fresh = await resolveAssetCollisions(doc, [asset('asset_x', 5)], async () => undefined)
    expect(fresh.assets.map((a) => a.id)).toEqual(['asset_x'])
    expect(fresh.renamed.size).toBe(0)
  })

  it('changes nothing at all when the file cannot be read', async () => {
    const a = await createDocument(docWithImage('가 기획서', 'asset_a'), 1000)
    await putAsset(asset('asset_a', 1))
    const before = await storedIds()

    renderAt(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy())
    await importFile(new File([new Uint8Array([1, 2, 3])], 'broken.eventbrief', { type: 'application/zip' }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    expect(await storedIds()).toEqual(before)
    expect((await loadDocumentById(a))!.pages[0]!.blocks[0]!.assetId).toBe('asset_a')
  })
})

describe('§4 문서 자산 목록 = 실제 참조', () => {
  it('drops metadata for an image the document no longer uses, per removal path', async () => {
    // Block image removed.
    const removed = docWithImage('제거', 'asset_x')
    removed.pages[0]!.blocks = []
    expect(referencedAssetIds(removed)).toEqual([])

    // Page reference removed.
    const doc = createEmptyDocument(createEmptyProject('참고 제거'))
    doc.assets = [{ id: 'asset_ref', fileName: 'r.png', mimeType: 'image/png' }]
    doc.pages[0]!.reference = { viewMode: 'canvas', opacity: 0.5, fit: 'width', visible: false }
    expect(referencedAssetIds(doc)).toEqual([])

    // Shared across pages: kept while any page still uses it.
    const shared = docWithImage('공유', 'asset_s')
    shared.pages.push(createPage({ title: '2페이지', blocks: [createBlock('main_product_image', { id: 'b2', assetId: 'asset_s' })] }))
    shared.pages[0]!.blocks = []
    expect(referencedAssetIds(shared)).toEqual(['asset_s'])

    // Block image replaced: only the new one is in use.
    const replaced = docWithImage('교체', 'asset_old')
    replaced.assets.push({ id: 'asset_new', fileName: 'n.png', mimeType: 'image/png' })
    replaced.pages[0]!.blocks = [{ ...replaced.pages[0]!.blocks[0]!, assetId: 'asset_new' }]
    expect(referencedAssetIds(replaced)).toEqual(['asset_new'])
    expect(withReferencedAssets(replaced).assets.map((x) => x.id)).toEqual(['asset_new'])

    // Page reference replaced: likewise.
    const refSwapped = createEmptyDocument(createEmptyProject('참고 교체'))
    refSwapped.assets = [
      { id: 'asset_r1', fileName: 'r1.png', mimeType: 'image/png' },
      { id: 'asset_r2', fileName: 'r2.png', mimeType: 'image/png' },
    ]
    refSwapped.pages[0]!.reference = { assetId: 'asset_r2', viewMode: 'overlay', opacity: 0.4, fit: 'width', visible: true }
    expect(withReferencedAssets(refSwapped).assets.map((x) => x.id)).toEqual(['asset_r2'])

    // A whole page with an image deleted: its picture leaves the document with it.
    const twoPages = docWithImage('페이지 삭제', 'asset_p1')
    twoPages.assets.push({ id: 'asset_p2', fileName: 'p2.png', mimeType: 'image/png' })
    twoPages.pages.push(
      createPage({ title: '2페이지', blocks: [createBlock('main_product_image', { id: 'b2', assetId: 'asset_p2' })] }),
    )
    const afterDelete = withReferencedAssets(deletePage(twoPages, twoPages.pages[1]!.id))
    expect(afterDelete.assets.map((x) => x.id)).toEqual(['asset_p1'])
  })

  it('removes the image from the document and its file, while other briefs keep the binary', async () => {
    const a = await createDocument(docWithImage('가 기획서', 'asset_shared'), 1000)
    await createDocument(docWithImage('나 기획서', 'asset_shared'), 2000)
    await putAsset(asset('asset_shared', 1))

    const user = userEvent.setup()
    renderAt(`/briefs/${a}`)
    await waitFor(() => expect(document.querySelector('.block-card')).not.toBeNull(), { timeout: 8000 })

    // Remove the picture from the block through the real menu.
    const card = document.querySelector('.block-card') as HTMLElement
    await user.click(card)
    await user.click(within(card).getByLabelText('이미지 블록 메뉴'))
    await user.click(within(card).getByRole('button', { name: '참고 이미지 제거' }))

    await waitFor(async () => {
      const saved = (await loadDocumentById(a))!
      expect(saved.pages[0]!.blocks[0]!.assetId).toBeUndefined()
      expect(saved.assets.map((x) => x.id)).not.toContain('asset_shared')
    }, { timeout: 8000 })

    // …but the other brief still uses it, so the binary is still there.
    expect(await storedIds()).toContain('asset_shared')
  })

  it('leaves no trace of a removed image in the exported archive', async () => {
    const doc = docWithImage('제거 후 저장', 'asset_gone')
    doc.pages[0]!.blocks = [createBlock('main_product_image', { id: 'blk_1', label: '이미지' })]
    doc.assets = [] // the document no longer references it

    const pkg = await packageEventDocument({
      doc,
      assets: [asset('asset_gone', 1)],
      previews: [new Blob([new Uint8Array([1])], { type: 'image/png' })],
      createdAt: new Date(0).toISOString(),
    })
    const read = await readEventDocument(pkg.blob)
    expect(JSON.stringify(read.doc)).not.toContain('asset_gone')
    expect(read.manifest.assets.map((e) => e.assetId)).not.toContain('asset_gone')
  })

  it('keeps a delivered snapshot pinned to what it actually uses', () => {
    const doc = docWithImage('전달본', 'asset_used')
    // A stale metadata entry nobody references must not pin a binary forever.
    doc.assets.push({ id: 'asset_orphan', fileName: 'o.png', mimeType: 'image/png' })
    const request = createWorkRequest('req_1', doc, new Date(0).toISOString())
    expect(requestAssetIds(request)).toEqual(['asset_used'])
  })
})

describe('§5 가져오기는 현재 기획서에 저장한다', () => {
  it('saves into the open brief immediately, under its own id', async () => {
    const a = await createDocument(createEmptyDocument(createEmptyProject('현재 기획서')), 1000)
    const foreign = createEmptyDocument(createEmptyProject('파일 원본'))
    foreign.project.id = 'doc_from_another_machine'
    foreign.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_i', content: '불러온 문구' })]
    const file = await fileOf(foreign, [])

    renderAt(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy())
    await importOver(file)

    // No 3-second autosave wait: the row holds it as soon as the import lands.
    await waitFor(async () => {
      const saved = await loadDocumentById(a)
      expect(saved!.pages[0]!.blocks[0]!.content).toBe('불러온 문구')
      expect(saved!.project.id).toBe(a)
    }, { timeout: 2500 })
    expect(await loadDocumentById('doc_from_another_machine')).toBeNull()
  })

  it('delivers the imported brief under the open brief id', async () => {
    const a = await createDocument(createEmptyDocument(createEmptyProject('현재 기획서')), 1000)
    const foreign = createEmptyDocument(createEmptyProject('전달 대상'))
    foreign.project.id = 'doc_other'
    foreign.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_i', content: '전달할 문구' })]
    const file = await fileOf(foreign, [])

    const user = userEvent.setup()
    renderAt(`/briefs/${a}`)
    await waitFor(() => expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy())
    await importOver(file)
    await waitFor(() => expect(screen.getByText('전달할 문구')).toBeTruthy(), { timeout: 8000 })
    // The import is not over when the wording appears: assets are still being
    // re-read and swept up, and every action in the bar is disabled until it
    // is. Waiting for 전달하기 to come back is waiting for the import to end.
    await waitFor(
      () => expect((screen.getByRole('button', { name: '전달하기' }) as HTMLButtonElement).disabled).toBe(false),
      { timeout: 8000 },
    )

    await user.click(screen.getByRole('button', { name: '전달하기' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/전달되었습니다/), {
      timeout: 8000,
    })

    const { listRequests } = await import('../services/requestStore')
    const requests = await listRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.documentId).toBe(a)
    // Importing and then delivering is two stores plus a package: give it room.
  }, 15000)
})

describe('§6 덮어쓰기 확인은 문서 전체를 본다', () => {
  it('treats a brand-new brief as empty, and anything a planner did as work', () => {
    const fresh = createEmptyDocument(createEmptyProject('새 기획서'))
    fresh.project.id = 'doc_1'
    expect(hasUserWork(fresh)).toBe(false)

    const titled = createEmptyDocument(createEmptyProject('여름 기획전'))
    expect(hasUserWork(titled)).toBe(true)

    const withConcept = createEmptyDocument(createEmptyProject('새 기획서'))
    withConcept.project.concept = '시원하게'
    expect(hasUserWork(withConcept)).toBe(true)

    // 작성팀은 게이트가 새 기획서마다 붙여 주는 값이라 "쓴 것"이 아니다
    // (첫 사용 흐름 §4). 팀만 있는 빈 기획서는 여전히 갓 만든 기획서다.
    const withTeam = createEmptyDocument(createEmptyProject('새 기획서'))
    withTeam.project.requestTeam = 'marketing'
    expect(hasUserWork(withTeam)).toBe(false)

    const withBlock = createEmptyDocument(createEmptyProject('새 기획서'))
    withBlock.pages[0]!.blocks = [createBlock('free_text', { id: 'b', content: '문구' })]
    expect(hasUserWork(withBlock)).toBe(true)

    const withPage = createEmptyDocument(createEmptyProject('새 기획서'))
    withPage.pages.push(createPage({ title: '2페이지' }))
    expect(hasUserWork(withPage)).toBe(true)

    const taller = createEmptyDocument(createEmptyProject('새 기획서'))
    taller.pages[0]!.canvasHeight = NEW_PAGE_HEIGHT + 600
    expect(hasUserWork(taller)).toBe(true)

    const withReference = createEmptyDocument(createEmptyProject('새 기획서'))
    withReference.pages[0]!.reference = { assetId: 'asset_r', viewMode: 'overlay', opacity: 0.35, fit: 'width', visible: true }
    expect(hasUserWork(withReference)).toBe(true)

    const viewChanged = createEmptyDocument(createEmptyProject('새 기획서'))
    viewChanged.pages[0]!.reference = { ...viewChanged.pages[0]!.reference, opacity: 0.9 }
    expect(hasUserWork(viewChanged)).toBe(true)

    // Naming the one page is work: an import would take that name away.
    const renamed = createEmptyDocument(createEmptyProject('새 기획서'))
    renamed.pages[0]!.title = '메인 배너'
    expect(hasUserWork(renamed)).toBe(true)

    // Ids and creation times are not work: two untouched briefs both answer no.
    const other = createEmptyDocument(createEmptyProject('새 기획서'))
    other.project.id = 'doc_2'
    expect(hasUserWork(other)).toBe(false)
    expect(other.pages[0]!.id).not.toBe(fresh.pages[0]!.id)
  })

  it('asks before overwriting a brief whose only page was renamed', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('새 기획서')), 1000)
    const user = userEvent.setup()
    renderShell({
      load: () => loadDocumentById(id),
      save: (d: BriefDocument) => saveDocumentById(id, d, Date.now()),
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '1페이지 페이지 메뉴' })).toBeTruthy())
    // The first-start choice sits over the workspace until it is dismissed.
    const start = screen.queryByRole('button', { name: /빈 화면에서 시작/ })
    if (start) await user.click(start)

    await user.click(screen.getByRole('button', { name: '1페이지 페이지 메뉴' }))
    await user.click(await screen.findByRole('button', { name: '이름 변경' }))
    const field = await screen.findByRole('textbox', { name: '페이지 이름' })
    await user.clear(field)
    await user.type(field, '메인 배너{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: '메인 배너 페이지 메뉴' })).toBeTruthy())

    const incoming = createEmptyDocument(createEmptyProject('불러온 기획서'))
    incoming.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_i', content: '불러온 문구' })]
    await importFile(await fileOf(incoming, []))

    await waitFor(() => expect(screen.getByRole('alertdialog', { name: '현재 작업 교체 확인' })).toBeTruthy(), {
      timeout: 8000,
    })
    await user.click(screen.getByRole('button', { name: '취소' }))
    // Cancelling keeps the name that was given.
    expect(screen.getByRole('button', { name: '메인 배너 페이지 메뉴' })).toBeTruthy()
  })

  it('asks before overwriting a brief that holds only a concept', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('새 기획서')), 1000)
    const user = userEvent.setup()
    renderShell({
      load: () => loadDocumentById(id),
      save: (d: BriefDocument) => saveDocumentById(id, d, Date.now()),
    })
    await waitFor(() => expect(screen.getByLabelText('원하는 분위기·컨셉')).toBeTruthy())
    await user.type(screen.getByLabelText('원하는 분위기·컨셉'), '지우면 안 되는 컨셉')

    const incoming = createEmptyDocument(createEmptyProject('불러온 기획서'))
    incoming.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_i', content: '불러온 문구' })]
    await importFile(await fileOf(incoming, []))

    await waitFor(() => expect(screen.getByRole('alertdialog', { name: '현재 작업 교체 확인' })).toBeTruthy(), {
      timeout: 8000,
    })
    // Cancelling leaves the concept exactly where it was.
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect((screen.getByLabelText('원하는 분위기·컨셉') as HTMLTextAreaElement).value).toBe('지우면 안 되는 컨셉')
  })

  it('opens straight into a brief nobody has touched', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('새 기획서')), 1000)
    renderShell({
      load: () => loadDocumentById(id),
      save: (d: BriefDocument) => saveDocumentById(id, d, Date.now()),
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '파일 불러오기' })).toBeTruthy())

    const incoming = createEmptyDocument(createEmptyProject('불러온 기획서'))
    incoming.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_i', content: '불러온 문구' })]
    await importFile(await fileOf(incoming, []))

    await waitFor(() => expect(screen.getByText('불러온 문구')).toBeTruthy(), { timeout: 8000 })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('§7 실행 취소 순서', () => {
  it('undoes the page deletion when that is the last thing that happened', async () => {
    const user = userEvent.setup()
    renderShell({ load: async () => null, save: async () => {} })
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(screen.getByRole('button', { name: '+ 페이지 추가' }))
    await user.click(within(screen.getByRole('complementary', { name: '블록 팔레트' })).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '2페이지 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await user.click(screen.getByRole('button', { name: '2페이지 페이지 메뉴' }))
    await user.click(screen.getByRole('button', { name: '페이지 삭제' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '페이지 삭제' }))
    await waitFor(() => expect(screen.queryByText('2페이지 문구')).toBeNull())

    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect(screen.getByText('2페이지 문구')).toBeTruthy())
  })

  it('undoes the latest edit — not the page deletion — once anything else happens', async () => {
    const user = userEvent.setup()
    renderShell({ load: async () => null, save: async () => {} })
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(within(screen.getByRole('complementary', { name: '블록 팔레트' })).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '1페이지 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await user.click(screen.getByRole('button', { name: '+ 페이지 추가' }))

    await user.click(screen.getByRole('button', { name: '2페이지 페이지 메뉴' }))
    await user.click(screen.getByRole('button', { name: '페이지 삭제' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '2페이지' })).toBeNull())

    // Something else happens after the deletion…
    await user.dblClick(document.querySelector('.block-card') as HTMLElement)
    await user.clear(screen.getByLabelText('문구 내용'))
    await user.type(screen.getByLabelText('문구 내용'), '고친 문구')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(screen.getByText('고친 문구')).toBeTruthy())

    // …so 실행 취소 takes back that edit, and the page stays deleted.
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect(screen.getByText('1페이지 문구')).toBeTruthy())
    expect(screen.queryByRole('button', { name: '2페이지' })).toBeNull()
  })

  it('drops the page-delete snapshot when the title, concept or team changes', async () => {
    const user = userEvent.setup()
    renderShell({ load: async () => null, save: async () => {} })
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(screen.getByRole('button', { name: '+ 페이지 추가' }))
    await user.click(screen.getByRole('button', { name: '2페이지 페이지 메뉴' }))
    await user.click(screen.getByRole('button', { name: '페이지 삭제' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '2페이지' })).toBeNull())

    await user.type(screen.getByLabelText('원하는 분위기·컨셉'), '컨셉 한 줄')
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    // The page does not come back and take the concept with it.
    expect(screen.queryByRole('button', { name: '2페이지' })).toBeNull()
    expect((screen.getByLabelText('원하는 분위기·컨셉') as HTMLTextAreaElement).value).toBe('컨셉 한 줄')
  })
})
