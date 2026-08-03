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
import { useStudioJob } from '../studio/useStudioJob'
import { remapStudioFileState, studioFileAssetIds, toStudioFileState } from '../../domain/studioFile'
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
  const { getDocument, importDocument, replaceDocument, saveNow } = useBriefDocument()
  const { loadFromStore } = useAssets()
  /**
   * 작업판에서만 있는 것. 파일에 함께 담기는 Studio 상태와, 파일에서 되살릴 곳이
   * 여기 하나로 모인다 — 직렬화·검증·재매핑 자체는 `domain/studioFile`의 순수
   * 함수가 맡고, 여기서는 순서만 지킨다.
   */
  const studio = useStudioJob()
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
        // 작업판에서 저장한 파일에는 연결한 제품 이미지 원본과 그 연결정보가
        // 함께 들어간다. 하나라도 원본을 찾지 못하면 여기서 저장이 실패한다.
        ...(studio === null ? {} : { studio: toStudioFileState(studio.job) }),
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
  }, [getDocument, saveNow, studio])

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
   * The order is: everything that can fail first — write the new binaries,
   * rebuild the picture cache, sweep — and only then the step that puts the
   * imported brief in front of the user. Anything that fails does so while the
   * previous document, the previous Studio job and every one of its links are
   * still exactly what they were; the binaries this import added are removed
   * again and nothing on screen or in any other brief has changed.
   *
   * This order matters more than it looks. A sweep that failed *after* the swap
   * left the user reading "불러오기 실패" while sitting on top of the new file,
   * with their own work gone from the screen — the one thing a failed import
   * must never do. Making the sweep quietly ignore its own failure would have
   * hidden the message, not the loss.
   */
  const applyImport = useCallback(
    async (imported: ImportedDocument) => {
      setState({ kind: 'importing', message: '복원 중…' })
      let added: string[] = []
      try {
        const resolved = await resolveAssetCollisions(imported.doc, imported.assets)
        added = resolved.assets.map((a) => a.id)
        // 연결 재번호는 기획서 참조와 **같은 매핑**으로 한다.
        const studioState =
          studio === null || imported.studio === undefined
            ? null
            : remapStudioFileState(imported.studio, resolved.renamed)
        await putAssets(resolved.assets)
        await loadFromStore() // rebuild object URLs from the new blobs
        // Nothing any stored brief, delivered snapshot, the Studio job as it
        // stands, or the brief about to be opened still uses is swept up here.
        // The incoming file's own images are named explicitly: the rows that
        // will point at them have not been written yet.
        const keep = new Set(referencedAssetIds(resolved.doc))
        if (studioState !== null) for (const id of studioFileAssetIds(studioState)) keep.add(id)
        for (const id of await allDocumentAssetIds()) keep.add(id)
        for (const id of await allRequestAssetIds()) keep.add(id)
        for (const id of await allStudioAssetIds()) keep.add(id)
        await pruneAssets(keep)

        // 여기서부터가 교체다. 위의 어느 단계가 실패했다면 이 줄에 오지 않는다.
        if (studio !== null) {
          // 작업판: 문서·원본 지문·제품 이미지 연결이 한 행에 함께 저장된 뒤에야
          // 화면이 바뀐다.
          await studio.adoptFile(resolved.doc, studioState)
          replaceDocument(resolved.doc)
        } else {
          // Saves into the row that is open, under that row's id, before the
          // screen changes — an import must not depend on the autosave window.
          await importDocument(resolved.doc)
        }
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
    [importDocument, replaceDocument, loadFromStore, studio],
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
