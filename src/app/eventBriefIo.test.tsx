import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { clearAll, getAllAssets, resetAssetStoreForTests } from '../services/assetStore'
import { packageEventBrief } from '../services/eventBriefExport'
import { readEventBrief, type ImportedBrief } from '../services/eventBriefImport'
import { createBlock, createEmptyBrief } from '../domain/factory'
import type { EventBrief } from '../domain/briefSchema'

// jsdom cannot render a canvas; stub preview + image decode.
vi.mock('../services/previewRenderer', () => ({
  renderPreviewPng: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
}))
vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 20, height: 20 }) }
})

/** Builds a valid .eventbrief File from a brief + one stored asset. */
async function makeArchiveFile(): Promise<File> {
  const headline = createBlock('main_headline', { id: 'blk_h', content: '여름 세일', required: true, position: { x: 40, y: 40, width: 300, height: 90 } })
  const image = createBlock('main_product_image', { id: 'blk_i', assetId: 'asset_x', position: { x: 40, y: 160, width: 300, height: 300 } })
  const brief: EventBrief = {
    ...createEmptyBrief('불러온 기획서'),
    blocks: [headline, image],
    assets: [{ id: 'asset_x', fileName: 'photo.png', mimeType: 'image/png', byteSize: 8 }],
  }
  const stored = [{ id: 'asset_x', blob: new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }), fileName: 'photo.png', mimeType: 'image/png' as const, byteSize: 4 }]
  const pkg = await packageEventBrief({ brief, assets: stored, preview: null, createdAt: 't' })
  return new File([pkg.blob], 'sample.eventbrief', { type: 'application/zip' })
}

/** The editor runs inside the router (mounted at /briefs/new · /briefs/:id). */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <AppShell />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
})

describe('export UI', () => {
  it('produces a downloadable, valid .eventbrief from the current brief', async () => {
    const user = userEvent.setup()
    const created: Blob[] = []
    const spy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource): string => {
      if (b instanceof Blob) created.push(b)
      return 'blob:mock'
    })

    renderShell()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))

    // Export now lives in the top bar's 보조 메뉴 (overflow).
    await user.click(screen.getByText('보조 메뉴'))
    await user.click(screen.getByRole('button', { name: '파일로 저장 (.eventbrief)' }))

    // A text-only brief triggers warnings (no required product) → confirm.
    const warn = await screen.findByRole('alertdialog', { name: '내보내기 경고' })
    await user.click(within(warn).getByRole('button', { name: '계속 진행' }))

    // One of the created object URLs is the exported archive; it must parse.
    let parsed: ImportedBrief | null = null
    await waitFor(async () => {
      for (const blob of created) {
        try {
          parsed = await readEventBrief(blob)
          break
        } catch {
          /* not the archive */
        }
      }
      expect(parsed).not.toBeNull()
    })
    expect(parsed!.brief.blocks.some((b) => b.type === 'main_headline')).toBe(true)
    spy.mockRestore()
  })
})

describe('import UI', () => {
  it('restores blocks and assets from a dropped-in archive (round-trip)', async () => {
    const file = await makeArchiveFile()
    renderShell()
    const canvas = screen.getByRole('region', { name: '기획 캔버스' })

    const importInput = document.querySelector('.toolbar__file-input') as HTMLInputElement
    fireEvent.change(importInput, { target: { files: [file] } })

    // Restored: headline + image cards on the canvas.
    await waitFor(() => {
      expect(within(canvas).getByRole('button', { name: /여름 세일/ })).toBeTruthy()
    })
    await waitFor(async () => {
      expect(await getAllAssets()).toHaveLength(1)
    })
    expect((await getAllAssets())[0]!.fileName).toBe('photo.png')
  })

  it('rejects a corrupt archive without changing the current work', async () => {
    const user = userEvent.setup()
    renderShell()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    const canvas = screen.getByRole('region', { name: '기획 캔버스' })

    // Existing work.
    await user.click(within(palette).getByRole('button', { name: '메인 문구' }))
    expect(within(canvas).getAllByRole('button', { name: /메인 문구/ })).toHaveLength(1)

    const bad = new File([new Uint8Array([1, 2, 3, 4])], 'broken.eventbrief', { type: 'application/zip' })
    const importInput = document.querySelector('.toolbar__file-input') as HTMLInputElement
    fireEvent.change(importInput, { target: { files: [bad] } })

    // Failure dialog appears; existing block untouched.
    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: '불러오기 실패' })).toBeTruthy()
    })
    expect(within(canvas).getAllByRole('button', { name: /메인 문구/ })).toHaveLength(1)
  })
})
