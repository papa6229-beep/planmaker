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
import { StartChoice } from '../components/start/StartChoice'
import { ConceptField } from '../components/concept/ConceptField'
import { AiNoteField, DesignerNoteField } from '../components/concept/HandoffNotes'
import { GenerationRequestPreview } from '../components/studio/GenerationRequestPreview'
import { GenerateImageDialog } from '../components/studio/GenerateImageDialog'
import { ResultCompare } from '../components/studio/ResultCompare'
import { EditPanel } from '../components/studio/EditPanel'
import { ImageGenerationProvider, useImageGeneration } from '../features/studio/useImageGeneration'

/** 기획서 작성 · 요청 작업 · 이미지 생성기 작업판. */
export type ShellMode = 'brief' | 'image' | 'studio'

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

/**
 * 중앙 패널이 무엇을 보여 줄지 — 기획서 작업이냐, 방금 만든 결과와의 비교냐.
 * 참고 이미지 보기 방식과는 다른 축이고, 상태도 다른 곳에 있다.
 */
function StudioViewTabs() {
  const generation = useImageGeneration()
  if (generation === null) return null
  const tabs: { value: 'brief' | 'compare'; label: string }[] = [
    { value: 'brief', label: '기획서 작업' },
    { value: 'compare', label: 'AI 결과 비교' },
  ]
  return (
    <div className="studio-view" role="radiogroup" aria-label="중앙 보기">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={generation.view === t.value}
          className={`studio-view__tab${generation.view === t.value ? ' is-active' : ''}`}
          onClick={() => generation.setView(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function Workspace({ mode, statusPanel }: { mode: ShellMode; statusPanel?: ReactNode }) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [startDismissed, setStartDismissed] = useState(false)
  const { activeReference } = useBriefDocument()
  const { state } = useBriefEditor()
  const generation = useImageGeneration()
  const compare = generation?.view === 'compare'
  // Offer the first-start choice only on a genuinely untouched page — a document
  // already being worked on never sees it again.
  const showStart =
    !startDismissed && state.brief.blocks.length === 0 && activeReference.assetId === undefined
  return (
    <div className="app">
      <TopToolbar
        mode={mode}
        onShowSummary={() => setSummaryOpen(true)}
        {...(mode === 'studio' ? { onShowGenerationRequest: () => setRequestOpen(true) } : {})}
      />
      <main className="workspace">
        <div className="side-left">
          <ReferenceTools />
          <BlockPalette />
          <ConceptField />
          {/* 작성기는 디자인팀에게 남길 말만, 작업판은 그 말을 읽고 AI 지시를
              따로 적는다 (첫 사용 흐름 §6). */}
          {mode === 'studio' ? <AiNoteField /> : <DesignerNoteField />}
        </div>
        <div className="workspace__center">
          <PageTabs />
          {statusPanel}
          {/* 작업판에서 결과가 생기면, 중앙이 무엇을 보여 줄지 고를 수 있다.
              결과가 없을 때는 고를 것이 없으므로 나타나지도 않는다. */}
          {generation !== null && generation.hasResult && <StudioViewTabs />}
          <div className="canvas-controls">
            <ReferenceViewControls />
            <CanvasZoomControls />
          </div>
          {showStart && !compare && <StartChoice onDismiss={() => setStartDismissed(true)} />}
          <div className="stage">
            {compare ? <ResultCompare /> : <BriefCanvas />}
          </div>
        </div>
        {/* 기획서 모드의 우측은 보관함; 작업판과 이미지 요청 화면은 공통 편집기의
            기본 패널을 그대로 쓴다. 제품 이미지는 이미지 블록에서 직접 넣으므로
            같은 정보를 받는 패널을 따로 두지 않는다 (첫 사용 흐름 §8). */}
        {mode === 'brief' ? (
          <BriefLibrary />
        ) : (
          <div className="side-right">
            {/* 결과가 있을 때만 나타난다 — 없으면 컴포넌트가 스스로 비운다. */}
            <EditPanel />
            <PropertiesPanel />
          </div>
        )}
      </main>
      <KeyboardShortcuts />
      <GlobalPaste />
      <GlobalEventBriefDrop />
      <EventBriefIoDialogs />
      {summaryOpen && <SummaryPanel onClose={() => setSummaryOpen(false)} />}
      {requestOpen && <GenerationRequestPreview onClose={() => setRequestOpen(false)} />}
      <GenerateImageDialog />
    </div>
  )
}

export interface AppShellProps {
  /**
   * 'brief' = planning (전달하기); 'image' = design work on a request (§13.2);
   * 'studio' = the image studio work surface (이미지 생성기 0단계 §4).
   */
  mode?: ShellMode
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
              {/* 작업판 밖에서는 이 provider 안의 훅이 전부 `null`을 내므로,
                  작성기 화면에는 생성 버튼도 결과 비교도 나타나지 않는다. */}
              <ImageGenerationProvider>
                <Workspace mode={mode} statusPanel={statusPanel} />
              </ImageGenerationProvider>
            </CanvasViewProvider>
          </EventBriefIoProvider>
        </BriefDocumentProvider>
      </AssetsProvider>
    </BriefEditorProvider>
  )
}
