/**
 * Carries the current surface down to the components that must differ by it
 * (타 팀 배포 §3.2).
 *
 * A context rather than a prop threaded through the shell: only the top bar
 * asks, and the screens in between have no business knowing. The default is the
 * surface this build resolved at load, so a component rendered outside a
 * provider behaves as the deployment does — and that default is the safe one.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { APP_SURFACE, type AppSurface } from './appSurface'

const AppSurfaceContext = createContext<AppSurface>(APP_SURFACE)

export function AppSurfaceProvider({ surface, children }: { surface: AppSurface; children: ReactNode }) {
  return <AppSurfaceContext.Provider value={surface}>{children}</AppSurfaceContext.Provider>
}

/** The surface being shown; `brief-writer` unless a build says otherwise. */
export function useAppSurface(): AppSurface {
  return useContext(AppSurfaceContext)
}
