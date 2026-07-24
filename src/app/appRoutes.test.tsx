import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './AppRoutes'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('AppRoutes shell (Phase 7 Step 1)', () => {
  it('renders the gate skeleton with both entry links at /', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Event Brief Builder' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '기획서 생성' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '이미지 생성' })).toBeTruthy()
  })

  it('renders the briefs list skeleton at /briefs', () => {
    renderAt('/briefs')
    expect(screen.getByRole('heading', { name: '기획서 목록' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '새 기획서 만들기' })).toBeTruthy()
  })

  it('mounts the editor at /briefs/new', () => {
    renderAt('/briefs/new')
    expect(screen.getByRole('complementary', { name: '블록 팔레트' })).toBeTruthy()
  })

  it('renders the image-requests skeleton and does not fake generation', () => {
    renderAt('/image-requests')
    expect(screen.getByRole('heading', { name: '이미지 생성 요청' })).toBeTruthy()
  })

  it('redirects unknown routes to the gate', () => {
    renderAt('/nonexistent')
    expect(screen.getByRole('heading', { name: 'Event Brief Builder' })).toBeTruthy()
  })
})
