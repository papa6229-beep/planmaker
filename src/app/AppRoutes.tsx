/**
 * Route table for the product shell (WORK_PLAN §15). Exposes only the <Routes>
 * tree (no Router) so `main.tsx` wraps it in <BrowserRouter> and tests wrap it
 * in <MemoryRouter>.
 *
 * Phase 7 Step 2: the gate, /briefs, and /image-requests are designed product
 * screens (no fake data). The editor (existing AppShell) mounts unchanged at
 * /briefs/new and /briefs/:id.
 */

import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { EntryGate } from '../features/gate/EntryGate'
import { BriefsPage } from './pages/BriefsPage'
import { ImageRequestsPage } from './pages/ImageRequestsPage'
import { ImageRequestWorkPage } from './pages/ImageRequestWorkPage'
import { RequestsProvider } from '../features/requests/useRequests'

export function AppRoutes() {
  return (
    <RequestsProvider>
      <Routes>
        <Route path="/" element={<EntryGate />} />
        <Route path="/briefs" element={<BriefsPage />} />
        <Route path="/briefs/new" element={<AppShell />} />
        <Route path="/briefs/:id" element={<AppShell />} />
        <Route path="/image-requests" element={<ImageRequestsPage />} />
        <Route path="/image-requests/:id" element={<ImageRequestWorkPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RequestsProvider>
  )
}
