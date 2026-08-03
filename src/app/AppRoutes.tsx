/**
 * Route table for the product shell (WORK_PLAN §15). Exposes only the <Routes>
 * tree (no Router) so `main.tsx` wraps it in <BrowserRouter> and tests wrap it
 * in <MemoryRouter>.
 *
 * The table depends on the surface this build runs as (타 팀 배포 §4):
 *
 *  - `brief-writer` — the brief writer alone. `/`, every internal address, and
 *    anything unknown all land in a brief. The internal screens are not mounted
 *    at all, so typing their address cannot reach them, and `RequestsProvider`
 *    is not mounted either: nothing here has a work queue to read.
 *  - `studio` — the design team's build. It now opens on the image studio work
 *    surface (`/studio`, 이미지 생성기 0단계 §4); the gate, the image-request
 *    list, and the request work page stay mounted exactly where they were.
 *
 * Nothing internal is deleted, and both surfaces render the same editor from
 * the same components. This file decides only what a deployment can reach.
 */

import { Navigate, Route, Routes } from 'react-router-dom'
import { BriefEditorRoute, NewBriefRoute } from './pages/BriefEditorRoute'
import { EntryGate } from '../features/gate/EntryGate'
import { BriefsPage } from './pages/BriefsPage'
import { ImageRequestsPage } from './pages/ImageRequestsPage'
import { ImageRequestWorkPage } from './pages/ImageRequestWorkPage'
import { StudioWorkPage } from './pages/StudioWorkPage'
import { TeamGatePage } from './pages/TeamGatePage'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'
import { APP_SURFACE, type AppSurface } from './appSurface'
import { AppSurfaceProvider } from './AppSurfaceContext'

/**
 * Where a planner lands: the team gate (첫 사용 흐름 §4). Arriving at the shared
 * address must not open somebody else's work, so the first question is which
 * team is writing — and the answer starts an empty brief of its own.
 */
const WRITER_HOME = '/'

/** Where the design team lands: the image studio work surface. */
const STUDIO_HOME = '/studio'

function WriterRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TeamGatePage />} />
      <Route path="/briefs/new" element={<NewBriefRoute />} />
      <Route path="/briefs/:id" element={<BriefEditorRoute />} />
      {/* `/gate`, `/image-requests`, and anything else all mean "start here" —
          never a 404, and never an internal screen. */}
      <Route path="*" element={<Navigate to={WRITER_HOME} replace />} />
    </Routes>
  )
}

function StudioRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={STUDIO_HOME} replace />} />
      <Route path="/studio" element={<StudioWorkPage />} />
      <Route path="/gate" element={<EntryGate />} />
      <Route path="/briefs" element={<BriefsPage />} />
      <Route path="/briefs/new" element={<NewBriefRoute />} />
      <Route path="/briefs/:id" element={<BriefEditorRoute />} />
      <Route path="/image-requests" element={<ImageRequestsPage />} />
      <Route path="/image-requests/:id" element={<ImageRequestWorkPage />} />
      <Route path="*" element={<Navigate to={STUDIO_HOME} replace />} />
    </Routes>
  )
}

export function AppRoutes({ surface = APP_SURFACE }: { surface?: AppSurface } = {}) {
  if (surface === 'studio') {
    return (
      <AppSurfaceProvider surface="studio">
        <RequestsProvider>
          <DocumentsProvider>
            <StudioRoutes />
          </DocumentsProvider>
        </RequestsProvider>
      </AppSurfaceProvider>
    )
  }
  return (
    <AppSurfaceProvider surface="brief-writer">
      <DocumentsProvider>
        <WriterRoutes />
      </DocumentsProvider>
    </AppSurfaceProvider>
  )
}
