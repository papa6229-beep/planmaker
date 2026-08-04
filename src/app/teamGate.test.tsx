/**
 * 팀 선택 게이트와 전체 초기화 (첫 사용 흐름 §4, §5, §11 작성기).
 *
 * 공유용 주소는 여러 사람이 함께 쓴다. 그래서 들어오자마자 남이 쓰던 기획서가
 * 열리면 안 되고, 팀을 고른 사람에게는 그 팀의 자료만 보여야 한다. 인증이
 * 아니라 한 브라우저 안에서 작업을 섞지 않기 위한 구분이다.
 *
 * 초기화는 이 브라우저의 자료를 지우는 일이고 되돌릴 수 없으므로, 몇 건이
 * 지워지는지 먼저 보이고 취소가 아무것도 바꾸지 않아야 한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'
import { clearAll, getAllAssets, putAsset, resetAssetStoreForTests, type StoredAsset } from '../services/assetStore'
import {
  assignDocumentTeam,
  clearAllDocuments,
  createDocument,
  listDocuments,
  loadDocumentById,
  resetDocumentStoreForTests,
} from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearSelectedTeam, selectedTeam, selectTeam } from '../features/team/teamSession'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { packageEventDocument } from '../services/eventBriefExport'
import type { RequestTeam } from '../domain/requestTeam'
import type { BriefDocument } from '../domain/pageSchema'

vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))

function storedAsset(id: string): StoredAsset {
  return {
    id,
    blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 4,
  }
}

function teamDoc(title: string, team: RequestTeam | undefined, assetId?: string): BriefDocument {
  const project = createEmptyProject(title)
  if (team !== undefined) project.requestTeam = team
  const doc = createEmptyDocument(project)
  if (assetId !== undefined) {
    doc.assets = [{ id: assetId, fileName: `${assetId}.png`, mimeType: 'image/png' }]
    doc.pages[0]!.blocks = [createBlock('main_product_image', { id: `blk_${assetId}`, assetId })]
  }
  return doc
}

/** 대표 파일 하나를 실제 아카이브로 만든다. */
async function briefFileOf(doc: BriefDocument): Promise<File> {
  const pkg = await packageEventDocument({
    doc,
    assets: [],
    previews: doc.pages.map(() => new Blob([new Uint8Array([1])], { type: 'image/png' })),
    createdAt: new Date(0).toISOString(),
  })
  return new File([pkg.blob], 'gate.eventbrief', { type: 'application/zip' })
}

function renderWriter(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes surface="brief-writer" />
    </MemoryRouter>,
  )
}

const gateTitle = () => screen.queryByRole('heading', { name: '어느 팀으로 기획서를 쓰시나요?' })
const library = () => screen.getByRole('complementary', { name: '내 기획서' })

beforeEach(async () => {
  resetAssetStoreForTests()
  resetDocumentStoreForTests()
  resetRequestStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  clearSelectedTeam()
})

describe('§4 팀 선택 게이트', () => {
  it("asks which team is writing instead of opening somebody else's work", async () => {
    await createDocument(teamDoc('남의 기획서', 'marketing'), 1)
    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())
    expect(document.querySelector('.canvas__sheet')).toBeNull()
    expect(screen.getByRole('button', { name: '마케팅팀' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '상품팀' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CS팀' })).toBeTruthy()
  })

  it('starts exactly one empty brief for the team that was chosen', async () => {
    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())

    const button = screen.getByRole('button', { name: '마케팅팀' })
    fireEvent.click(button)
    fireEvent.click(button) // 두 번 눌러도 한 건이어야 한다

    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })
    const docs = await listDocuments()
    expect(docs).toHaveLength(1)
    expect(docs[0]!.requestTeam).toBe('marketing')
    expect(selectedTeam()).toBe('marketing')
  })

  it("shows only the chosen team's briefs — no other team, and no team-less material", async () => {
    await createDocument(teamDoc('마케팅 기획서', 'marketing'), 3)
    await createDocument(teamDoc('상품 기획서', 'product'), 2)
    await createDocument(teamDoc('팀 없는 옛 기획서', undefined), 1)

    selectTeam('marketing')
    const id = await createDocument(teamDoc('지금 쓰는 것', 'marketing'), 4)
    renderWriter(`/briefs/${id}`)

    await waitFor(() => expect(within(library()).getByText('마케팅 기획서')).toBeTruthy(), { timeout: 5000 })
    expect(within(library()).queryByText('상품 기획서')).toBeNull()
    // 팀 미지정 자료는 어느 팀의 목록에도 섞이지 않는다. 지우지도 않는다.
    expect(within(library()).queryByText('팀 없는 옛 기획서')).toBeNull()
    expect((await listDocuments()).some((d) => d.title === '팀 없는 옛 기획서')).toBe(true)
  })

  it("refuses another team's brief typed straight into the address", async () => {
    const otherId = await createDocument(teamDoc('상품 기획서', 'product'), 1)
    selectTeam('marketing')
    renderWriter(`/briefs/${otherId}`)

    await waitFor(() => expect(screen.getByText('다른 팀의 기획서입니다')).toBeTruthy(), { timeout: 5000 })
    expect(document.querySelector('.canvas__sheet')).toBeNull()
  })

  it('refuses a team-less brief typed straight into the address', async () => {
    const oldId = await createDocument(teamDoc('팀 없는 옛 기획서', undefined), 1)
    selectTeam('marketing')
    renderWriter(`/briefs/${oldId}`)

    await waitFor(() => expect(screen.getByText('팀이 지정되지 않은 이전 자료입니다')).toBeTruthy(), { timeout: 5000 })
    expect(document.querySelector('.canvas__sheet')).toBeNull()
  })

  it('saves the brief and returns to the gate on 팀 변경', async () => {
    selectTeam('marketing')
    const id = await createDocument(teamDoc('작성 중', 'marketing'), 1)
    renderWriter(`/briefs/${id}`)
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })

    const title = document.querySelector('.editor-topbar__title') as HTMLInputElement
    fireEvent.change(title, { target: { value: '팀 변경 직전 제목' } })

    fireEvent.click(screen.getByRole('button', { name: '팀 변경' }))
    await waitFor(() => expect(gateTitle()).toBeTruthy(), { timeout: 5000 })
    expect(selectedTeam()).toBeNull()
    await waitFor(async () => {
      expect((await loadDocumentById(id))?.project.title).toBe('팀 변경 직전 제목')
    }, { timeout: 5000 })
  })

  it('does not offer a way to hand the open brief to another team', async () => {
    selectTeam('cs')
    const id = await createDocument(teamDoc('CS 기획서', 'cs'), 1)
    renderWriter(`/briefs/${id}`)
    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })

    const topbar = document.querySelector('.editor-topbar') as HTMLElement
    // 저장된 기획서가 실제로 열린 뒤에 본다.
    await waitFor(() => expect(within(topbar).getByLabelText('작성팀').textContent).toBe('CS팀'), { timeout: 5000 })
    expect(topbar.querySelector('select')).toBeNull()
  })
})

describe('§5 이 브라우저의 모든 기획서 초기화', () => {
  it('says how much will go, and cancelling changes nothing', async () => {
    await createDocument(teamDoc('하나', 'marketing', 'asset_one'), 1)
    await putAsset(storedAsset('asset_one'))
    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())

    await waitFor(() => expect(screen.getByText(/기획서 1건, 이미지 1장/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '이 브라우저의 모든 기획서 초기화' }))

    const dialog = await screen.findByRole('alertdialog', { name: '기획서 전체 초기화 확인' })
    expect(dialog.textContent).toContain('기획서 1건')
    expect(dialog.textContent).toContain('되돌릴 수 없습니다')

    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(await listDocuments()).toHaveLength(1)
    expect(await getAllAssets()).toHaveLength(1)
  })

  it("empties the writer's briefs and their images when confirmed", async () => {
    await createDocument(teamDoc('하나', 'marketing', 'asset_one'), 1)
    await putAsset(storedAsset('asset_one'))
    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/기획서 1건/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '이 브라우저의 모든 기획서 초기화' }))
    const dialog = await screen.findByRole('alertdialog', { name: '기획서 전체 초기화 확인' })
    fireEvent.click(within(dialog).getByRole('button', { name: '모두 지우기' }))

    await waitFor(async () => {
      expect(await listDocuments()).toHaveLength(0)
      // 자산 정리는 문서를 비운 다음에 이어진다.
      expect(await getAllAssets()).toHaveLength(0)
    }, { timeout: 5000 })
    // 게이트의 빈 상태로 돌아온다.
    expect(gateTitle()).toBeTruthy()
  })

})


describe('§교정 이전 자료 정리', () => {
  it('shows the team-less briefs that exist, and changes nothing on cancel', async () => {
    const oldId = await createDocument(teamDoc('팀 없는 옛 기획서', undefined, 'asset_old'), 1)
    await createDocument(teamDoc('마케팅 기획서', 'marketing'), 2)
    await putAsset(storedAsset('asset_old'))
    const before = await loadDocumentById(oldId)

    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())
    fireEvent.click(await screen.findByRole('button', { name: /팀 미지정 이전 자료/ }))

    const panel = await screen.findByRole('dialog', { name: '팀 미지정 이전 자료 정리' })
    // 자료가 있다는 것을 여기서는 확인할 수 있다.
    expect(within(panel).getByText('팀 없는 옛 기획서')).toBeTruthy()
    // 팀이 있는 기획서는 정리 대상이 아니다.
    expect(within(panel).queryByText('마케팅 기획서')).toBeNull()

    fireEvent.click(within(panel).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '팀 미지정 이전 자료 정리' })).toBeNull())
    // 취소는 아무것도 바꾸지 않는다.
    expect(await loadDocumentById(oldId)).toEqual(before)
  })

  it('files an old brief under the team the user picks, losing nothing', async () => {
    const oldId = await createDocument(teamDoc('팀 없는 옛 기획서', undefined, 'asset_old'), 1)
    await putAsset(storedAsset('asset_old'))
    const before = (await loadDocumentById(oldId))!
    const rowBefore = (await listDocuments()).find((d) => d.id === oldId)!

    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())
    fireEvent.click(await screen.findByRole('button', { name: /팀 미지정 이전 자료/ }))
    const panel = await screen.findByRole('dialog', { name: '팀 미지정 이전 자료 정리' })

    // 대상 팀을 명시적으로 고른 뒤에만 옮겨진다.
    fireEvent.change(within(panel).getByLabelText('팀 없는 옛 기획서 소속 팀'), { target: { value: 'cs' } })
    fireEvent.click(within(panel).getByRole('button', { name: '이 팀 자료로 옮기기' }))

    await waitFor(async () => {
      expect((await loadDocumentById(oldId))?.project.requestTeam).toBe('cs')
    }, { timeout: 5000 })

    // 문서·이미지·작성일·수정일·페이지·블록은 그대로다.
    const after = (await loadDocumentById(oldId))!
    const rowAfter = (await listDocuments()).find((d) => d.id === oldId)!
    expect(after.pages).toEqual(before.pages)
    expect(after.assets).toEqual(before.assets)
    expect(after.project.title).toBe(before.project.title)
    expect(rowAfter.createdAt).toBe(rowBefore.createdAt)
    expect(rowAfter.updatedAt).toBe(rowBefore.updatedAt)
    expect(await getAllAssets()).toHaveLength(1)
  })

  it('makes the filed brief appear in that team and nowhere else', async () => {
    const oldId = await createDocument(teamDoc('팀 없는 옛 기획서', undefined), 1)
    await assignDocumentTeam(oldId, 'cs')

    selectTeam('cs')
    const csId = await createDocument(teamDoc('CS 지금', 'cs'), 2)
    const { unmount } = renderWriter(`/briefs/${csId}`)
    await waitFor(() => expect(within(library()).getByText('팀 없는 옛 기획서')).toBeTruthy(), { timeout: 5000 })
    unmount()

    selectTeam('marketing')
    const mktId = await createDocument(teamDoc('마케팅 지금', 'marketing'), 3)
    renderWriter(`/briefs/${mktId}`)
    await waitFor(() => expect(within(library()).getByText('마케팅 지금')).toBeTruthy(), { timeout: 5000 })
    expect(within(library()).queryByText('팀 없는 옛 기획서')).toBeNull()
  })
})


describe('§교정2 팀을 고르기 전에는 아무 기획서도 열리지 않는다', () => {
  it('sends a team-owned brief address back to the gate, showing nothing of it', async () => {
    const id = await createDocument(teamDoc('마케팅 기획서', 'marketing'), 1)
    // 팀 선택 없음
    renderWriter(`/briefs/${id}`)

    await waitFor(() => expect(gateTitle()).toBeTruthy(), { timeout: 5000 })
    expect(document.querySelector('.canvas__sheet')).toBeNull()
    expect(document.body.textContent).not.toContain('마케팅 기획서')
  })

  it('sends a team-less brief address back to the gate too', async () => {
    const id = await createDocument(teamDoc('팀 없는 옛 기획서', undefined), 1)
    renderWriter(`/briefs/${id}`)

    await waitFor(() => expect(gateTitle()).toBeTruthy(), { timeout: 5000 })
    expect(document.querySelector('.canvas__sheet')).toBeNull()
    expect(document.body.textContent).not.toContain('팀 없는 옛 기획서')
  })

  it('does not mint a brief from /briefs/new without a team', async () => {
    renderWriter('/briefs/new')

    await waitFor(() => expect(gateTitle()).toBeTruthy(), { timeout: 5000 })
    expect(document.querySelector('.canvas__sheet')).toBeNull()
    expect(await listDocuments()).toHaveLength(0)
  })

  it("still opens the chosen team's own brief", async () => {
    selectTeam('marketing')
    const id = await createDocument(teamDoc('마케팅 기획서', 'marketing'), 1)
    renderWriter(`/briefs/${id}`)

    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 5000 })
    await waitFor(() => {
      expect((document.querySelector('.editor-topbar__title') as HTMLInputElement).value).toBe('마케팅 기획서')
    }, { timeout: 5000 })
  })
})

describe('§교정2 팀 미지정 파일과 저장소 경계', () => {
  it('keeps a team-less file out of the editor and puts it in the tidy-up list', async () => {
    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())

    const file = await briefFileOf(teamDoc('팀 없는 파일', undefined))
    fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, { target: { files: [file] } })

    // 저장은 되지만 편집기로 들어가지 않는다.
    await waitFor(async () => expect(await listDocuments()).toHaveLength(1), { timeout: 6000 })
    expect(gateTitle()).toBeTruthy()
    expect(document.querySelector('.canvas__sheet')).toBeNull()
    expect(selectedTeam()).toBeNull()

    // 정리 목록에서 찾을 수 있다.
    fireEvent.click(await screen.findByRole('button', { name: /팀 미지정 이전 자료/ }))
    const panel = await screen.findByRole('dialog', { name: '팀 미지정 이전 자료 정리' })
    await waitFor(() => expect(within(panel).getByText('팀 없는 파일')).toBeTruthy())
  }, 20000)

  it('opens a file that already names a valid team', async () => {
    renderWriter('/')
    await waitFor(() => expect(gateTitle()).toBeTruthy())

    const file = await briefFileOf(teamDoc('상품팀 파일', 'product'))
    fireEvent.change(document.querySelector('.toolbar__file-input') as HTMLInputElement, { target: { files: [file] } })

    await waitFor(() => expect(document.querySelector('.canvas__sheet')).not.toBeNull(), { timeout: 6000 })
    expect(selectedTeam()).toBe('product')
  }, 20000)

  it('never moves a brief that already belongs to a team', async () => {
    const id = await createDocument(teamDoc('마케팅 기획서', 'marketing'), 1)
    await assignDocumentTeam(id, 'cs')
    expect((await loadDocumentById(id))?.project.requestTeam).toBe('marketing')
  })
})
