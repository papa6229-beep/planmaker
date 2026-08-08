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
import { ResultZoomControls } from '../components/studio/ResultZoomControls'
import { ResultViewProvider } from '../features/studio/useResultView'
import { PropertiesPanel } from '../components/inspector/PropertiesPanel'
import { BriefLibrary } from '../components/library/BriefLibrary'
import { SummaryPanel } from '../components/summary/SummaryPanel'
import { ReferenceTools } from '../components/reference/ReferenceTools'
import { ReferenceViewControls } from '../components/reference/ReferenceViewControls'
import { StartChoice } from '../components/start/StartChoice'
import { ConceptField } from '../components/concept/ConceptField'
import { AiNoteField, DesignerNoteField } from '../components/concept/HandoffNotes'
import { GenerationRequestPreview } from '../components/studio/GenerationRequestPreview'
import { ReadyPanel } from '../components/studio/ReadyPanel'
import { BlockLayerTools } from '../components/studio/BlockLayerTools'
import { BackgroundTools } from '../components/studio/BackgroundTools'
import { StyleReferenceTools } from '../components/studio/StyleReferenceTools'
import { BackgroundDialog } from '../components/studio/BackgroundDialog'
import { CompositeEffectsPanel } from '../components/studio/CompositeEffectsPanel'
import { BlockOrderPanel } from '../components/studio/BlockOrderPanel'
import { ToneAdjustPanel } from '../components/studio/ToneAdjustPanel'
import { PaperTunePanel } from '../components/studio/PaperTunePanel'
import { BackgroundCompositeProvider } from '../features/studio/useBackgroundComposite'
import { StudioEffectsSync } from '../features/studio/StudioEffectsSync'
import { GenerateImageDialog } from '../components/studio/GenerateImageDialog'
import { ResultCompare } from '../components/studio/ResultCompare'
import { EditPanel } from '../components/studio/EditPanel'
import { ImageGenerationProvider, useImageGeneration } from '../features/studio/useImageGeneration'
import { InstructionRefineProvider } from '../features/studio/useInstructionRefine'

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
  // 이름이 곧 무엇을 보는지다. `AI 결과 비교`는 둘을 나란히 두던 시절의 이름이라,
  // 완성본이 가운데를 다 쓰는 지금은 화면을 잘못 설명한다 (완성본 모드 Patch).
  const tabs: { value: 'brief' | 'compare'; label: string }[] = [
    { value: 'brief', label: '기획서' },
    { value: 'compare', label: '완성본' },
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
  /**
   * 가운데가 완성본을 보여 주는가 (페이지 전환 Patch).
   *
   * `view`는 페이지마다가 아니라 화면 전체에 하나뿐이다. 그래서 1페이지를 만든
   * 뒤 2페이지로 넘어가면, 2페이지에는 결과가 없는데 화면은 여전히 완성본을
   * 가리켰다 — 탭은 결과가 있어야 나오므로 사라지고, 우측 도구도 전부 결과를
   * 요구하므로 비었다. 빈 화면 하나만 남는다.
   *
   * 결과가 없는 페이지에서 완성본을 보여 줄 것이 없다. 그때는 기획서로 돌아간다 —
   * 결과가 있는 페이지로 돌아오면 다시 완성본이다.
   */
  const compare = generation !== null && generation.view === 'compare' && generation.hasResult
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
          {/* 작업판의 왼쪽 첫 칸은 AI가 실제로 참고할 스타일 한 장이다. 배치를
              맞추려고 겹쳐 보던 레이아웃 참고 도구는 작업판에서 걷어냈다 —
              두 자료가 나란히 서 있으면 어느 쪽이 AI에게 가는지 흐려진다. */}
          {mode === 'studio' ? <StyleReferenceTools /> : <ReferenceTools />}
          {/* 배경은 결과에 남고 스타일 레퍼런스는 참고로만 간다. */}
          {mode === 'studio' && <BackgroundTools />}
          <BlockPalette />
          {/* 컨셉은 기획서를 쓰는 사람의 것이다. 작업판에서 그것을 다시 만지는
              입력창을 두면 작업자가 기획서를 고쳐 쓰게 된다 — 값 자체는 그대로
              문서에 남아 생성 요청에 실린다 (실작업 UI 마감 §2.1). */}
          {mode !== 'studio' && <ConceptField />}
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
            {/* 오버레이는 참고 이미지를 겹쳐 보는 조작이다. 작업판에는 그 자료가
                없으므로 조작도 두지 않는다. */}
            {mode !== 'studio' && <ReferenceViewControls />}
            {/* 완성본을 보는 동안 기획서 배율을 움직여 봐야 아무것도 달라지지
                않는다. 그래서 같은 자리에 완성본의 배율이 선다. */}
            {compare ? <ResultZoomControls /> : <CanvasZoomControls />}
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
        ) : mode === 'studio' ? (
          /* 작업판의 우측은 지금 할 일 하나만 말한다: 만들기 전에는 준비 상태,
             만든 뒤에는 부분수정. 블록 편집 도움말은 왼쪽 캔버스가 이미 하는
             말이라 여기서 되풀이하지 않는다 (실작업 UI 마감 §3).

             그리고 **지금 보고 있는 화면의 도구만** 둔다 (완성본 모드 Patch).
             여섯 벌을 한 줄에 쌓으면 절반은 그 화면에서 쓸 일이 없는 것들이고,
             쓸 것을 찾는 데 스크롤이 든다. 기획서 쪽 셋은 어차피 고른 블록이
             있어야 나오는데, 완성본을 보는 동안에는 기획서 캔버스가 접혀 있어
             고를 수가 없다 — 그때 남는 것은 지난 선택의 잔상뿐이다. */
          <div className={`side-right${compare ? ' side-right--result' : ''}`}>
            {/* 생성 방식을 고르는 자리는 없다 (한방 생성 Patch §1). 상단
                `이미지 생성하기` 하나가 메인 실행이고, 종이 컷아웃이 켜져
                있는지에 따라 흐름은 스스로 갈린다. */}
            {compare ? (
              <>
                <EditPanel />
                {/* 결과 전체의 톤 (톤 조절 Patch). */}
                <ToneAdjustPanel />
                {/* 완성된 배경 위에서 종이 테두리를 다듬는다 (완성 후 컷아웃 Patch). */}
                <PaperTunePanel />
              </>
            ) : (
              <>
                {/* 고른 블록의 배치 — 맞춤 방식과 레이어 순서 (§3.1, §4). */}
                <BlockLayerTools />
                {/* 생성 **전**에 이 블록에만 붙이는 주문 (블록별 주문 Patch). */}
                <BlockOrderPanel />
                <CompositeEffectsPanel />
                <ReadyPanel />
              </>
            )}
          </div>
        ) : (
          <div className="side-right">
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
      <BackgroundDialog />
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

/**
 * 편집기가 서 있는 자리 — 문서·자산·파일 입출력·보기·생성.
 *
 * 화면과 따로 떼어 둔 이유는, 상단바에서 진입점을 걷어낸 내부 화면(요약·제작
 * 요청 미리보기)도 여전히 이 자리 위에서 열리고 검사돼야 하기 때문이다. 코드를
 * 지우지 않았다는 말은 그 화면이 아직 동작한다는 뜻이어야 한다.
 */
export function AppShellProviders({
  binding,
  freePlacement = false,
  children,
}: {
  binding?: DocumentBinding
  /** 작업판만 참 — 캔버스 밖 배치를 허용한다 (배경 합성 1차 §3.2). */
  freePlacement?: boolean
  children: ReactNode
}) {
  return (
    <BriefEditorProvider freePlacement={freePlacement}>
      <AssetsProvider>
        <BriefDocumentProvider {...(binding ? { binding } : {})}>
          <EventBriefIoProvider>
            <CanvasViewProvider>
              <ResultViewProvider>
              {/* 작업판 밖에서는 이 provider 안의 훅이 전부 `null`을 내므로,
                  작성기 화면에는 생성 버튼도 결과 비교도 나타나지 않는다. */}
              <ImageGenerationProvider>
                {/* 다듬기는 생성 위에 얹힌다 — 지금 고른 대상과 그 결과를 알아야
                    하기 때문이다. 작업이 없으면 이 훅도 `null`을 낸다. */}
                {/* 배경 합성은 생성 위에 얹힌다 — 같은 페이지와 같은 작업을
                    보아야 하기 때문이다. 작업이 없으면 이 훅도 `null`을 낸다. */}
                <InstructionRefineProvider>
                  <BackgroundCompositeProvider>
                    {/* 블록에 매달린 작업판 설정을 복제·삭제와 맞춘다 (§4). */}
                    <StudioEffectsSync />
                    {children}
                  </BackgroundCompositeProvider>
                </InstructionRefineProvider>
              </ImageGenerationProvider>
              </ResultViewProvider>
            </CanvasViewProvider>
          </EventBriefIoProvider>
        </BriefDocumentProvider>
      </AssetsProvider>
    </BriefEditorProvider>
  )
}

export function AppShell({ mode = 'brief', binding, statusPanel }: AppShellProps = {}) {
  return (
    <AppShellProviders {...(binding ? { binding } : {})} freePlacement={mode === 'studio'}>
      <Workspace mode={mode} statusPanel={statusPanel} />
    </AppShellProviders>
  )
}
