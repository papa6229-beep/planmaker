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
  referencedAssetIds,
  setReferenceImage as setPageReferenceImage,
  setReferenceOpacity as setPageReferenceOpacity,
  setReferenceViewMode as setPageReferenceViewMode,
  setReferenceVisible as setPageReferenceVisible,
  withReferencedAssets,
} from '../../domain/pageOps'
import type { BriefDocument, BriefPage, ReferenceLayer } from '../../domain/pageSchema'
import type { Asset, EventBrief } from '../../domain/briefSchema'
import type { RequestTeam } from '../../domain/requestTeam'
import { loadDocument, pruneAssets, saveDocument } from '../../services/assetStore'
import { allRequestAssetIds } from '../../services/requestStore'
import { allDocumentAssetIds } from '../../services/documentStore'
import { allStudioAssetIds } from '../../services/studioStore'

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
  /**
   * 페이지를 복제하면서 새로 받은 블록 이름들 — 원본 → 사본 (복제 설정 Patch).
   *
   * 복제한 페이지의 블록은 **새 이름**을 받는다. 그런데 컷아웃 설정·제품 이미지
   * 연결·블록 주문은 기획서 문서 밖(작업판)에 블록 이름으로 매달려 있어서, 이름이
   * 바뀌는 순간 사본은 그 전부를 잃는다 — 실제로 잃었다.
   *
   * 그래서 무엇이 무엇의 사본인지 여기서 말해 둔다. 작업판이 그것을 읽고 옮긴다.
   * 블록 복제(`useBriefEditor`의 `cloneOf`)가 쓰는 것과 같은 모양이다.
   */
  pageCloneOf: Record<string, string>
  deletePage: (pageId: string) => void
  /**
   * The document as it was just before the last page deletion, if that is still
   * the most recent thing that happened. Page structure lives outside the
   * editor's undo history, so the toolbar restores it from here (손검수 2 §4.2).
   */
  undoPageDelete: (() => void) | null
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
  /** 디자인팀에게 전달할 말 — the planner's request to whoever makes the image. */
  designerNote: string
  setDesignerNote: (note: string) => void
  /**
   * 팀 안에서 주고받는 말 (팀 메모 Patch). 팀장이 팀원에게 남기는 수정 사항이다.
   *
   * 받는 사람이 앞의 것과 다르다 — 디자인팀에게도, AI에게도 가지 않는다.
   */
  teamNote: string
  setTeamNote: (note: string) => void
  /** AI에게 추가로 전달할 말 — the studio worker's own instruction (§6-2). */
  aiNote: string
  setAiNote: (note: string) => void
  /** 작성팀 — which team wrote this brief; `undefined` is 팀 미지정 (v1 마감 §11). */
  requestTeam: string | undefined
  setRequestTeam: (team: RequestTeam | undefined) => void
  /** Replaces the whole document (used by import); hydrates the active page. */
  replaceDocument: (doc: BriefDocument) => void
  /**
   * Takes an imported document over as *this* brief: it is saved into the row
   * that is open, under that row's identity, before anything on screen changes
   * (v1 동결 §5). Rejects without touching the screen if the write fails.
   */
  importDocument: (doc: BriefDocument) => Promise<void>
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

/**
 * Writes the live editor brief back into the active page, then makes the
 * document's asset list say exactly what the document uses.
 *
 * Two different mistakes meet here, so both are stated. The editor knows only
 * the assets *its* blocks use, so taking its list wholesale deleted the page's
 * 참고 이미지 metadata and left exported files with a picture missing. Keeping
 * every asset the document had ever seen fixed that but left the opposite
 * mark: an image the planner removed stayed in the file. The list is therefore
 * derived — every asset any page references, with the editor's metadata
 * preferred where both know one (v1 동결 §4).
 */
function syncActivePage(doc: BriefDocument, brief: EventBrief): BriefDocument {
  const active = doc.pages.find((p) => p.id === doc.activePageId)
  if (!active) return doc
  const sameEdits =
    active.blocks === brief.blocks &&
    active.canvasWidth === brief.project.canvasWidth &&
    active.canvasHeight === brief.project.canvasHeight &&
    doc.project.title === brief.project.title
  const next = sameEdits
    ? doc
    : {
        ...doc,
        project: { ...doc.project, title: brief.project.title },
        pages: doc.pages.map((p) =>
          p.id === doc.activePageId
            ? { ...p, blocks: brief.blocks, canvasWidth: brief.project.canvasWidth, canvasHeight: brief.project.canvasHeight }
            : p,
        ),
      }
  return withReferencedAssets(next, brief.assets)
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
  /**
   * The document as it was just before a page was deleted, and the document the
   * deletion produced. Both halves matter: the first is what 실행 취소 restores,
   * and the second is how we know the deletion is still the newest thing that
   * happened. Page structure lives outside the editor's undo history, so
   * without this the snapshot survived later edits and 실행 취소 would restore
   * the whole document — throwing away everything done since (v1 동결 §7).
   */
  const [deletedPage, setDeletedPage] = useState<{ before: BriefDocument; after: BriefDocument } | null>(null)
  /** 사본 블록 → 원본 블록. 작업판이 읽고 설정을 옮긴다 (복제 설정 Patch). */
  const [pageCloneOf, setPageCloneOf] = useState<Record<string, string>>({})

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
          // The design team's product cut-outs are deliberately absent from the
          // brief document, so nothing else here knows they are in use.
          for (const id of await allStudioAssetIds()) keep.add(id)
          await pruneAssets(keep)
        })
        .catch(() => {
          // ignore: autosave is best-effort
        })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [doc])

  /**
   * Applies a page op; re-hydrates the editor only when the active page changed.
   *
   * The asset list is settled here rather than left to the sync effect, so the
   * document a page op produces is already final — deleting a page that held an
   * image would otherwise be followed a tick later by a second, different
   * document, which is exactly what the page-delete snapshot is compared
   * against.
   */
  const applyOp = useCallback(
    (next: BriefDocument) => {
      const prevActive = docRef.current.activePageId
      const settled = withReferencedAssets(next, briefRef.current.assets)
      docRef.current = settled
      setDoc(settled)
      if (settled.activePageId !== prevActive) {
        hydrate(pageAsEventBrief(settled, getActivePage(settled)))
      }
    },
    [hydrate],
  )

  /** Restores the document exactly as it was before the page was deleted. */
  const restoreDeletedPage = useCallback(() => {
    const snapshot = deletedPage?.before
    if (!snapshot) return
    setDeletedPage(null)
    docRef.current = snapshot
    setDoc(snapshot)
    hydrate(pageAsEventBrief(snapshot, getActivePage(snapshot)))
  }, [deletedPage, hydrate])

  // One boundary for the rule: the moment the document moves on from the page
  // deletion — a block edited, a page added or renamed, a page dragged longer,
  // the reference changed, the title, concept or team touched, a file opened —
  // the snapshot stops being what 실행 취소 means.
  useEffect(() => {
    if (deletedPage !== null && doc !== deletedPage.after) setDeletedPage(null)
  }, [doc, deletedPage])

  const replaceDocument = useCallback(
    (next: BriefDocument) => {
      readyRef.current = true
      setDeletedPage(null)
      setDoc(next)
      hydrate(pageAsEventBrief(next, getActivePage(next)))
    },
    [hydrate],
  )

  /**
   * Opening a file replaces the brief that is open — it does not create the
   * brief the file came from. The row's own identity therefore wins over the
   * `project.id` the file was written with, and the write happens *first*: an
   * import that is only on screen is lost by a refresh, by moving to another
   * brief, or by delivering before the autosave window elapses.
   */
  const importDocument = useCallback(
    async (next: BriefDocument) => {
      const currentId = docRef.current.project.id
      const owned: BriefDocument =
        currentId === undefined ? next : { ...next, project: { ...next.project, id: currentId } }
      await bindingRef.current.save(owned, Date.now())
      replaceDocument(owned)
    },
    [replaceDocument],
  )

  // Reference-layer mutations live only in the document (not the editor brief),
  // so they never re-hydrate. The sync effect preserves the reference layer.
  const mutateDoc = useCallback((fn: (doc: BriefDocument) => BriefDocument) => {
    // Same settling as `applyOp`: what the document becomes here is final.
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
      duplicatePage: (pageId) => {
        const before = docRef.current
        const source = before.pages.find((p) => p.id === pageId)
        const after = duplicatePage(before, pageId)
        // 사본은 원본 바로 뒤에 선다. 블록 차례는 그대로이므로 같은 자리끼리
        // 짝지으면 원본 → 사본이 나온다.
        const copy = after.pages.find((p) => !before.pages.some((old) => old.id === p.id))
        if (source !== undefined && copy !== undefined) {
          const pairs: Record<string, string> = {}
          source.blocks.forEach((block, i) => {
            const made = copy.blocks[i]
            if (made !== undefined) pairs[made.id] = block.id
          })
          setPageCloneOf((current) => ({ ...current, ...pairs }))
        }
        applyOp(after)
      },
      deletePage: (pageId) => {
        // Everything the page held — blocks, its length, its reference image —
        // comes back with one 실행 취소, so the snapshot is the whole document.
        const before = docRef.current
        const after = withReferencedAssets(deletePage(before, pageId), briefRef.current.assets)
        setDeletedPage({ before, after })
        applyOp(after)
      },
      pageCloneOf,
      undoPageDelete: deletedPage === null ? null : restoreDeletedPage,
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
      designerNote: doc.project.designerNote ?? '',
      setDesignerNote: (next) => mutateDoc((d) => ({ ...d, project: { ...d.project, designerNote: next } })),
      teamNote: doc.project.teamNote ?? '',
      setTeamNote: (next) => mutateDoc((d) => ({ ...d, project: { ...d.project, teamNote: next } })),
      aiNote: doc.project.aiNote ?? '',
      setAiNote: (next) => mutateDoc((d) => ({ ...d, project: { ...d.project, aiNote: next } })),
      requestTeam: doc.project.requestTeam,
      setRequestTeam: (team) =>
        mutateDoc((d) => {
          const project = { ...d.project }
          // 팀 미지정 is the absence of a team, not a team called "none".
          if (team === undefined) delete project.requestTeam
          else project.requestTeam = team
          return { ...d, project }
        }),
      importDocument,
      getDocument: () => syncActivePage(docRef.current, briefRef.current),
      saveNow: async () => {
        const current = syncActivePage(docRef.current, briefRef.current)
        await bindingRef.current.save(current, Date.now())
      },
    }),
    [doc, applyOp, replaceDocument, importDocument, setReferenceImage, mutateDoc, deletedPage, restoreDeletedPage, pageCloneOf],
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
