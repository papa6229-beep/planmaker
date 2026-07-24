/**
 * Local autosave + restore (WORK_PLAN §16). On mount it restores the brief and
 * asset URLs from IndexedDB; thereafter it debounces (3s) saves of the brief
 * snapshot and prunes orphaned asset blobs. Renders nothing.
 */

import { useEffect, useRef } from 'react'
import { useBriefEditor } from '../editor/useBriefEditor'
import { useAssets } from './useAssets'
import { loadBrief, pruneAssets, saveBrief } from '../../services/assetStore'

const AUTOSAVE_DEBOUNCE_MS = 3000

function referencedAssetIds(blocks: { assetId?: string }[]): string[] {
  const ids = new Set<string>()
  for (const b of blocks) if (b.assetId !== undefined) ids.add(b.assetId)
  return [...ids]
}

export function Persistence() {
  const { state, hydrate } = useBriefEditor()
  const { loadFromStore } = useAssets()
  const loadedRef = useRef(false)

  // Keep latest callbacks in refs so the one-shot restore effect has an honest
  // empty dependency list (hydrate's identity changes on every edit).
  const hydrateRef = useRef(hydrate)
  hydrateRef.current = hydrate
  const loadFromStoreRef = useRef(loadFromStore)
  loadFromStoreRef.current = loadFromStore

  // Restore once on mount. Failures (e.g. IndexedDB unavailable in private
  // mode) are non-fatal — the app just starts from a fresh brief.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const saved = await loadBrief()
        await loadFromStoreRef.current()
        if (!cancelled && saved) hydrateRef.current(saved)
      } catch {
        // ignore: continue with the in-memory initial state
      } finally {
        loadedRef.current = true
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced autosave whenever the brief changes (after the initial restore).
  useEffect(() => {
    if (!loadedRef.current) return
    const brief = state.brief
    const timer = setTimeout(() => {
      void saveBrief(brief, Date.now())
        .then(() => pruneAssets(referencedAssetIds(brief.blocks)))
        .catch(() => {
          // ignore: autosave is best-effort
        })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [state.brief])

  return null
}
