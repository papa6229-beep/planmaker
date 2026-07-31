/**
 * Which surface of PLANMAKER this build shows (타 팀 배포 §3).
 *
 * There is one codebase and one brief writer. What differs is how much of the
 * product a given deployment exposes:
 *
 *  - `brief-writer` — what marketing, product and CS open. The brief writer and
 *    nothing else: no feature gate, no image-generation queue, no 전달하기.
 *    Briefs leave as `.eventbrief` files, sent by hand.
 *  - `studio` — the design team's build, where the image-generation screens and
 *    the internal work-request flow stay available. Nothing here is finished
 *    yet; this surface simply keeps it reachable.
 *
 * The public default is `brief-writer`, and it is the *fallback* for anything
 * unrecognised: a misspelt or missing setting must never quietly open the
 * internal screens to another team.
 */

export type AppSurface = 'brief-writer' | 'studio'

export const DEFAULT_APP_SURFACE: AppSurface = 'brief-writer'

/** Reads a configured surface; only an exact `studio` opts into the studio. */
export function resolveAppSurface(value: string | undefined): AppSurface {
  return value === 'studio' ? 'studio' : DEFAULT_APP_SURFACE
}

/**
 * The surface this build runs as, from `VITE_PLANMAKER_SURFACE`.
 *
 * Read once at module load so a single deployment cannot change surface while
 * running. Components take the surface as a prop defaulting to this, which is
 * what lets tests render either one without touching the environment.
 */
export const APP_SURFACE: AppSurface = resolveAppSurface(import.meta.env.VITE_PLANMAKER_SURFACE)
