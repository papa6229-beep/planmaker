/**
 * Application shell: the 3-column layout (palette · canvas · inspector) plus the
 * top toolbar (WORK_PLAN §6). Wires the editor context and the global keyboard
 * shortcuts for canvas editing (Phase 3): delete, duplicate, and undo/redo.
 * Shortcuts are suppressed while typing so text editing is never hijacked.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { BriefEditorProvider, useBriefEditor } from '../features/editor/useBriefEditor'
import { CanvasViewProvider, useCanvasView } from '../features/editor/useCanvasView'
import { AssetsProvider, useAssets } from '../features/assets/useAssets'
import {
  BriefDocumentProvider,
  useBriefDocument,
  type DocumentBinding,
} from '../features/document/useBriefDocument'
import { imageFilesFromClipboard } from '../features/assets/imageUtils'
import { isImageBlock } from '../domain/blockTypes'
import { EventBriefIoProvider, useEventBriefIo } from '../features/export/useEventBriefIo'
import { EventBriefIoDialogs } from '../features/export/EventBriefIoDialogs'
import { TopToolbar } from '../components/toolbar/TopToolbar'
import { PageTabs } from '../components/pages/PageTabs'
import { BlockPalette } from '../components/palette/BlockPalette'
import { BriefCanvas } from '../components/canvas/BriefCanvas'
import { CanvasZoomControls } from '../components/canvas/CanvasZoomControls'
import { PropertiesPanel } from '../components/inspector/PropertiesPanel'
import { BriefLibrary } from '../components/library/BriefLibrary'
import { SummaryPanel } from '../components/summary/SummaryPanel'
import { ReferenceTools } from '../components/reference/ReferenceTools'
import { ReferenceViewControls } from '../components/reference/ReferenceViewControls'
import { ReferenceSideView } from '../components/reference/ReferenceSideView'
import { StartChoice } from '../components/start/StartChoice'
import { ConceptField } from '../components/concept/ConceptField'
import { DesignerNoteField } from '../components/concept/HandoffNotes'

/** True when focus is in a text entry, so shortcuts must not fire. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function KeyboardShortcuts() {
  const { selectedIds, primaryId, deleteSelected, duplicateBlock, undo, redo } = useBriefEditor()
  const { stepIn, stepOut, resetTo100 } = useCanvasView()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inText = isEditableTarget(e.target) || isEditableTarget(document.activeElement)
      const mod = e.metaKey || e.ctrlKey

      // Canvas zoom (view-only): Ctrl/⌘ with +/=/-/0. Requires a modifier, so it
      // never interferes with typing; overrides the browser's page zoom here.
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        stepIn()
        return
      }
      if (mod && e.key === '-') {
        e.preventDefault()
        stepOut()
        return
      }
      if (mod && e.key === '0') {
        e.preventDefault()
        resetTo100()
        return
      }

      // Undo / redo (suppressed in text fields so native text undo still works).
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (inText) return
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (inText) return
        e.preventDefault()
        redo()
        return
      }

      // Duplicate the primary block.
      if (mod && (e.key === 'd' || e.key === 'D')) {
        if (inText || primaryId === null) return
        e.preventDefault()
        duplicateBlock(primaryId)
        return
      }

      // Delete the current selection (never while typing — WORK_PLAN §6.6).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (inText || selectedIds.length === 0) return
        e.preventDefault()
        deleteSelected()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIds, primaryId, deleteSelected, duplicateBlock, undo, redo, stepIn, stepOut, resetTo100])

  return null
}

/** Global image paste (WORK_PLAN §11): Ctrl+V an image → assign or create. */
function GlobalPaste() {
  const { selected } = useBriefEditor()
  const { uploadFiles } = useAssets()

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFromClipboard(e.clipboardData?.items)
      if (files.length === 0) return // let normal text paste proceed
      e.preventDefault()
      const targetId = selected && isImageBlock(selected.type) ? selected.id : undefined
      void uploadFiles(files, targetId === undefined ? {} : { targetBlockId: targetId })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [selected, uploadFiles])

  return null
}

/** Global `.eventbrief` drop (WORK_PLAN §8) — distinct from image drops, which
 *  the canvas handles. Captured before the canvas so a brief never gets treated
 *  as an image. */
function GlobalEventBriefDrop() {
  const { startImport } = useEventBriefIo()

  useEffect(() => {
    const isBriefFile = (f: File) => f.name.toLowerCase().endsWith('.eventbrief')
    const onDragOver = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const file = Array.from(e.dataTransfer?.files ?? []).find(isBriefFile)
      if (!file) return // not a brief → let the canvas handle image drops
      e.preventDefault()
      e.stopPropagation()
      void startImport(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop, true) // capture: beat the canvas
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [startImport])

  return null
}

function Workspace({ mode, statusPanel }: { mode: 'brief' | 'image'; statusPanel?: ReactNode }) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [startDismissed, setStartDismissed] = useState(false)
  const { activeReference } = useBriefDocument()
  const { state } = useBriefEditor()
  const sideBySide = activeReference.viewMode === 'side' && activeReference.assetId !== undefined
  // Offer the first-start choice only on a genuinely untouched page — a document
  // already being worked on never sees it again.
  const showStart =
    !startDismissed && state.brief.blocks.length === 0 && activeReference.assetId === undefined
  return (
    <div className="app">
      <TopToolbar mode={mode} onShowSummary={() => setSummaryOpen(true)} />
      <main className="workspace">
        <div className="side-left">
          <ReferenceTools />
          <BlockPalette />
          <ConceptField />
          {/* 작성자가 디자인팀 작업자에게 남기는 부탁. 기획서의 일부라 파일을
              따라 함께 간다 (첫 사용 흐름 §6-1). */}
          <DesignerNoteField />
        </div>
        <div className="workspace__center">
          <PageTabs />
          {statusPanel}
          <div className="canvas-controls">
            <ReferenceViewControls />
            <CanvasZoomControls />
          </div>
          {showStart && <StartChoice onDismiss={() => setStartDismissed(true)} />}
          <div className="stage">
            <BriefCanvas />
            {sideBySide && <ReferenceSideView />}
          </div>
        </div>
        {/* 기획서 모드의 우측은 보관함; 이미지 작업 화면은 요청 편집이라 목록이 없다. */}
        {mode === 'brief' ? <BriefLibrary /> : <PropertiesPanel />}
      </main>
      <KeyboardShortcuts />
      <GlobalPaste />
      <GlobalEventBriefDrop />
      <EventBriefIoDialogs />
      {summaryOpen && <SummaryPanel onClose={() => setSummaryOpen(false)} />}
    </div>
  )
}

export interface AppShellProps {
  /** 'brief' = planning (전달하기); 'image' = design work on a request (§13.2). */
  mode?: 'brief' | 'image'
  /** Overrides document load/save (used by the request work page). */
  binding?: DocumentBinding
  /** Extra panel rendered under the page tabs (request status + generation). */
  statusPanel?: ReactNode
}

export function AppShell({ mode = 'brief', binding, statusPanel }: AppShellProps = {}) {
  return (
    <BriefEditorProvider>
      <AssetsProvider>
        <BriefDocumentProvider {...(binding ? { binding } : {})}>
          <EventBriefIoProvider>
            <CanvasViewProvider>
              <Workspace mode={mode} statusPanel={statusPanel} />
            </CanvasViewProvider>
          </EventBriefIoProvider>
        </BriefDocumentProvider>
      </AssetsProvider>
    </BriefEditorProvider>
  )
}
