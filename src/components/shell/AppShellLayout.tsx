/**
 * Shared page layout for non-editor routes (WORK_PLAN Phase 7 §7, §9). Provides
 * the common header and a centered content container so the gate and list pages
 * share consistent width and spacing. The editor routes do NOT use this — they
 * mount their own full-height AppShell unchanged.
 */

import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader'

export function AppShellLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="shell">
      <AppHeader />
      <main className={`shell__main${wide ? ' shell__main--wide' : ''}`}>{children}</main>
    </div>
  )
}
