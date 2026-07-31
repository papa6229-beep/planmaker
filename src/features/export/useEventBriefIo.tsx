/**
 * Export / import orchestration for `.eventbrief` files (WORK_PLAN §6, §10, and
 * Phase 7 §9). Holds the small state machine that drives validation, warning
 * confirmation, progress, and the transactional import swap.
 *
 * Step 4: this now works on the whole multi-page `BriefDocument`. Export writes
 * every page plus one preview PNG per page; import restores all pages (v1 files
 * migrate to a single page). No ZIP/canvas logic lives here — that is in the
 * services layer; this only sequences it and talks to the document and asset
 * stores.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAssets } from '../assets/useAssets'
import { useBriefDocument } from '../document/useBriefDocument'
import { deleteAssets, getAllAssets, pruneAssets, putAssets } from '../../services/assetStore'
import { resolveAssetCollisions } from '../../services/importAssets'
import { allDocumentAssetIds } from '../../services/documentStore'
import { allRequestAssetIds } from '../../services/requestStore'
import { allStudioAssetIds } from '../../services/studioStore'
import { hasUserWork, referencedAssetIds } from '../../domain/pageOps'
import { packageEventDocument } from '../../services/eventBriefExport'
import { readEventDocument, type ImportedDocument } from '../../services/eventBriefImport'
import { renderPreviewPng } from '../../services/previewRenderer'
import { EventBriefError } from '../../services/eventBriefArchive'
import { pageAsEventBrief } from '../../domain/briefMigration'
import type { ExportIssue } from './exportValidation'

export type IoState =
  | { kind: 'idle' }
  | { kind: 'export-blocked'; errors: ExportIssue[] }
  | { kind: 'export-warn'; warnings: ExportIssue[] }
  | { kind: 'exporting'; message: string }
  /** The file has been handed to the browser; shown briefly, then cleared. */
  | { kind: 'exported' }
  | { kind: 'export-failed'; message: string }
  | { kind: 'import-confirm'; pending: ImportedDocument }
  | { kind: 'importing'; message: string }
  | { kind: 'import-failed'; message: string }

export interface EventBriefIoApi {
  state: IoState
  busy: boolean
  /** Saves the file under `fileName` (already the full `.eventbrief` name). */
  startExport: (fileName?: string) => Promise<void>
  confirmExportWithWarnings: () => Promise<void>
  startImport: (file: File) => Promise<void>
  confirmImport: () => Promise<void>
  dismiss: () => void
}

const IoContext = createContext<EventBriefIoApi | null>(null)

function messageFor(err: unknown): string {
  if (err instanceof EventBriefError) return err.message
  if (err instanceof Error) return err.message
  return '알 수 없는 오류가 발생했습니다.'
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  // The anchor is left in place for a moment: removing it in the same tick can
  // cost the download the name it was given, and a file called "download" is
  // exactly what naming it was meant to prevent.
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 10_000)
}

export function EventBriefIoProvider({ children }: { children: ReactNode }) {
  const { getDocument, importDocument, saveNow } = useBriefDocument()
  const { loadFromStore } = useAssets()
  const [state, setState] = useState<IoState>({ kind: 'idle' })
  const runningRef = useRef(false)

  const dismiss = useCallback(() => setState({ kind: 'idle' }), [])

  const doExport = useCallback(async (fileName?: string) => {
    if (runningRef.current) return
    runningRef.current = true
    setState({ kind: 'exporting', message: '내보내기 준비 중…' })
    try {
      const doc = getDocument()
      // Flush the latest document so nothing in the 3s autosave window is lost.
      // Through the binding, so the brief being saved goes to its own row —
      // the image studio's job must never land in a brief-writer row.
      await saveNow()
      const stored = await getAllAssets()

      setState({ kind: 'exporting', message: '미리보기 생성 중…' })
      const blobMap = new Map(stored.map((a) => [a.id, a.blob]))
      const previews: Blob[] = []
      for (const page of doc.pages) {
        previews.push(await renderPreviewPng(pageAsEventBrief(doc, page), blobMap))
      }

      setState({ kind: 'exporting', message: '패키징 중…' })
      const pkg = await packageEventDocument({
        doc,
        assets: stored,
        previews,
        createdAt: new Date().toISOString(),
      })
      triggerDownload(pkg.blob, fileName ?? pkg.fileName)
      setState({ kind: 'exported' })
      // The confirmation is a short note, not something to dismiss.
      window.setTimeout(() => setState((s) => (s.kind === 'exported' ? { kind: 'idle' } : s)), 4000)
    } catch (err) {
      setState({ kind: 'export-failed', message: messageFor(err) })
    } finally {
      runningRef.current = false
    }
  }, [getDocument, saveNow])

  /**
   * Saving to a file preserves whatever the brief is right now. A brief may be
   * only wording, only the place a picture goes, only a sentence about how the
   * whole thing should feel, or nothing at all — the design team and, later,
   * the image AI read the gaps. So no content rule stands between the click and
   * the file (자유 저장 §2.2); the only failures reported are technical ones,
   * which `doExport` surfaces from the packaging itself.
   *
   * `validateDocumentForExport` is deliberately still here, unchanged and
   * tested: it is the advice a future AI-generation step will give. It is no
   * longer wired to this path.
   */
  const startExport = useCallback(async (fileName?: string) => {
    await doExport(fileName)
  }, [doExport])

  const confirmExportWithWarnings = useCallback(async () => {
    await doExport()
  }, [doExport])

  /**
   * Takes an archive over as the brief that is open.
   *
   * The asset pool is shared by every brief and by every delivered snapshot, so
   * an import may only ever *add* to it (v1 동결 §3). Where an incoming id is
   * already taken by a different picture, the incoming one is given a fresh id
   * and every reference in the imported document moves with it, so two briefs
   * that happen to share an id never overwrite each other's image.
   *
   * The order is: write the new binaries, save the document into the open row,
   * then swap the screen. If anything fails, the binaries this import added are
   * removed again and nothing on screen or in any other brief has changed.
   */
  const applyImport = useCallback(
    async (imported: ImportedDocument) => {
      setState({ kind: 'importing', message: '복원 중…' })
      let added: string[] = []
      try {
        const resolved = await resolveAssetCollisions(imported.doc, imported.assets)
        added = resolved.assets.map((a) => a.id)
        await putAssets(resolved.assets)
        // Saves into the row that is open, under that row's id, before the
        // screen changes — an import must not depend on the autosave window.
        await importDocument(resolved.doc)
        await loadFromStore() // rebuild object URLs from the new blobs
        // Nothing any stored brief, delivered snapshot, or the freshly imported
        // document still uses is ever swept up by this.
        const keep = new Set(referencedAssetIds(resolved.doc))
        for (const id of await allDocumentAssetIds()) keep.add(id)
        for (const id of await allRequestAssetIds()) keep.add(id)
        for (const id of await allStudioAssetIds()) keep.add(id)
        await pruneAssets(keep)
        setState({ kind: 'idle' })
      } catch (err) {
        // Roll back what this import added, keeping anything another brief or a
        // delivered snapshot has since come to rely on.
        try {
          const keep = new Set<string>()
          for (const id of await allDocumentAssetIds()) keep.add(id)
          for (const id of await allRequestAssetIds()) keep.add(id)
          for (const id of await allStudioAssetIds()) keep.add(id)
          await deleteAssets(added.filter((id) => !keep.has(id)))
        } catch {
          // best effort: an orphan blob is harmless next to a failed import
        }
        setState({ kind: 'import-failed', message: messageFor(err) })
      }
    },
    [importDocument, loadFromStore],
  )

  const startImport = useCallback(
    async (file: File) => {
      if (runningRef.current) return
      runningRef.current = true
      setState({ kind: 'importing', message: '파일 검증 중…' })
      try {
        // Pass the File (a Blob) straight to JSZip — no arrayBuffer() needed.
        const imported = await readEventDocument(file)
        if (hasUserWork(getDocument())) {
          setState({ kind: 'import-confirm', pending: imported })
        } else {
          await applyImport(imported)
        }
      } catch (err) {
        setState({ kind: 'import-failed', message: messageFor(err) })
      } finally {
        runningRef.current = false
      }
    },
    [applyImport, getDocument],
  )

  const confirmImport = useCallback(async () => {
    if (state.kind !== 'import-confirm') return
    await applyImport(state.pending)
  }, [state, applyImport])

  const api = useMemo<EventBriefIoApi>(
    () => ({
      state,
      busy: state.kind === 'exporting' || state.kind === 'importing',
      startExport,
      confirmExportWithWarnings,
      startImport,
      confirmImport,
      dismiss,
    }),
    [state, startExport, confirmExportWithWarnings, startImport, confirmImport, dismiss],
  )

  return <IoContext.Provider value={api}>{children}</IoContext.Provider>
}

export function useEventBriefIo(): EventBriefIoApi {
  const api = useContext(IoContext)
  if (api === null) throw new Error('useEventBriefIo must be used within an EventBriefIoProvider')
  return api
}
