import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { clearAll, getAllAssets, resetAssetStoreForTests } from '../services/assetStore'

/** The editor runs inside the router (mounted at /briefs/new · /briefs/:id). */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <AppShell />
    </MemoryRouter>,
  )
}

// jsdom cannot decode images; make dimension reading resolve deterministically.
vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>(
    '../features/assets/imageUtils',
  )
  return { ...actual, readImageSize: async () => ({ width: 20, height: 20 }) }
})

function pngFile(name = 'photo.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
})

describe('image assets — upload', () => {
  it('uploads an image into the selected image block and shows a thumbnail', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const palette = screen.getByRole('complementary', { name: '블록 팔레트' })
    const inspector = screen.getByRole('complementary', { name: '선택 블록 설정' })

    await user.click(within(palette).getByRole('button', { name: '메인 제품 이미지' }))

    // Use the inspector's image input specifically (the toolbar also has a
    // file input for .eventbrief import).
    const fileInput = container.querySelector('.image-field__input') as HTMLInputElement
    expect(fileInput).not.toBeNull()
    await user.upload(fileInput, pngFile())

    // A thumbnail image is rendered (inspector preview and/or canvas card).
    const imgs = await screen.findAllByRole('img')
    expect(imgs.length).toBeGreaterThan(0)
    expect(imgs.some((img) => (img as HTMLImageElement).src.startsWith('blob:'))).toBe(true)

    // The binary was persisted to IndexedDB.
    const stored = await getAllAssets()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.fileName).toBe('photo.png')

    // Inspector now offers replace + remove.
    expect(within(inspector).getByRole('button', { name: '이미지 교체' })).toBeTruthy()
    expect(within(inspector).getByRole('button', { name: '이미지 제거' })).toBeTruthy()
  })

  it('drops multiple images onto the canvas as new image blocks', async () => {
    renderShell()
    const canvas = screen.getByRole('region', { name: '기획 캔버스' })

    // Simulate a drop of two files onto the sheet.
    const sheet = canvas.querySelector('.canvas__sheet') as HTMLElement
    const dataTransfer = {
      files: [pngFile('a.png'), pngFile('b.png')],
      types: ['Files'],
    }
    const { fireEvent, waitFor } = await import('@testing-library/react')
    fireEvent.dragOver(sheet, { dataTransfer })
    fireEvent.drop(sheet, { dataTransfer })

    // Two image cards appear (uploads are async and sequential).
    await waitFor(() => {
      expect(within(canvas).getAllByRole('button')).toHaveLength(2)
    })
    await waitFor(async () => {
      expect(await getAllAssets()).toHaveLength(2)
    })
  })
})
