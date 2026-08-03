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
  clearAllDocuments,
  createDocument,
  listDocuments,
  loadDocumentById,
  resetDocumentStoreForTests,
} from '../services/documentStore'
import { clearAllRequests, resetRequestStoreForTests } from '../services/requestStore'
import { clearAllStudioJobs, resetStudioStoreForTests, saveStudioJob, STUDIO_JOB_ID } from '../services/studioStore'
import { clearSelectedTeam, selectedTeam, selectTeam } from '../features/team/teamSession'
import { createStudioJob, linkProductImage } from '../domain/studioJob'
import { createEmptyDocument } from '../domain/pageSchema'
import { createBlock, createEmptyProject } from '../domain/factory'
import { countWriterStorage, resetWriterStorage } from '../services/storageReset'
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
  resetStudioStoreForTests()
  await clearAll()
  await clearAllDocuments()
  await clearAllRequests()
  await clearAllStudioJobs()
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

  it("shows only the chosen team's briefs, plus untitled-team material from before", async () => {
    await createDocument(teamDoc('마케팅 기획서', 'marketing'), 3)
    await createDocument(teamDoc('상품 기획서', 'product'), 2)
    await createDocument(teamDoc('팀 없는 옛 기획서', undefined), 1)

    selectTeam('marketing')
    const id = await createDocument(teamDoc('지금 쓰는 것', 'marketing'), 4)
    renderWriter(`/briefs/${id}`)

    await waitFor(() => expect(within(library()).getByText('마케팅 기획서')).toBeTruthy(), { timeout: 5000 })
    expect(within(library()).queryByText('상품 기획서')).toBeNull()
    // 구자료는 지우지 않았고, 어느 팀 것도 아니므로 계속 열 수 있다.
    expect(within(library()).getByText('팀 없는 옛 기획서')).toBeTruthy()
  })

  it("refuses another team's brief typed straight into the address", async () => {
    const otherId = await createDocument(teamDoc('상품 기획서', 'product'), 1)
    selectTeam('marketing')
    renderWriter(`/briefs/${otherId}`)

    await waitFor(() => expect(screen.getByText('다른 팀의 기획서입니다')).toBeTruthy(), { timeout: 5000 })
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

  it("never takes the studio's product images with it", async () => {
    await createDocument(teamDoc('기획서', 'marketing', 'asset_brief'), 1)
    await putAsset(storedAsset('asset_brief'))
    await putAsset(storedAsset('asset_cutout'))
    await saveStudioJob(
      linkProductImage(createStudioJob(createEmptyDocument(createEmptyProject('작업')), 1, STUDIO_JOB_ID), 'blk_x', 'asset_cutout'),
    )

    expect(await countWriterStorage()).toEqual({ briefs: 1, images: 1 })
    await resetWriterStorage()

    expect(await listDocuments()).toHaveLength(0)
    expect((await getAllAssets()).map((a) => a.id)).toEqual(['asset_cutout'])
  })
})
