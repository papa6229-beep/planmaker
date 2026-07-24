/**
 * Export / import orchestration for `.eventbrief` files (WORK_PLAN §6, §10).
 * Holds the small state machine that drives validation, warning confirmation,
 * progress, and the transactional import swap. No ZIP/canvas logic lives here —
 * that is in the services layer; this only sequences it and talks to the editor
 * and asset stores.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBriefEditor } from '../editor/useBriefEditor'
import { useAssets } from '../assets/useAssets'
import { getAllAssets, pruneAssets, replaceAssets, saveBrief } from '../../services/assetStore'
import { packageEventBrief } from '../../services/eventBriefExport'
import { readEventBrief, type ImportedBrief } from '../../services/eventBriefImport'
import { renderPreviewPng } from '../../services/previewRenderer'
import { EventBriefError } from '../../services/eventBriefArchive'
import { validateForExport, type ExportIssue } from './exportValidation'

export type IoState =
  | { kind: 'idle' }
  | { kind: 'export-blocked'; errors: ExportIssue[] }
  | { kind: 'export-warn'; warnings: ExportIssue[] }
  | { kind: 'exporting'; message: string }
  | { kind: 'export-failed'; message: string }
  | { kind: 'import-confirm'; pending: ImportedBrief }
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

export function EventBriefIoProvider({ children }: { children: ReactNode }) {
  const { state: editorState, hydrate } = useBriefEditor()
  const { loadFromStore } = useAssets()
  const [state, setState] = useState<IoState>({ kind: 'idle' })
  const runningRef = useRef(false)

  const briefRef = useRef(editorState.brief)
  briefRef.current = editorState.brief

  const dismiss = useCallback(() => setState({ kind: 'idle' }), [])

  const doExport = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setState({ kind: 'exporting', message: '내보내기 준비 중…' })
    try {
      const brief = briefRef.current
      // Flush the latest brief so nothing in the 3s autosave window is lost.
      await saveBrief(brief, Date.now())
      const stored = await getAllAssets()

      setState({ kind: 'exporting', message: '미리보기 생성 중…' })
      const blobMap = new Map(stored.map((a) => [a.id, a.blob]))
      const preview = await renderPreviewPng(brief, blobMap)

      setState({ kind: 'exporting', message: '패키징 중…' })
      const pkg = await packageEventBrief({
        brief,
        assets: stored,
        preview,
        createdAt: new Date().toISOString(),
      })
      triggerDownload(pkg.blob, pkg.fileName)
      setState({ kind: 'idle' })
    } catch (err) {
      setState({ kind: 'export-failed', message: messageFor(err) })
    } finally {
      runningRef.current = false
    }
  }, [])

  const startExport = useCallback(async () => {
    if (runningRef.current) return
    const brief = briefRef.current
    const stored = await getAllAssets()
    const availableIds = new Set(stored.map((a) => a.id))
    const result = validateForExport(brief, availableIds)
    if (result.errors.length > 0) {
      setState({ kind: 'export-blocked', errors: result.errors })
      return
    }
    if (result.warnings.length > 0) {
      setState({ kind: 'export-warn', warnings: result.warnings })
      return
    }
    await doExport()
  }, [doExport])

  const confirmExportWithWarnings = useCallback(async () => {
    await doExport()
  }, [doExport])

  const applyImport = useCallback(
    async (imported: ImportedBrief) => {
      setState({ kind: 'importing', message: '복원 중…' })
      try {
        // Transactional swap: persist first, then hydrate the UI.
        await saveBrief(imported.brief, Date.now())
        await replaceAssets(imported.assets)
        await pruneAssets(imported.brief.blocks.map((b) => b.assetId).filter((id): id is string => id !== undefined))
        hydrate(imported.brief) // resets history + selection
        await loadFromStore() // rebuild object URLs from the new blobs
        setState({ kind: 'idle' })
      } catch (err) {
        setState({ kind: 'import-failed', message: messageFor(err) })
      }
    },
    [hydrate, loadFromStore],
  )

  const startImport = useCallback(
    async (file: File) => {
      if (runningRef.current) return
      runningRef.current = true
      setState({ kind: 'importing', message: '파일 검증 중…' })
      try {
        // Pass the File (a Blob) straight to JSZip — no arrayBuffer() needed.
        const imported = await readEventBrief(file)
        const hasWork = briefRef.current.blocks.length > 0
        if (hasWork) {
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
    [applyImport],
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
