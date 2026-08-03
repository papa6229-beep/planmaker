/**
 * Phase 7 Step 5 — reference image UI (WORK_PLAN §8). Covers the required
 * tests: 나란히 보기, overlay show/hide, overlay opacity, and output exclusion
 * (the reference is an auxiliary asset, never an output block).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { clearAll, getAllAssets, resetAssetStoreForTests } from '../services/assetStore'

// jsdom cannot decode images; make dimension reading resolve deterministically.
vi.mock('../features/assets/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('../features/assets/imageUtils')>('../features/assets/imageUtils')
  return { ...actual, readImageSize: async () => ({ width: 800, height: 1200 }) }
})

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/briefs/new']}>
      <RequestsProvider>
          <DocumentsProvider>
          <AppShell />
        </DocumentsProvider>
      </RequestsProvider>
    </MemoryRouter>,
  )
}

function pngFile(name = 'reference.png') {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
}

const refTools = () => screen.getByRole('region', { name: '참고 이미지 도구' })

/** Uploads a reference image and waits for it to be stored. */
async function addReference(container: HTMLElement) {
  const input = container.querySelector('.ref-tools__file-input') as HTMLInputElement
  const user = userEvent.setup()
  await user.upload(input, pngFile())
  await waitFor(() => expect(within(refTools()).getByAltText('현재 참고 이미지')).toBeTruthy())
}

beforeEach(async () => {
  resetAssetStoreForTests()
  await clearAll()
})

describe('reference image — tools', () => {
  it('adds a reference image without creating a canvas block (output exclusion)', async () => {
    const { container } = renderShell()
    // Actions start at "추가"; no reference yet.
    expect(within(refTools()).getByRole('button', { name: '참고 이미지 추가' })).toBeTruthy()

    await addReference(container)

    // The image is stored and shown as a thumbnail…
    expect((await getAllAssets())).toHaveLength(1)
    // …replace/remove actions replace "추가"…
    expect(within(refTools()).getByRole('button', { name: '참고 이미지 교체' })).toBeTruthy()
    expect(within(refTools()).getByRole('button', { name: '참고 이미지 제거' })).toBeTruthy()
    // …and it is NOT an output block: the canvas stays empty.
    expect(container.querySelector('.canvas__sheet .block-card')).toBeNull()
    expect(screen.getByText(/왼쪽 팔레트에서 블록을 클릭/)).toBeTruthy()
  })

  it('removes the reference image', async () => {
    const { container } = renderShell()
    await addReference(container)
    await userEvent.setup().click(within(refTools()).getByRole('button', { name: '참고 이미지 제거' }))
    expect(within(refTools()).getByRole('button', { name: '참고 이미지 추가' })).toBeTruthy()
    expect(within(refTools()).queryByAltText('현재 참고 이미지')).toBeNull()
  })
})

describe('reference image — 보기 방식', () => {
  /**
   * 나란히 보기는 없앴다 (1단계 §4). 그 자리를 중앙의 `AI 결과 비교`가 쓰고,
   * 참고 이미지를 겹쳐 보는 일은 오버레이가 그대로 한다.
   */
  it('offers only 캔버스만 and 오버레이', async () => {
    const { container } = renderShell()
    expect(screen.queryByRole('radio', { name: '나란히 보기' })).toBeNull()
    expect((screen.getByRole('radio', { name: '오버레이' }) as HTMLButtonElement).disabled).toBe(true)

    await addReference(container)
    expect((screen.getByRole('radio', { name: '오버레이' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('radio', { name: '캔버스만' })).toBeTruthy()
  })
})

describe('reference image — 오버레이', () => {
  it('shows and hides the overlay on the canvas', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    await addReference(container)
    await user.click(screen.getByRole('radio', { name: '오버레이' }))

    // Default reference layer is not visible → no overlay yet.
    expect(container.querySelector('.canvas__overlay')).toBeNull()

    // Toggle 표시 on → overlay image appears in the canvas sheet.
    await user.click(screen.getByRole('checkbox', { name: '표시' }))
    expect(container.querySelector('.canvas__sheet .canvas__overlay')).not.toBeNull()

    // Toggle off → overlay gone.
    await user.click(screen.getByRole('checkbox', { name: '표시' }))
    expect(container.querySelector('.canvas__overlay')).toBeNull()
  })

  it('applies the overlay opacity (default 35%, adjustable)', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    await addReference(container)
    await user.click(screen.getByRole('radio', { name: '오버레이' }))
    await user.click(screen.getByRole('checkbox', { name: '표시' }))

    const overlay = () => container.querySelector('.canvas__overlay') as HTMLImageElement
    // Default opacity 35%.
    expect(Number(overlay().style.opacity)).toBeCloseTo(0.35, 2)

    const slider = screen.getByRole('slider', { name: '오버레이 투명도' })
    fireEvent.change(slider, { target: { value: '70' } })
    expect(Number(overlay().style.opacity)).toBeCloseTo(0.7, 2)
  })
})
