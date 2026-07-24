/**
 * Multi-page document binding (WORK_PLAN Phase 7 §9, Step 4).
 *
 * The block editor (`BriefEditorProvider`) stays single-page and unchanged: it
 * always edits the ACTIVE page projected as an `EventBrief`. This provider owns
 * the surrounding `BriefDocument` (all pages + shared assets + activePageId) and
 * bridges the two:
 *
 *  - a sync effect writes the live editor brief back into the active page on
 *    every edit, so `document` is always current (no manual commit needed);
 *  - page operations (add/duplicate/delete/move/rename/switch) run the pure
 *    `pageOps` and re-hydrate the editor only when the active page changes, so
 *    per-page undo history survives rename/reorder;
 *  - it restores from and autosaves to IndexedDB as a v2 document (legacy v1
 *    snapshots migrate on load).
 *
 * Must be rendered inside <BriefEditorProvider> and <AssetsProvider>.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useBriefEditor } from '../editor/useBriefEditor'
import { useAssets } from '../assets/useAssets'
import { briefToDocument, pageAsEventBrief } from '../../domain/briefMigration'
import {
  addPage,
  deletePage,
  duplicatePage,
  getActivePage,
  movePage,
  renamePage,
  setActivePage,
} from '../../domain/pageOps'
import type { BriefDocument, BriefPage } from '../../domain/pageSchema'
import type { EventBrief } from '../../domain/briefSchema'
import { loadDocument, pruneAssets, saveDocument } from '../../services/assetStore'

const AUTOSAVE_DEBOUNCE_MS = 3000

export interface BriefDocumentApi {
  document: BriefDocument
  pages: BriefPage[]
  activePageId: string
  addPage: () => void
  duplicatePage: (pageId: string) => void
  deletePage: (pageId: string) => void
  movePage: (pageId: string, delta: number) => void
  renamePage: (pageId: string, title: string) => void
  switchPage: (pageId: string) => void
  /** Replaces the whole document (used by import); hydrates the active page. */
  replaceDocument: (doc: BriefDocument) => void
  /** Latest synced document (for export/persistence). */
  getDocument: () => BriefDocument
}

const BriefDocumentContext = createContext<BriefDocumentApi | null>(null)

/** Writes the live editor brief back into the active page. No-op when unchanged. */
function syncActivePage(doc: BriefDocument, brief: EventBrief): BriefDocument {
  const active = doc.pages.find((p) => p.id === doc.activePageId)
  if (!active) return doc
  if (
    active.blocks === brief.blocks &&
    active.canvasWidth === brief.project.canvasWidth &&
    active.canvasHeight === brief.project.canvasHeight &&
    doc.project.title === brief.project.title &&
    doc.assets === brief.assets
  ) {
    return doc
  }
  return {
    ...doc,
    project: { ...doc.project, title: brief.project.title },
    assets: brief.assets,
    pages: doc.pages.map((p) =>
      p.id === doc.activePageId
        ? { ...p, blocks: brief.blocks, canvasWidth: brief.project.canvasWidth, canvasHeight: brief.project.canvasHeight }
        : p,
    ),
  }
}

/** Every asset referenced by any page's blocks or reference layer. */
function referencedAssetIds(doc: BriefDocument): string[] {
  const ids = new Set<string>()
  for (const page of doc.pages) {
    for (const b of page.blocks) if (b.assetId !== undefined) ids.add(b.assetId)
    if (page.reference.assetId !== undefined) ids.add(page.reference.assetId)
  }
  return [...ids]
}

export function BriefDocumentProvider({ children }: { children: ReactNode }) {
  const { state, hydrate } = useBriefEditor()
  const { loadFromStore } = useAssets()
  const [doc, setDoc] = useState<BriefDocument>(() => briefToDocument(state.brief))

  const docRef = useRef(doc)
  docRef.current = doc
  const readyRef = useRef(false)

  // Keep restore callbacks stable for the one-shot mount effect.
  const hydrateRef = useRef(hydrate)
  hydrateRef.current = hydrate
  const loadFromStoreRef = useRef(loadFromStore)
  loadFromStoreRef.current = loadFromStore

  // Restore once on mount: a saved document (or migrated legacy v1 snapshot).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const saved = await loadDocument()
        await loadFromStoreRef.current()
        if (!cancelled && saved) {
          setDoc(saved)
          hydrateRef.current(pageAsEventBrief(saved, getActivePage(saved)))
        }
      } catch {
        // ignore: start from the in-memory initial document
      } finally {
        readyRef.current = true
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Mirror the live active-page edits into the document (after restore).
  useEffect(() => {
    if (!readyRef.current) return
    setDoc((d) => syncActivePage(d, state.brief))
  }, [state.brief])

  // Debounced autosave of the whole document + orphan-asset pruning.
  useEffect(() => {
    if (!readyRef.current) return
    const timer = setTimeout(() => {
      void saveDocument(doc, Date.now())
        .then(() => pruneAssets(referencedAssetIds(doc)))
        .catch(() => {
          // ignore: autosave is best-effort
        })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [doc])

  // Apply a page op; re-hydrate the editor only when the active page changed.
  const applyOp = useCallback(
    (next: BriefDocument) => {
      const prevActive = docRef.current.activePageId
      setDoc(next)
      if (next.activePageId !== prevActive) {
        hydrate(pageAsEventBrief(next, getActivePage(next)))
      }
    },
    [hydrate],
  )

  const replaceDocument = useCallback(
    (next: BriefDocument) => {
      readyRef.current = true
      setDoc(next)
      hydrate(pageAsEventBrief(next, getActivePage(next)))
    },
    [hydrate],
  )

  const api = useMemo<BriefDocumentApi>(
    () => ({
      document: doc,
      pages: doc.pages,
      activePageId: doc.activePageId,
      addPage: () => applyOp(addPage(docRef.current)),
      duplicatePage: (pageId) => applyOp(duplicatePage(docRef.current, pageId)),
      deletePage: (pageId) => applyOp(deletePage(docRef.current, pageId)),
      movePage: (pageId, delta) => applyOp(movePage(docRef.current, pageId, delta)),
      renamePage: (pageId, title) => applyOp(renamePage(docRef.current, pageId, title)),
      switchPage: (pageId) => {
        if (pageId !== docRef.current.activePageId) applyOp(setActivePage(docRef.current, pageId))
      },
      replaceDocument,
      getDocument: () => docRef.current,
    }),
    [doc, applyOp, replaceDocument],
  )

  return <BriefDocumentContext.Provider value={api}>{children}</BriefDocumentContext.Provider>
}

export function useBriefDocument(): BriefDocumentApi {
  const api = useContext(BriefDocumentContext)
  if (api === null) {
    throw new Error('useBriefDocument must be used within a BriefDocumentProvider')
  }
  return api
}
