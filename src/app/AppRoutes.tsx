/**
 * Route table for the product shell (WORK_PLAN §15). Exposes only the <Routes>
 * tree (no Router) so `main.tsx` wraps it in <BrowserRouter> and tests wrap it
 * in <MemoryRouter>.
 *
 * Phase 7 Step 2: the gate, /briefs, and /image-requests are designed product
 * screens (no fake data). The editor (existing AppShell) mounts unchanged at
 * /briefs/new and /briefs/:id.
 *
 * Opening the app puts a planner straight into a brief (v1 마감 §10.2). The gate
 * is still here — the image-generation side of the product needs it later — it
 * simply is not what anyone lands on now.
 */

import { Navigate, Route, Routes } from 'react-router-dom'
import { BriefEditorRoute, NewBriefRoute } from './pages/BriefEditorRoute'
import { EntryGate } from '../features/gate/EntryGate'
import { BriefsPage } from './pages/BriefsPage'
import { ImageRequestsPage } from './pages/ImageRequestsPage'
import { ImageRequestWorkPage } from './pages/ImageRequestWorkPage'
import { RequestsProvider } from '../features/requests/useRequests'
import { DocumentsProvider } from '../features/documents/useDocuments'

export function AppRoutes() {
  return (
    <RequestsProvider>
      <DocumentsProvider>
        <Routes>
        <Route path="/" element={<Navigate to="/briefs/new" replace />} />
        <Route path="/gate" element={<EntryGate />} />
        <Route path="/briefs" element={<BriefsPage />} />
        <Route path="/briefs/new" element={<NewBriefRoute />} />
        <Route path="/briefs/:id" element={<BriefEditorRoute />} />
        <Route path="/image-requests" element={<ImageRequestsPage />} />
        <Route path="/image-requests/:id" element={<ImageRequestWorkPage />} />
        <Route path="*" element={<Navigate to="/briefs/new" replace />} />
        </Routes>
      </DocumentsProvider>
    </RequestsProvider>
  )
}
