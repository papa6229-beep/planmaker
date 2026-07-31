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
  removeReferenceImage as removePageReference,
  renamePage,
  setActivePage,
  setReferenceFit as setPageReferenceFit,
  setReferenceImage as setPageReferenceImage,
  setReferenceOpacity as setPageReferenceOpacity,
  setReferenceViewMode as setPageReferenceViewMode,
  setReferenceVisible as setPageReferenceVisible,
} from '../../domain/pageOps'
import type { BriefDocument, BriefPage, ReferenceLayer } from '../../domain/pageSchema'
import type { Asset, EventBrief } from '../../domain/briefSchema'
import { loadDocument, pruneAssets, saveDocument } from '../../services/assetStore'
import { allRequestAssetIds } from '../../services/requestStore'
import { allDocumentAssetIds } from '../../services/documentStore'

const AUTOSAVE_DEBOUNCE_MS = 3000

/**
 * How the provider loads and persists its document. The default binds to the
 * single autosaved brief; the request work page (§13.2) binds to a work
 * request's editable copy instead, leaving the submitted snapshot untouched.
 */
export interface DocumentBinding {
  load: () => Promise<BriefDocument | null>
  save: (doc: BriefDocument, now: number) => Promise<void>
}

const DEFAULT_BINDING: DocumentBinding = { load: loadDocument, save: saveDocument }

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
  /** The active page's reference layer (WORK_PLAN §8). */
  activeReference: ReferenceLayer
  /** Sets the active page's reference image (adds the asset to the pool). */
  setReferenceImage: (asset: Asset) => void
  removeReferenceImage: () => void
  setReferenceViewMode: (mode: ReferenceLayer['viewMode']) => void
  setReferenceOpacity: (opacity: number) => void
  setReferenceFit: (fit: ReferenceLayer['fit']) => void
  setReferenceVisible: (visible: boolean) => void
  /** 전체 컨셉 — document-wide direction for the AI / design team (§5). */
  concept: string
  setConcept: (concept: string) => void
  /** Replaces the whole document (used by import); hydrates the active page. */
  replaceDocument: (doc: BriefDocument) => void
  /** Latest synced document (for export/persistence). */
  getDocument: () => BriefDocument
  /**
   * Flushes the current document through the binding immediately and rejects if
   * the write fails. Used before switching to another brief so nothing is lost
   * and, on failure, the switch can be abandoned.
   */
  saveNow: () => Promise<void>
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

export function BriefDocumentProvider({
  children,
  binding = DEFAULT_BINDING,
}: {
  children: ReactNode
  binding?: DocumentBinding
}) {
  const { state, hydrate } = useBriefEditor()
  const { loadFromStore } = useAssets()
  const [doc, setDoc] = useState<BriefDocument>(() => briefToDocument(state.brief))

  const docRef = useRef(doc)
  docRef.current = doc
  const readyRef = useRef(false)

  // Keep restore callbacks + latest brief stable for the one-shot mount effect.
  const hydrateRef = useRef(hydrate)
  hydrateRef.current = hydrate
  const loadFromStoreRef = useRef(loadFromStore)
  loadFromStoreRef.current = loadFromStore
  const briefRef = useRef(state.brief)
  briefRef.current = state.brief
  const bindingRef = useRef(binding)
  bindingRef.current = binding

  // Restore once on mount: a saved document (or migrated legacy v1 snapshot).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const saved = await bindingRef.current.load()
        await loadFromStoreRef.current()
        if (!cancelled) {
          // A brief created moments ago is an empty row, so restoring it must
          // not wipe blocks the user already added while the read was in
          // flight — fold those in exactly as for "nothing saved yet".
          const savedIsEmpty = saved !== null && saved.pages.every((p) => p.blocks.length === 0)
          const editedBeforeRestore = briefRef.current.blocks.length > 0

          if (saved && !(savedIsEmpty && editedBeforeRestore)) {
            setDoc(saved)
            hydrateRef.current(pageAsEventBrief(saved, getActivePage(saved)))
          } else if (saved) {
            // Keep the saved document's identity and pages, but carry the
            // in-flight edits into its active page.
            setDoc(syncActivePage(saved, briefRef.current))
          } else {
            // No saved document: fold in any edits made before restore resolved
            // (the sync effect was gated off until now), so nothing is dropped.
            setDoc((d) => syncActivePage(d, briefRef.current))
          }
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

  // Debounced autosave of the whole document + orphan-asset pruning. Assets
  // referenced by any delivered request are also kept, so a submitted snapshot
  // never loses its images when the live document stops using them (§6).
  useEffect(() => {
    if (!readyRef.current) return
    const timer = setTimeout(() => {
      void bindingRef.current.save(doc, Date.now())
        .then(async () => {
          // Keep every asset any *stored* brief or delivered request still
          // needs — pruning must never strip another brief's images just
          // because the one being edited stopped using them.
          const keep = new Set(referencedAssetIds(doc))
          for (const id of await allDocumentAssetIds()) keep.add(id)
          for (const id of await allRequestAssetIds()) keep.add(id)
          await pruneAssets(keep)
        })
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

  // Reference-layer mutations live only in the document (not the editor brief),
  // so they never re-hydrate. The sync effect preserves the reference layer.
  const mutateDoc = useCallback((fn: (doc: BriefDocument) => BriefDocument) => {
    // `docRef.current` is refreshed on render, so several mutations fired in one
    // event handler would all read the same stale document and the last would
    // win. Advancing the ref here makes them compose (e.g. 참고 이미지 위에서
    // 시작 sets the image, the view mode, and visibility in one go).
    const next = fn(docRef.current)
    docRef.current = next
    setDoc(next)
  }, [])

  const setReferenceImage = useCallback(
    (asset: Asset) => {
      mutateDoc((d) => {
        const withAsset = d.assets.some((a) => a.id === asset.id) ? d : { ...d, assets: [...d.assets, asset] }
        return setPageReferenceImage(withAsset, withAsset.activePageId, asset.id)
      })
    },
    [mutateDoc],
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
      activeReference: getActivePage(doc).reference,
      setReferenceImage,
      removeReferenceImage: () => mutateDoc((d) => removePageReference(d, d.activePageId)),
      setReferenceViewMode: (mode) => mutateDoc((d) => setPageReferenceViewMode(d, d.activePageId, mode)),
      setReferenceOpacity: (opacity) => mutateDoc((d) => setPageReferenceOpacity(d, d.activePageId, opacity)),
      setReferenceFit: (fit) => mutateDoc((d) => setPageReferenceFit(d, d.activePageId, fit)),
      setReferenceVisible: (visible) => mutateDoc((d) => setPageReferenceVisible(d, d.activePageId, visible)),
      replaceDocument,
      // Sync the live editor brief on read so export/persistence never depend on
      // the async sync-effect timing (avoids a mount-race where a just-added
      // block isn't yet folded into the document).
      concept: doc.project.concept ?? '',
      setConcept: (next) => mutateDoc((d) => ({ ...d, project: { ...d.project, concept: next } })),
      getDocument: () => syncActivePage(docRef.current, briefRef.current),
      saveNow: async () => {
        const current = syncActivePage(docRef.current, briefRef.current)
        await bindingRef.current.save(current, Date.now())
      },
    }),
    [doc, applyOp, replaceDocument, setReferenceImage, mutateDoc],
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
