import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './app/AppRoutes'
import { APP_SURFACE } from './app/appSurface'
import { clearStudioOnFreshVisit } from './services/freshVisit'
import './styles/global.css'
// 다크룸 스킨 (2026-09-17) — 색만 덮는다. 반드시 global.css 뒤.
import './styles/darkroom.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

function mount(): void {
  createRoot(rootElement!).render(
    <StrictMode>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </StrictMode>,
  )
}

// 접속하면 빈 작업판에서 시작한다 (2026-09-18). 화면을 세우기 전에 비워야
// 옛 작업이 한 번 보였다가 사라지는 일이 없다. 작성기에서는 하지 않는다.
if (APP_SURFACE === 'studio') {
  void clearStudioOnFreshVisit().then(mount)
} else {
  mount()
}
