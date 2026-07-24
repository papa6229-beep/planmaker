/**
 * Common top app header for the product shell (WORK_PLAN Phase 7 §3A, §7).
 * Brand only — no login / notification / settings controls this step.
 */

import { AppBrand } from './AppBrand'

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <AppBrand />
      </div>
    </header>
  )
}
