/**
 * 자유로운 기획서 저장 + 컨셉 입력창 — a brief is not a form to complete.
 *
 * Some briefs are only wording. Some are only a picture's place. Some are only
 * a sentence about how the whole thing should feel. Saving a file preserves
 * whatever is there; it is not a review, so no shape of brief is ever stopped
 * or questioned on the way to the file. The only failures worth reporting are
 * technical ones — packaging, reading an asset, downloading.
 *
 * The direction for the whole document (`project.concept`) keeps its existing
 * contract; it only moves to where a planner can see it while working.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { AppRoutes } from './AppRoutes'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, resetAssetStoreForTests } from '../services/assetStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import {
  clearAllDocuments,
  createDocument,
  listDocuments,
  loadDocumentById,
  resetDocumentStoreForTests,
  saveDocumentById,
} from '../services/documentStore'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { readEventDocument } from '../services/eventBriefImport'
import { validateDocumentForExport } from '../features/export/exportValidation'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function renderShell(binding?: { load: () => Promise<BriefDocument | null>; save: (d: BriefDocument) => Promise<void> }) {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
        <DocumentsProvider>
          {binding ? <AppShell binding={binding} /> : <AppShell />}
        </DocumentsProvider>
      </RequestsProvider>
    </MemoryRouter>,
  )
}

const palette = () => screen.getByRole('complementary', { name: '블록 팔레트' })
const canvas = () => screen.getByRole('region', { name: '기획 캔버스' })
const saveButton = () => screen.getByRole('button', { name: '파일로 저장' })

/** Collects every blob handed to `URL.createObjectURL`, i.e. every download. */
function watchDownloads(): { blobs: Blob[]; restore: () => void } {
  const blobs: Blob[] = []
  const spy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource): string => {
    if (b instanceof Blob) blobs.push(b)
    return 'blob:mock'
  })
  return { blobs, restore: () => spy.mockRestore() }
}

/** Saves the brief on screen and returns the archive that came out of it. */
async function saveToFile(user: ReturnType<typeof userEvent.setup>, name?: string) {
  const { blobs, restore } = watchDownloads()
  await user.click(saveButton())
  // The only thing between the click and the file is what to call it — never a
  // question about what the brief contains.
  expect(screen.queryByRole('alertdialog')).toBeNull()
  const dialog = screen.getByRole('dialog', { name: '기획서 파일로 저장' })
  if (name !== undefined) {
    await user.clear(within(dialog).getByLabelText('파일명'))
    await user.type(within(dialog).getByLabelText('파일명'), name)
  }
  await user.click(within(dialog).getByRole('button', { name: '저장' }))

  let parsed: { doc: BriefDocument } | null = null
  await waitFor(
    async () => {
      for (const blob of blobs) {
        try {
          parsed = await readEventDocument(blob)
          break
        } catch {
          /* previews and other blobs */
        }
      }
      expect(parsed).not.toBeNull()
    },
    { timeout: 8000 },
  )
  restore()
  return parsed!
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
  resetRequestStoreForTests()
  await clearAllRequests()
  resetDocumentStoreForTests()
  await clearAllDocuments()
})

describe('§2 어떤 형태의 기획서도 그대로 저장된다', () => {
  it('saves a completely empty brief with no questions asked', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))

    const { doc } = await saveToFile(user)
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0]!.blocks).toHaveLength(0)
  })

  it('saves a brief that is nothing but the direction for it', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.type(screen.getByLabelText('원하는 분위기·컨셉'), '밝고 경쾌한 여름 할인 분위기')

    const { doc } = await saveToFile(user)
    expect(doc.project.concept).toBe('밝고 경쾌한 여름 할인 분위기')
    expect(doc.pages[0]!.blocks).toHaveLength(0)
  })

  it('saves a wording-only brief', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(within(palette()).getByRole('button', { name: '글 넣기' }))
    await user.type(screen.getByLabelText('문구 내용'), '여름 세일')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const { doc } = await saveToFile(user)
    expect(doc.pages[0]!.blocks.some((b) => b.content === '여름 세일')).toBe(true)
  })

  it('saves a brief that only describes where a picture goes', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(within(palette()).getByRole('button', { name: '이미지' }))
    await user.type(screen.getByLabelText('이미지 내용'), '시원한 바다 사진 자리')
    await user.keyboard('{Control>}{Enter}{/Control}')

    const { doc } = await saveToFile(user)
    expect(doc.pages[0]!.blocks.some((b) => b.content === '시원한 바다 사진 자리')).toBe(true)
  })

  it('saves a button-only brief that has no link yet', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.click(within(palette()).getByRole('button', { name: '버튼·링크' }))
    await user.keyboard('{Escape}')

    const { doc } = await saveToFile(user)
    expect(doc.pages[0]!.blocks.some((b) => b.type === 'cta_button')).toBe(true)
  })

  it('keeps the validation engine, but no longer on the way to a file', async () => {
    // The rules still exist for a future AI-generation step to advise with…
    const doc = createEmptyDocument(createEmptyProject(''))
    const result = validateDocumentForExport(doc, new Set())
    expect(result.errors.some((e) => e.code === 'NO_DESIGN_BLOCK')).toBe(true)
    expect(result.warnings.some((w) => w.code === 'NO_REQUIRED_PRODUCT')).toBe(true)

    // …and saying the same thing on an empty brief no longer stops the file.
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await saveToFile(user)
    expect(screen.queryByText(/필수 제품이 하나도 없습니다/)).toBeNull()
    expect(screen.queryByText(/디자인 블록이 하나도 없습니다/)).toBeNull()
  })

  it('says so, briefly, once the file is written', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await saveToFile(user)
    await waitFor(() => expect(screen.getByText('기획서 파일을 저장했습니다')).toBeTruthy())
  })

  it('delivers a brief that holds no blocks', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.type(screen.getByLabelText('기획서 제목'), '컨셉만 있는 기획서')
    await user.type(screen.getByLabelText('원하는 분위기·컨셉'), '조용하고 단정하게')
    await user.click(screen.getByRole('button', { name: '전달하기' }))

    await waitFor(() => expect(screen.getByText(/전달되었습니다/)).toBeTruthy())
  })
})

describe('§3 파일 저장·불러오기는 화면에 그대로 보인다', () => {
  it('puts both actions in the top bar, not behind 보조 메뉴', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))

    const bar = screen.getByRole('navigation', { name: '주요 작업' })
    expect(within(bar).getByRole('button', { name: '파일로 저장' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: '파일 불러오기' })).toBeTruthy()

    // And there is no overflow menu left to duplicate them into (v1 마감 §5).
    expect(screen.queryByLabelText('파일 보조 메뉴')).toBeNull()
    expect(screen.queryByText('보조 메뉴')).toBeNull()
  })
})

describe('§4 원하는 분위기·컨셉', () => {
  it('is always visible in the left column, under the three tools', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))

    const left = document.querySelector('.side-left') as HTMLElement
    const field = left.querySelector('.concept') as HTMLElement
    const input = within(field).getByLabelText('원하는 분위기·컨셉')
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.getAttribute('placeholder')).toContain('예:')
    // The tools come first, the direction under them.
    expect(left.querySelector('.simple-tools')!.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()

    // The old center entry point is gone, so there is only one place to type it.
    expect(screen.queryByRole('button', { name: /전체 컨셉/ })).toBeNull()
    expect(document.querySelectorAll('.concept__input')).toHaveLength(1)
  })

  it('autosaves what is typed, and never becomes a block on the canvas', async () => {
    const id = await createDocument(createEmptyDocument(createEmptyProject('컨셉 문서')), 1)
    const binding = {
      load: () => loadDocumentById(id),
      save: (doc: BriefDocument) => saveDocumentById(id, doc, Date.now()),
    }
    const user = userEvent.setup()
    renderShell(binding)

    const input = await screen.findByLabelText('원하는 분위기·컨셉')
    await user.type(input, '민트와 흰색 중심')

    expect(canvas().querySelectorAll('.block-card')).toHaveLength(0)
    expect(canvas().textContent).not.toContain('민트와 흰색 중심')

    await waitFor(
      async () => expect((await loadDocumentById(id))!.project.concept).toBe('민트와 흰색 중심'),
      { timeout: 6000 },
    )
  })

  it('loads what an existing document already carries', async () => {
    const doc = createEmptyDocument(createEmptyProject('예전 문서'))
    doc.project.concept = '차분하고 고급스럽게'
    doc.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_old', content: '기존 문구' })]
    const id = await createDocument(doc, 1)
    renderShell({
      load: () => loadDocumentById(id),
      save: (d: BriefDocument) => saveDocumentById(id, d, Date.now()),
    })

    await waitFor(() =>
      expect((screen.getByLabelText('원하는 분위기·컨셉') as HTMLTextAreaElement).value).toBe('차분하고 고급스럽게'),
    )
    // The blocks that were already there are untouched.
    expect(screen.getByText('기존 문구')).toBeTruthy()
  })

  it('survives moving to another brief and back', async () => {
    const docA = createEmptyDocument(createEmptyProject('가 기획서'))
    docA.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_a', content: 'A 문구' })]
    const docB = createEmptyDocument(createEmptyProject('나 기획서'))
    docB.pages[0]!.blocks = [createBlock('free_text', { id: 'blk_b', content: 'B 문구' })]
    const a = await createDocument(docA, 2000)
    await createDocument(docB, 1000)

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/briefs/${a}`]}>
        <AppRoutes />
      </MemoryRouter>,
    )

    const input = await screen.findByLabelText('원하는 분위기·컨셉')
    await user.type(input, '여름 밤 느낌')
    await waitFor(async () => expect((await loadDocumentById(a))!.project.concept).toBe('여름 밤 느낌'), {
      timeout: 6000,
    })

    // The shell remounts on every brief switch, so the panel is looked up fresh.
    const library = () => screen.getByRole('complementary', { name: '내 기획서' })
    await user.click(await within(library()).findByRole('button', { name: /나 기획서/ }))
    await waitFor(() => expect(screen.getByText('B 문구')).toBeTruthy())
    expect((screen.getByLabelText('원하는 분위기·컨셉') as HTMLTextAreaElement).value).toBe('')

    await user.click(await within(library()).findByRole('button', { name: /가 기획서/ }))
    await waitFor(() => expect(screen.getByText('A 문구')).toBeTruthy())
    expect((screen.getByLabelText('원하는 분위기·컨셉') as HTMLTextAreaElement).value).toBe('여름 밤 느낌')
  })

  it('is carried into a copy of the brief', async () => {
    const doc = createEmptyDocument(createEmptyProject('원본 기획서'))
    doc.project.concept = '복제해도 남는 컨셉'
    const id = await createDocument(doc, 1000)

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/briefs/${id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    )
    const library = await screen.findByRole('complementary', { name: '내 기획서' })
    await waitFor(() => expect(within(library).getByLabelText('원본 기획서 메뉴')).toBeTruthy())
    await user.click(within(library).getByLabelText('원본 기획서 메뉴'))
    await user.click(within(library).getByRole('button', { name: '복사해서 새 기획서 만들기' }))

    await waitFor(async () => {
      const copies = (await listDocuments()).filter((d) => d.id !== id)
      expect(copies).toHaveLength(1)
      const copied = await loadDocumentById(copies[0]!.id)
      expect(copied!.project.concept).toBe('복제해도 남는 컨셉')
    }, { timeout: 6000 })
  })

  it('comes back from a file with its wording intact, still not printed', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.clear(screen.getByLabelText('기획서 제목'))
    await user.type(screen.getByLabelText('기획서 제목'), '컨셉 왕복')
    await user.type(screen.getByLabelText('원하는 분위기·컨셉'), '밝고 경쾌한 여름 할인 분위기, 민트와 흰색 중심')

    const { doc } = await saveToFile(user)
    expect(doc.project.title).toBe('컨셉 왕복')
    expect(doc.project.concept).toBe('밝고 경쾌한 여름 할인 분위기, 민트와 흰색 중심')
    expect(doc.pages[0]!.canvasHeight).toBe(1000)
    expect(doc.pages[0]!.blocks).toHaveLength(0)
  })

  it('reaches the AI 요약 as an instruction that is never printed', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: /빈 화면에서 시작/ }))
    await user.type(screen.getByLabelText('원하는 분위기·컨셉'), '민트와 흰색 중심')

    await user.click(screen.getByRole('button', { name: 'AI 요약' }))
    const dialog = screen.getByRole('dialog', { name: 'AI 요약 미리보기' })
    expect(within(dialog).getByLabelText('요청 메모').textContent).toContain('민트와 흰색 중심')
    expect(within(dialog).getByLabelText('그대로 넣을 문구').textContent).not.toContain('민트와 흰색 중심')
  })
})
