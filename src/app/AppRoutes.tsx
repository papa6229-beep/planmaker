/**
 * Route table for the product shell (WORK_PLAN §15). Exposes only the <Routes>
 * tree (no Router) so `main.tsx` can wrap it in <BrowserRouter> and tests can
 * wrap it in <MemoryRouter>.
 *
 * Step 1 scope: the editor (existing single-page AppShell) mounts at
 * /briefs/new and /briefs/:id; every other route is a minimal placeholder.
 * Multi-page / request-awareness wiring comes in later Phase 7 steps.
 */

import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import {
  BriefsRoute,
  GateRoute,
  ImageRequestsRoute,
  ImageRequestWorkRoute,
} from './routePlaceholders'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<GateRoute />} />
      <Route path="/briefs" element={<BriefsRoute />} />
      <Route path="/briefs/new" element={<AppShell />} />
      <Route path="/briefs/:id" element={<AppShell />} />
      <Route path="/image-requests" element={<ImageRequestsRoute />} />
      <Route path="/image-requests/:id" element={<ImageRequestWorkRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
