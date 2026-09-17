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
import { ResultViewProvider, useResultView } from '../features/studio/useResultView'
import { PropertiesPanel } from '../components/inspector/PropertiesPanel'
import { BriefLibrary } from '../components/library/BriefLibrary'
import { SummaryPanel } from '../components/summary/SummaryPanel'
import { ReferenceTools } from '../components/reference/ReferenceTools'
import { ReferenceViewControls } from '../components/reference/ReferenceViewControls'
import { StartChoice } from '../components/start/StartChoice'
import { ConceptField } from '../components/concept/ConceptField'
import { AiNoteField, DesignerNoteField, TeamNoteField } from '../components/concept/HandoffNotes'
import { GenerationRequestPreview } from '../components/studio/GenerationRequestPreview'
import { ReadyPanel } from '../components/studio/ReadyPanel'
import { LiveTextSync } from '../features/studio/LiveTextSync'
import { DesignBar } from '../components/design/DesignBar'
import { BarMenuDock } from '../components/design/BarMenu'
import { AlignTools, ResultAlignTools } from '../components/studio/AlignTools'
import { BriefHandoff } from '../components/studio/BriefHandoff'
import { BlockLayerTools } from '../components/studio/BlockLayerTools'
import { BackgroundTools } from '../components/studio/BackgroundTools'
import { StyleReferenceTools } from '../components/studio/StyleReferenceTools'
import { BackgroundDialog } from '../components/studio/BackgroundDialog'
import { ToneAdjustPanel } from '../components/studio/ToneAdjustPanel'
import { BannerPanel } from '../components/studio/BannerPanel'
import { WorkList } from '../components/studio/WorkList'
import { BannerDrawer } from '../components/studio/BannerDrawer'
import { BackgroundCompositeProvider } from '../features/studio/useBackgroundComposite'
import { StudioEffectsSync } from '../features/studio/StudioEffectsSync'
import { GenerateImageDialog } from '../components/studio/GenerateImageDialog'
import { ResultCompare } from '../components/studio/ResultCompare'
import { EditPanel } from '../components/studio/EditPanel'
import { SHOW_PARTIAL_EDIT } from './studioScreen'
import { OriginalControls, OriginalSidePane } from '../components/studio/OriginalBrief'
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
  const { selectedIds, primaryId, deleteSelected, duplicateBlock, copySelected, pasteCopied, undo, redo } =
    useBriefEditor()
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

      // 복사 · 붙여넣기 (복사·붙여넣기 Patch).
      //
      // 글자를 치는 중에는 지나간다 — 브라우저의 글자 복사가 먼저다. 블록을
      // 복사하는 것과 글자를 복사하는 것은 다른 일이고, 여기서 가로채면 사람이
      // 방금 고른 문장을 복사하지 못한다.
      if (mod && (e.key === 'c' || e.key === 'C')) {
        if (inText || selectedIds.length === 0) return
        e.preventDefault()
        copySelected()
        return
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        if (inText) return
        // 붙일 것이 없으면 막지 않는다 — 브라우저가 할 일이 있을 수 있다.
        if (pasteCopied() > 0) e.preventDefault()
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
  }, [selectedIds, primaryId, deleteSelected, duplicateBlock, copySelected, pasteCopied, undo, redo, stepIn, stepOut, resetTo100])

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
  /**
   * 완성본을 보고 있으면 이 줄이 없다 (기획서 탭 감추기 Patch).
   *
   * 작업자의 말 — "이미 이미지 생성하기 해서 부분수정만 남은 단계라면 저걸 그냥
   * 눈에 보이지만 않게라도 해야지. 왜 눈에 보여야 하는지 모르겠고." 맞는 말이다.
   * 이미지를 만든 뒤에 오갈 곳은 완성본과 배너 둘뿐이고, 기획서 캔버스가 필요하면
   * 완성본 화면 안의 `작업 캔버스 나란히 보기`가 바로 옆에 세워 준다.
   *
   * 길을 없애지는 않았다. 기획서를 고쳐 다시 뽑는 일은 남아 있어야 하므로, 그
   * 문은 상단 `작업 메뉴`의 `기획서 보기`로 옮겼다. 늘 보이던 것이 가끔 찾는
   * 자리로 간 것뿐이다.
   */
  if (generation.view === 'compare') return null
  const tabs: { value: 'brief' | 'compare'; label: string }[] = [
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

/** 원본 기획서를 옆 화면과 같은 배율로 세운다. */
function OriginalSide({ compare }: { compare: boolean }) {
  const canvas = useCanvasView()
  const result = useResultView()
  return <OriginalSidePane zoom={compare ? (result?.zoom ?? 1) : canvas.zoom} />
}

const LEFT_FOLD_KEY = 'planmaker.studio.leftFolded'

function readLeftFolded(): boolean {
  try {
    return window.localStorage.getItem(LEFT_FOLD_KEY) === '1'
  } catch {
    return false
  }
}

function Workspace({ mode, statusPanel }: { mode: ShellMode; statusPanel?: ReactNode }) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [startDismissed, setStartDismissed] = useState(false)
  /**
   * 맨 왼쪽 칸(참고 그림·배경·팔레트·메모)을 접었는가 (우측 패널 정리, 2026-09-17).
   * 좁은 화면에서 나란히 보기의 두 장에 자리를 더 준다. 보는 사람마다의 편의라
   * 이 브라우저에만 기억한다.
   */
  const [leftFolded, setLeftFolded] = useState(() => readLeftFolded())
  /** 설정 창이 열릴 세로 칸의 자리. 그려진 뒤에야 생긴다. */
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null)
  const toggleLeft = () => {
    const next = !leftFolded
    setLeftFolded(next)
    try {
      window.localStorage.setItem(LEFT_FOLD_KEY, next ? '1' : '0')
    } catch {
      // 기억하지 못해도 지금 화면은 접힌다.
    }
  }
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
      <main
        className={
          mode === 'studio' ? `workspace workspace--studio${leftFolded ? ' is-left-folded' : ''}` : 'workspace'
        }
      >
        <div className="side-left">
          {/* 작업판의 왼쪽 첫 칸은 AI가 실제로 참고할 스타일 한 장이다. 배치를
              맞추려고 겹쳐 보던 레이아웃 참고 도구는 작업판에서 걷어냈다 —
              두 자료가 나란히 서 있으면 어느 쪽이 AI에게 가는지 흐려진다. */}
          {mode === 'studio' ? <StyleReferenceTools /> : <ReferenceTools />}
          {/* 배경은 결과에 남고 스타일 레퍼런스는 참고로만 간다. */}
          {mode === 'studio' && <BackgroundTools />}
          {/* 기획서에서 온 말은 **팔레트 위**에 선다 (전달 누락 Patch). 받은 말을
              읽는 것이 작업의 첫 걸음이고, 첫 걸음이 스크롤 아래에 있으면 없는
              것과 같다. 온 말이 없으면 칸도 없다. */}
          {mode === 'studio' && <BriefHandoff />}
          <BlockPalette />
          {/* 메모는 접어 둔다 (왼쪽 정리 Patch).
              앞선 판은 셋(컨셉·전달사항·팀 메모)이 모두 펼쳐진 채였고, 그 높이가
              **`무엇을 넣을까요?`를 화면 밖으로 밀어냈다** — 기획서를 쓰는 첫 걸음이
              스크롤해야 보이는 자리에 있었던 것이다. 메모는 가끔 적고, 블록은 늘
              놓는다. 늘 하는 일이 위에 있어야 한다.
              컨셉과 전달사항이 실은 같은 말이라는 것은 맞다. 다만 `concept`은
              입력창 하나가 아니라 저장·전달·덮어쓰기 확인이 함께 보는 제품 개념이라,
              합치는 일은 그 자리들을 옮기는 별도의 작업으로 둔다. */}
          {mode !== 'studio' && <ConceptField />}
          {mode === 'studio' ? <AiNoteField /> : <DesignerNoteField />}
          {mode !== 'studio' && <TeamNoteField />}
        </div>
        {mode === 'studio' ? (
          /* 작업판은 **세로 배치**다 (세로 배치 Patch, 2026-09-17). 사용자: "조작 패널도 왼쪽,
             작업 창과 캔버스도 세로형으로 길게." 캔버스 위에 쌓이던 가로 줄(페이지 탭·작업 목록·
             배율·도구 막대)을 캔버스 왼쪽 세로 칸에 모으고, 캔버스가 남은 높이를 모두 쓴다.
             조작 창도 이 칸 안에서 펼쳐져 캔버스를 가리지 않는다. */
          <div className="workspace__center workspace__center--studio">
            <aside className="studio-rail" aria-label="작업 도구">
              <button
                type="button"
                className="btn studio-rail__fold"
                aria-pressed={leftFolded}
                title={leftFolded ? '참고 그림·배경·블록 칸을 다시 엽니다' : '캔버스 자리를 넓힙니다'}
                onClick={toggleLeft}
              >
                {leftFolded ? '▶ 왼쪽 칸 펴기' : '◀ 왼쪽 칸 접기'}
              </button>
              <PageTabs />
              {/* 만든 것들의 목록 — 이벤트 페이지와 배너, 그리고 그 한 장의 저장. */}
              <WorkList />
              {statusPanel}
              {generation !== null && generation.hasResult && <StudioViewTabs />}
              {/* 받은 기획서를 옆에 세우거나 겹쳐 본다 (원본 기획서 보기 Patch). */}
              <OriginalControls />
              {/* 배율은 세로 칸에 — 위 막대를 옵션 한 줄에 온전히 주려고. */}
              <div className="canvas-controls">
                {compare ? <ResultZoomControls /> : <CanvasZoomControls />}
              </div>
              {/* 막대에서 누른 설정 창이 여기 열린다 (막대 한 줄 Patch) — 캔버스를 가리지 않게. */}
              <div className="design-dock" ref={setDockEl} aria-label="열린 설정" role="region" />
              {/* 옛 우측 패널의 도구들 (우측 패널 정리, 2026-09-17). 사용자: "쓸데없는 쪽이
                  우측패널이 되었어" — 우측을 걷어 캔버스 자리를 넓히고(나란히 보기에
                  두 장이 서야 한다), 남길 것만 이 칸 아래로 옮겼다.
                  **지금 보고 있는 화면의 도구만** 둔다 (완성본 모드 Patch). 기획서 쪽
                  셋은 고른 블록이 있어야 나오고, 완성본을 보는 동안에는 고를 수가 없다. */}
              <div className="studio-rail__more">
                {/* 배너 패널은 양쪽에 선다 (배너 Patch §5) — 만드는 도중 가운데가 잠깐
                    기획서로 돌아가도 방금 만든 배너의 안내가 사라지지 않게. */}
                <BannerPanel />
                {/* 배너에 없는 조각을 꺼내 놓는 서랍 (배너 Patch §6). 배너에서만 나온다. */}
                <BannerDrawer />
                {compare ? (
                  <>
                    {/* 만들고 나서 조각을 하나씩 끌어 맞추는 화면 (정렬 Patch). */}
                    <ResultAlignTools />
                    {/* AI 부분수정은 화면에서만 뺐다 — `studioScreen.ts`. */}
                    {SHOW_PARTIAL_EDIT && <EditPanel />}
                    {/* 결과 전체의 톤 (톤 조절 Patch). 조각 하나의 톤은 위 도구 막대에서. */}
                    <ToneAdjustPanel />
                  </>
                ) : (
                  <>
                    {/* 줄 맞춤은 상자의 종류를 가리지 않는다 (정렬 Patch). */}
                    <AlignTools />
                    {/* 고른 블록의 배치 — 맞춤 방식과 레이어 순서 (§3.1, §4). */}
                    <BlockLayerTools />
                    {/* 아무것도 고르지 않았을 때만 선다. */}
                    <ReadyPanel />
                  </>
                )}
              </div>
            </aside>
            <div className="studio-main">
              {/* 도구 막대는 캔버스 위에 **얇게 한 줄** (막대 한 줄 Patch, 2026-09-17). 사용자:
                  "블록 셋팅 탭은 아까처럼 얇게 위로 한줄로" — 세로 칸에서는 이것저것 섞여 보였다.
                  고른 것의 옵션이 한 줄에 서고(좁은 화면에서만 두 줄), 누른 창은 세로 칸의
                  `열린 설정`에 열린다. */}
              <div className="studio-topbar">
                <BarMenuDock.Provider value={dockEl}>
                  <DesignBar />
                </BarMenuDock.Provider>
              </div>
              {showStart && !compare && <StartChoice onDismiss={() => setStartDismissed(true)} />}
              <div className="stage">
                <OriginalSide compare={compare} />
                {compare ? <ResultCompare /> : <BriefCanvas />}
              </div>
            </div>
          </div>
        ) : (
        <div className="workspace__center">
          <PageTabs />
          {statusPanel}
          <div className="canvas-controls">
            {/* 오버레이는 참고 이미지를 겹쳐 보는 조작이다. 작업판에는 그 자료가
                없으므로 조작도 두지 않는다. */}
            <ReferenceViewControls />
            <CanvasZoomControls />
          </div>
          {showStart && <StartChoice onDismiss={() => setStartDismissed(true)} />}
          <div className="stage">
            <BriefCanvas />
          </div>
        </div>
        )}
        {/* 기획서 모드의 우측은 보관함; 작업판에는 우측이 없고, 이미지 요청 화면은
            공통 편집기의 기본 패널을 그대로 쓴다. 제품 이미지는 이미지 블록에서 직접 넣으므로
            같은 정보를 받는 패널을 따로 두지 않는다 (첫 사용 흐름 §8). */}
        {mode === 'brief' ? (
          <BriefLibrary />
        ) : mode === 'studio' ? null /* 작업판의 우측은 없다 — 도구는 왼쪽 세로 칸 아래로 옮겼다. */ : (
          <div className="side-right">
            <EditPanel />
            <PropertiesPanel />
          </div>
        )}
      </main>
      <KeyboardShortcuts />
      {/* 완성본의 문구를 지금 글꼴·색에 맞춰 다시 그린다 (살아 있는 문구 Patch). */}
      {mode === 'studio' && <LiveTextSync />}
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
