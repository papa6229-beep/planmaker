/**
 * Application shell: the 3-column layout (palette · canvas · inspector) plus the
 * top toolbar (WORK_PLAN §6). Wires the editor context and the global keyboard
 * shortcuts for canvas editing (Phase 3): delete, duplicate, and undo/redo.
 * Shortcuts are suppressed while typing so text editing is never hijacked.
 */

import { useEffect, useState } from 'react'
import { BriefEditorProvider, useBriefEditor } from '../features/editor/useBriefEditor'
import { AssetsProvider, useAssets } from '../features/assets/useAssets'
import { BriefDocumentProvider } from '../features/document/useBriefDocument'
import { imageFilesFromClipboard } from '../features/assets/imageUtils'
import { isImageBlock } from '../domain/blockTypes'
import { EventBriefIoProvider, useEventBriefIo } from '../features/export/useEventBriefIo'
import { EventBriefIoDialogs } from '../features/export/EventBriefIoDialogs'
import { TopToolbar } from '../components/toolbar/TopToolbar'
import { PageTabs } from '../components/pages/PageTabs'
import { BlockPalette } from '../components/palette/BlockPalette'
import { BriefCanvas } from '../components/canvas/BriefCanvas'
import { PropertiesPanel } from '../components/inspector/PropertiesPanel'
import { SummaryPanel } from '../components/summary/SummaryPanel'

/** True when focus is in a text entry, so shortcuts must not fire. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function KeyboardShortcuts() {
  const { selectedIds, primaryId, deleteSelected, duplicateBlock, undo, redo } = useBriefEditor()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inText = isEditableTarget(e.target) || isEditableTarget(document.activeElement)
      const mod = e.metaKey || e.ctrlKey

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
  }, [selectedIds, primaryId, deleteSelected, duplicateBlock, undo, redo])

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

function Workspace() {
  const [summaryOpen, setSummaryOpen] = useState(false)
  return (
    <div className="app">
      <TopToolbar onShowSummary={() => setSummaryOpen(true)} />
      <main className="workspace">
        <BlockPalette />
        <div className="workspace__center">
          <PageTabs />
          <BriefCanvas />
        </div>
        <PropertiesPanel />
      </main>
      <KeyboardShortcuts />
      <GlobalPaste />
      <GlobalEventBriefDrop />
      <EventBriefIoDialogs />
      {summaryOpen && <SummaryPanel onClose={() => setSummaryOpen(false)} />}
    </div>
  )
}

export function AppShell() {
  return (
    <BriefEditorProvider>
      <AssetsProvider>
        <BriefDocumentProvider>
          <EventBriefIoProvider>
            <Workspace />
          </EventBriefIoProvider>
        </BriefDocumentProvider>
      </AssetsProvider>
    </BriefEditorProvider>
  )
}
