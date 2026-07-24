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
import { getAllAssets, pruneAssets, replaceAssets, saveDocument } from '../../services/assetStore'
import { packageEventDocument } from '../../services/eventBriefExport'
import { readEventDocument, type ImportedDocument } from '../../services/eventBriefImport'
import { renderPreviewPng } from '../../services/previewRenderer'
import { EventBriefError } from '../../services/eventBriefArchive'
import { pageAsEventBrief } from '../../domain/briefMigration'
import type { BriefDocument } from '../../domain/pageSchema'
import { validateDocumentForExport, type ExportIssue } from './exportValidation'

export type IoState =
  | { kind: 'idle' }
  | { kind: 'export-blocked'; errors: ExportIssue[] }
  | { kind: 'export-warn'; warnings: ExportIssue[] }
  | { kind: 'exporting'; message: string }
  | { kind: 'export-failed'; message: string }
  | { kind: 'import-confirm'; pending: ImportedDocument }
  | { kind: 'importing'; message: string }
  | { kind: 'import-failed'; message: string }

export interface EventBriefIoApi {
  state: IoState
  busy: boolean
  startExport: () => Promise<void>
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
  a.remove()
  // Defer revocation so the browser doesn't abort the in-flight download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function hasAnyBlocks(doc: BriefDocument): boolean {
  return doc.pages.some((p) => p.blocks.length > 0)
}

export function EventBriefIoProvider({ children }: { children: ReactNode }) {
  const { getDocument, replaceDocument } = useBriefDocument()
  const { loadFromStore } = useAssets()
  const [state, setState] = useState<IoState>({ kind: 'idle' })
  const runningRef = useRef(false)

  const dismiss = useCallback(() => setState({ kind: 'idle' }), [])

  const doExport = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setState({ kind: 'exporting', message: '내보내기 준비 중…' })
    try {
      const doc = getDocument()
      // Flush the latest document so nothing in the 3s autosave window is lost.
      await saveDocument(doc, Date.now())
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
      triggerDownload(pkg.blob, pkg.fileName)
      setState({ kind: 'idle' })
    } catch (err) {
      setState({ kind: 'export-failed', message: messageFor(err) })
    } finally {
      runningRef.current = false
    }
  }, [getDocument])

  const startExport = useCallback(async () => {
    if (runningRef.current) return
    const doc = getDocument()
    const stored = await getAllAssets()
    const availableIds = new Set(stored.map((a) => a.id))
    const result = validateDocumentForExport(doc, availableIds)
    if (result.errors.length > 0) {
      setState({ kind: 'export-blocked', errors: result.errors })
      return
    }
    if (result.warnings.length > 0) {
      setState({ kind: 'export-warn', warnings: result.warnings })
      return
    }
    await doExport()
  }, [doExport, getDocument])

  const confirmExportWithWarnings = useCallback(async () => {
    await doExport()
  }, [doExport])

  const applyImport = useCallback(
    async (imported: ImportedDocument) => {
      setState({ kind: 'importing', message: '복원 중…' })
      try {
        // Transactional swap: persist first, then hydrate the UI.
        await saveDocument(imported.doc, Date.now())
        await replaceAssets(imported.assets)
        const referenced = new Set<string>()
        for (const page of imported.doc.pages) {
          for (const b of page.blocks) if (b.assetId !== undefined) referenced.add(b.assetId)
          if (page.reference.assetId !== undefined) referenced.add(page.reference.assetId)
        }
        await pruneAssets(referenced)
        replaceDocument(imported.doc) // resets history + selection, hydrates active page
        await loadFromStore() // rebuild object URLs from the new blobs
        setState({ kind: 'idle' })
      } catch (err) {
        setState({ kind: 'import-failed', message: messageFor(err) })
      }
    },
    [replaceDocument, loadFromStore],
  )

  const startImport = useCallback(
    async (file: File) => {
      if (runningRef.current) return
      runningRef.current = true
      setState({ kind: 'importing', message: '파일 검증 중…' })
      try {
        // Pass the File (a Blob) straight to JSZip — no arrayBuffer() needed.
        const imported = await readEventDocument(file)
        if (hasAnyBlocks(getDocument())) {
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
