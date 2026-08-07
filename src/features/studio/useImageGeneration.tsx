/**
 * 실제 이미지 생성 한 번 (1단계 §3, §6, §12).
 *
 * 이 provider가 "생성하기"의 전부를 맡는다. 순서는 이렇다.
 *
 *   지금 화면의 문서 → `GenerationRequest` → 입력 이미지 순서 → 프롬프트 →
 *   요청 크기 → (사람이 확인) → 서버 함수 한 번 → 결과 저장 → 비교 화면
 *
 * 해석은 `buildGenerationRequest` 하나에서만 나온다. 사람이 `AI 제작 요청
 * 미리보기`에서 읽은 것과 모델이 받는 것이 같아야 하기 때문이다.
 *
 * 원본 보존 흐름은 이 길을 두 번 지난다 — 배경 한 번, 문구·버튼 스티커판 한 번.
 * 사이에 사용자가 배치한 이미지와 컷아웃을 브라우저가 원본 그대로 끼워 넣고, 그
 * 합쳐진 그림에서 문구 자리마다 색을 재 둔다 (스티커판 Patch §1~§3). 그 합성
 * 페이지는 요청에 실리지 않는다 — 나가는 것은 거기서 뽑은 숫자뿐이다. 버튼은
 * 그대로 하나이고, 나가는 횟수는 확인창이 미리 말한다.
 *
 * 돈이 드는 일이라 두 가지를 특히 지킨다.
 *
 *  - **누른 만큼만 나간다.** 요청이 나가 있는 동안 버튼은 잠기고, 실패해도 스스로
 *    다시 부르지 않는다. 다시 부르는 것은 언제나 사람의 클릭이다.
 *  - **실패는 아무것도 잃지 않는다.** 저장은 성공한 뒤에만 일어나므로, 실패한
 *    호출은 기획서도 이전 결과도 건드리지 못한다.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { cursorOf, pageResultOf, revisionsOf } from '../../domain/studioJob'
import { clearApiKey, readApiKey, saveApiKey } from './apiKeySession'
import { buildGenerationRequest } from '../../domain/generationRequest'
import { buildEditTargets, selectedProductAssetIds, selectedTargets, type EditTarget } from '../../domain/editTargets'
import { buildEditPrompt } from '../../domain/editPrompt'
import { planGenerationInputs, MAX_INPUT_IMAGES, type GenerationInputImage } from '../../domain/imageGenerationInputs'
import { buildOpenAIImagePrompt } from '../../domain/imagePrompt'
import {
  buildPlatePrompt,
  buildTextLayerPrompt,
  planPlateInputs,
  planTextLayerInputs,
  type FixedObject,
  type FixedTone,
  type PlateInput,
  type PreserveTextEntry,
} from '../../domain/preserveDesign'
import {
  containRect,
  planLines,
  rectsOverlap,
  textLayerCanvas,
  type TextLayerBlock,
  type TextLayerTone,
} from '../../domain/textLayers'
import { removeKeyBackground } from '../../services/textLayerKey'
import { trimToContent } from '../../services/trimToContent'
import { analyzeRegions } from '../../services/regionTone'
import { analyzeImageBlob } from '../../services/imageAnalysisRunner'
import type { StudioTextObject } from '../../domain/textObjects'
import { planLocalComposite } from '../../domain/composite'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { drawsBareText, isPairedLinkUrl, textAlignOf } from '../../domain/simpleBlocks'
import { resolveGptImageSize } from '../../domain/gptImageSize'
import { documentFingerprint } from '../../domain/documentFingerprint'
import { pageAsEventBrief } from '../../domain/briefMigration'
import {
  API_KEY_HEADER,
  errorTextFor,
  httpFailureCode,
  FIELD_IMAGES,
  FIELD_PROMPT,
  FIELD_SIZE,
  GENERATE_IMAGE_PATH,
  IMAGE_CALLS_PER_CLICK,
  IMAGE_MODEL,
  IMAGE_QUALITY,
  type GeneratedPageResult,
  type ImageRevision,
} from '../../domain/imageGeneration'
import { getAllAssets, getAsset, putAsset } from '../../services/assetStore'
import { sizeLabel, toWorkingImage, workingImageTarget, type WorkingImageTarget } from '../../services/workingImage'
import { renderPreviewPng } from '../../services/previewRenderer'
import { renderComposite } from '../../services/compositeRenderer'
import { shrinkReference } from '../../services/referenceUpload'
import { collectCompositeSources } from '../../services/compositeSources'
import { createId } from '../../domain/factory'
import type { BriefPage } from '../../domain/pageSchema'
import type { LayoutRect } from '../../domain/imageLayout'
import type { ToneAdjust } from '../../domain/toneAdjust'
import { buildTextEditPrompt, planTextEditInputs } from '../../domain/preserveDesign'

/** 중앙 패널이 무엇을 보여 주는가. 참고 이미지 보기와는 아무 관계가 없다. */
export type StudioCenterView = 'brief' | 'compare'

/**
 * 이 생성이 어느 길로 가는가 (한방 생성 Patch §1).
 *
 * 작업자는 고르지 않는다. 종이 컷아웃이 하나라도 켜져 있으면 `preserve`이고,
 * 없으면 지금까지의 `full_ai`다 — 화면에 방식 선택이 없는 것은 그래서다.
 */
export type GenerationMode = 'full_ai' | 'preserve'

interface GenerationPlan {
  /** 처음부터 만드는 것인가, 이미 있는 결과를 고치는 것인가. */
  kind: 'generate' | 'edit'
  mode: GenerationMode
  /**
   * `preserve`에서 브라우저가 원본 그대로 얹을 블록들 — **일반 이미지와 컷아웃
   * 전부**. 좌표·크기·비율·레이어 순서는 생성 전 값 그대로다.
   */
  fixedBlockIds: string[]
  pageId: string
  prompt: string
  /** 모델에게 요청하는 크기 (16의 배수). */
  size: string
  /** Studio가 쓰는 크기 — `840 × 페이지 세로길이`. 모델에게 보내지 않는다. */
  working: WorkingImageTarget
  inputs: GenerationInputImage[]
  fingerprint: string
  /**
   * `preserve`의 두 번째 겹 — 문구·버튼 **블록마다 한 장** (블록별 문구 Patch).
   *
   * 프롬프트를 여기서 미리 짓지 않는 이유는, 그 주문이 실제로 만들어진 배경과
   * 그 위 자리별 색을 인용하기 때문이다. 둘 다 첫 번째 그림을 받은 뒤에야
   * 손에 들어온다.
   */
  /**
   * 배경 주문의 재료 (배경 색맞춤 Patch).
   *
   * 프롬프트를 계획에서 굳히지 않는 이유는, 그 주문이 **그 자리에 놓일 사진의
   * 색**을 인용하기 때문이다. 색은 자산을 읽어야 나오고 그것은 비동기다.
   */
  plate?: PlateInput
  textBlocks?: TextLayerBlock[]
  /** 블록 id → 그 문구를 주문할 판 크기. 블록과 같은 모양이다 (2차 Patch). */
  textSizes?: Record<string, string>
  /** 블록 id → 그 블록에만 붙는 주문과 참고 그림 (블록별 주문 Patch). */
  blockOrders?: Record<string, { note?: string; referenceAssetId?: string }>
  /**
   * 문구 오브젝트 하나만 다시 디자인하는 길 (텍스트 오브젝트 Patch §3).
   *
   * 이 값이 있으면 통이미지를 다시 그리지 않는다. 나가는 것은 그 문구의 지금
   * 디자인 한 장이고, 돌아온 그림은 같은 자리에 갈아 끼워진다.
   */
  textEdits?: {
    blockId: string
    assetId: string
    rect: LayoutRect
    content: string
    instruction: string
    size: string
    /** 기획서 화면이 이 문구를 끊는 줄. 고쳐도 줄 수는 그대로다. */
    lines: readonly string[]
    /** 이 블록에 붙여 둔 주문·참고 그림 (부분수정 재료 Patch). */
    blockNote?: string
    referenceAssetId?: string
  }[]
  /**
   * 부분수정 요청이 함께 볼 것 (부분수정 재료 Patch).
   *
   * 첫 생성이 보는 것과 같다 — 페이지 크기, 스타일 레퍼런스, 실제로 깔려 있는
   * 배경, 사진이 이미 놓인 자리. 이 값이 없으면 예전처럼 지금 그림 한 장만 간다.
   */
  textEditContext?: {
    pageSize: { width: number; height: number }
    styleReferenceAssetId?: string
    backgroundAssetId?: string
    fixed: readonly { rect: LayoutRect }[]
  }
  /** 이 계획이 외부로 나가는 횟수. 확인창이 이 값을 그대로 말한다. */
  calls: number
}

export type GenerationState =
  | { kind: 'idle' }
  /** 사람이 무엇에 얼마를 쓰는지 보고 누르는 자리. */
  | { kind: 'confirm'; plan: GenerationPlan; needsKey: boolean }
  /** 부분수정 확인창 — 대상과 지시를 사람이 한 번 더 읽는 자리. */
  | { kind: 'edit-confirm'; plan: GenerationPlan; items: { target: EditTarget; instruction: string }[] }
  | { kind: 'running' }
  | { kind: 'failed'; message: string }
  /** 호출하기 전에 멈춘 것 — 아직 아무것도 쓰지 않았다. */
  | { kind: 'blocked'; message: string }
  /**
   * 생성은 됐고 작업본 변환만 실패했다. 이미 결제된 그림은 손에 있으므로 버리지
   * 않는다 — 여기서는 같은 원본으로 다시 맞추기만 하면 되고, 모델을 다시 부르지
   * 않는다 (마감 교정 §3).
   */
  | { kind: 'convert-failed'; message: string }

export interface ImageGenerationApi {
  state: GenerationState
  /** 이 페이지에 결과가 있는가 — 버튼 문구가 이 값으로 바뀐다. */
  hasResult: boolean
  /**
   * 이 탭에 테스트용 키가 들어 있는가 (마감 교정 §2).
   *
   * 화면에 나가는 것은 이 **참·거짓 하나뿐**이다. 키 문자열도, 길이도, 끝자리도
   * 여기서 나가지 않는다. 키를 넣는 곳이 둘(생성 확인창, 키 관리창)이라 상태를
   * 각자 들고 있으면 한쪽에서 저장한 것을 다른 쪽이 모른다 — 그래서 여기 하나에
   * 둔다.
   */
  hasKey: boolean
  saveKey: (key: string) => void
  clearKey: () => void
  view: StudioCenterView
  setView: (view: StudioCenterView) => void
  /** 생성 버튼. 막을 이유가 있으면 호출하지 않고 이유를 말한다. */
  begin: () => void
  /** 확인 창의 실행. 키를 이제 입력했다면 함께 넘긴다. */
  confirm: (key?: string) => void
  /** 이미 받아 둔 원본으로 작업본만 다시 만든다. 외부 호출 0건. */
  retryConversion: () => void
  /** 문구를 옮기거나 크기를 바꾼 뒤 결과를 다시 합친다. 외부 호출 0건. */
  recomposePage: (pageId: string) => Promise<void>
  /**
   * 재료에서 완성본을 되살린다 (다시 합치기 Patch). **외부 호출 0건.**
   *
   * 작업 파일에는 배경과 조각이 담기고 합쳐진 완성본은 담기지 않는다. 그래서
   * 파일을 열면 재료는 있고 완성본만 없다 — 그때 이것을 부르면 돌아온다.
   */
  rebuildPage: (pageId: string) => Promise<void>
  /** 지금 페이지에 되살릴 재료가 있는가 — 배경이 있고 완성본이 없을 때다. */
  canRebuild: boolean
  dismiss: () => void

  // ── 부분수정 (부분수정 1단계) ──────────────────────────────────────────────
  /** 이 결과를 만들 때 얼려 둔 대상 목록. 결과가 없으면 빈 배열. */
  editTargets: EditTarget[]
  selectedTargetIds: string[]
  toggleTarget: (targetId: string) => void
  /** 대상마다 따로 적는다. 하나의 문장을 여럿에게 나눠 쓰지 않는다. */
  instructionFor: (targetId: string) => string
  setInstructionFor: (targetId: string, text: string) => void
  /** 대상·지시(전부)·키·현재 결과가 모두 있어야 참. */
  canEdit: boolean
  /** 실행할 수 없는 이유 — 없으면 `null`. */
  editBlockedReason: string | null
  beginEdit: () => void
  confirmEdit: () => void

  /** 결과의 줄 — 앞뒤 이동은 전부 외부 호출 0건. */
  revisionCount: number
  revisionPosition: number
  canGoPrevious: boolean
  canGoNext: boolean
  goPrevious: () => void
  goNext: () => void
  goOriginal: () => void
}

const ImageGenerationContext = createContext<ImageGenerationApi | null>(null)

/**
 * 단색을 걷어 낸 뒤에도 이 이상 불투명하면 얹지 않는다.
 *
 * 걷어 낼 단색이 없었다는 뜻이고, 그대로 얹으면 배경도 사진도 전부 덮인다 —
 * 문구를 얻으려다 나머지를 다 잃는다. 그래서 얹기 전에 알파를 재고, 덮을
 * 그림이면 얹지 않고 그 사실을 말한다.
 */
const FOREGROUND_MAX_OPAQUE = 0.92

/** base64 → 이미지 한 장. 이 문자열은 여기서 끝나고 어디에도 저장되지 않는다. */
function blobFromBase64(b64: string, mimeType: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

/**
 * 이 페이지를 두 뭉치로 가른다 (한방 생성 Patch 2 §1, §2).
 *
 * **고정 오브젝트**는 모든 이미지 블록과 종이 컷아웃이다 — 둘을 가르지 않는다.
 * 앞선 판은 컷아웃만 지키고 일반 이미지는 모델에게 맡겼는데, 맡긴 쪽이 이동하고
 * 확대되고 다시 그려졌다. 지키는 규칙이 하나면 어기는 자리도 없다.
 *
 * **문구**는 원문 그대로 넘기되 좌표는 힌트로 넘긴다. 최종 결과에서 문구는
 * 언제나 이미지보다 앞이다.
 *
 * 앞뒤 순서는 블록 차례 그대로다 — 화면에서 뒤에 오는 블록이 앞에 그려지므로,
 * 번호가 클수록 앞이라는 말과 같은 뜻이 된다.
 */
function preserveParts(
  page: BriefPage,
  productImages: Readonly<Record<string, string>>,
  isCutout: (blockId: string) => boolean,
): { texts: PreserveTextEntry[]; fixed: FixedObject[] } {
  const texts: PreserveTextEntry[] = []
  const fixed: FixedObject[] = []

  page.blocks.forEach((block, layer) => {
    // 퍼블리싱 주소는 디자인이 아니다 — 합성 계획과 같은 규칙으로 뺀다.
    if (isPairedLinkUrl(page.blocks, block)) return
    const meta = getBlockTypeMeta(block.type)
    const rect = { ...block.position }

    if (meta.requiresAsset) {
      const assetId = productImages[block.id] ?? block.assetId
      if (assetId === undefined) return
      fixed.push({ blockId: block.id, assetId, rect, layer, cutout: isCutout(block.id) })
      return
    }

    const content = block.content ?? ''
    if (!meta.hasText || content.trim().length === 0) return
    texts.push({
      blockId: block.id,
      content,
      rect,
      align: textAlignOf(block),
      layer,
      // 버튼은 배경판·테두리까지 한 오브젝트다 — 그리는 주문이 달라진다.
      kind: block.type === 'cta_button' ? 'button' : 'text',
      // 겹침은 여기서 정해진다. 뒤에서 채운다 — 이미지 목록이 다 모인 뒤라야
      // 판정이 참이다.
      overlapsImage: false,
      // 화면이 이 문구를 몇 줄로 끊는가. 합성이 쓰는 그 계산 그대로다.
      lines: planLines(content, rect, drawsBareText(block)),
    })
  })

  for (const text of texts) {
    text.overlapsImage = fixed.some((item) => rectsOverlap(text.rect, item.rect))
  }

  return { texts, fixed }
}

export function ImageGenerationProvider({ children }: { children: ReactNode }) {
  const { getDocument } = useBriefDocument()
  const studio = useStudioJob()
  const [state, setState] = useState<GenerationState>({ kind: 'idle' })
  const [view, setView] = useState<StudioCenterView>('brief')
  /** 키가 있느냐만 담는다. 값 자체는 이 state에 들어오지 않는다. */
  const [hasKey, setHasKey] = useState(() => readApiKey() !== null)
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([])
  /** 대상 키 → 그 대상에만 적용할 지시. 표시 번호가 아니라 키로 담는다. */
  const [instructions, setInstructions] = useState<Record<string, string>>({})
  /** 요청이 나가 있는 동안은 한 번도 더 나가지 않는다. */
  const runningRef = useRef(false)
  /** 다시 합치기의 차례표. 늦게 끝난 예전 합성이 최신 결과를 덮지 않게 한다. */
  const recomposeRef = useRef(0)

  const doc = studio === null ? null : getDocument()
  const activePageId = doc?.activePageId ?? ''
  const hasResult = studio !== null && (studio.job.results?.[activePageId] ?? null) !== null
  /**
   * 되살릴 재료가 있는가 (다시 합치기 Patch).
   *
   * 배경이 있는데 완성본이 없는 자리 — 작업 파일을 열었을 때가 정확히 그 모습이다.
   */
  const canRebuild =
    studio !== null && !hasResult && studio.job.backgrounds?.[activePageId] !== undefined

  /** 지금 화면에서 무엇을 보낼지 계산한다. 막을 이유가 있으면 그것을 돌려준다. */
  const planNow = useCallback((): { plan: GenerationPlan } | { blocked: string } => {
    if (studio === null) return { blocked: errorTextFor('unknown') }
    const current = getDocument()
    const page = current.pages.find((p) => p.id === current.activePageId) ?? current.pages[0]!
    const request = buildGenerationRequest(current, studio.job, page.id)

    const missing = request.design.missingProductImages.length
    if (missing > 0) {
      return { blocked: `실제 제품 이미지가 연결되지 않은 자리가 ${missing}개 있습니다.` }
    }

    const size = resolveGptImageSize(page.canvasWidth, page.canvasHeight)
    if (!size.ok) return { blocked: size.message }
    const working = workingImageTarget(page.canvasHeight)
    const fingerprint = documentFingerprint(current)

    // ── 갈림길 (§1). 작업자는 고르지 않는다 ─────────────────────────────────
    const parts = preserveParts(page, studio.job.productImages, (id) => studio.effectsOf(id).paperCutout)

    if (parts.fixed.some((f) => f.cutout)) {
      const styleRefId = studio.styleReferenceOf(page.id)
      const note = current.project.aiNote?.trim() ?? ''
      const pageSize = { width: page.canvasWidth, height: page.canvasHeight }
      const shared = {
        size: pageSize,
        ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
        fixed: parts.fixed,
        ...(note.length === 0 ? {} : { note }),
      }
      const plate: PlateInput = {
        ...shared,
        ...(studio.keepReferenceBackgroundOf(page.id) ? { keepReferenceBackground: true } : {}),
      }
      // 문구·버튼은 **블록마다 한 장**이다 (블록별 문구 Patch). 한 장을 받아
      // 나중에 가르는 자리가 아예 없으므로, 두 문구가 섞이거나 한 문구가
      // 쪼개질 길이 없다.
      const textBlocks: TextLayerBlock[] = parts.texts.map((text) => ({
        blockId: text.blockId,
        content: text.content,
        kind: text.kind,
        rect: text.rect,
        align: text.align,
        layer: text.layer,
        overlapsImage: text.overlapsImage,
        // 화면이 실제로 끊는 그 줄. 모델에게 그대로 지키라고 보낸다.
        lines: text.lines,
      }))
      // 블록마다 붙여 둔 주문과 참고 그림 (블록별 주문 Patch).
      const blockOrders = Object.fromEntries(
        textBlocks.map((block) => [block.blockId, studio.blockOrderOf(block.blockId)]),
      )
      // 문구마다 **블록과 같은 모양의 판**을 요청한다. 세로로 긴 페이지 판을
      // 그대로 쓰면 한 줄짜리 문구가 여러 줄로 쌓여 돌아온다 (2차 Patch).
      const textSizes: Record<string, string> = {}
      for (const block of textBlocks) {
        const canvas = textLayerCanvas(block.rect)
        const resolved = resolveGptImageSize(canvas.width, canvas.height)
        textSizes[block.blockId] = resolved.ok ? resolved.size : size.size
      }

      // 사용자 이미지는 어느 목록에도 들어갈 길이 없다 — 스타일 레퍼런스와, 이
      // 도구가 다음 단계에서 직접 받아 올 배경뿐이다.
      const plateInputs = planPlateInputs(plate)
      const textInputs = planTextLayerInputs({
        ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
        backgroundAssetId: 'pending',
      })
      if (plateInputs.length > MAX_INPUT_IMAGES || textInputs.length > MAX_INPUT_IMAGES) {
        return { blocked: errorTextFor('too_many_inputs') }
      }
      return {
        plan: {
          kind: 'generate',
          mode: 'preserve',
          fixedBlockIds: parts.fixed.map((f) => f.blockId),
          pageId: page.id,
          prompt: buildPlatePrompt(plate),
          size: size.size,
          working,
          inputs: plateInputs,
          fingerprint,
          plate,
          ...(textBlocks.length === 0 ? {} : { textBlocks, textSizes, blockOrders }),
          // 배경 한 번 + 문구·버튼 하나당 한 번. 확인창이 이 수를 그대로 말한다.
          calls: 1 + textBlocks.length,
        },
      }
    }

    const inputs = planGenerationInputs(request)
    if (inputs.length > MAX_INPUT_IMAGES) {
      return { blocked: errorTextFor('too_many_inputs') }
    }

    return {
      plan: {
        kind: 'generate',
        mode: 'full_ai',
        fixedBlockIds: [],
        pageId: page.id,
        prompt: buildOpenAIImagePrompt(request, inputs),
        size: size.size,
        working,
        inputs,
        fingerprint,
        calls: 1,
      },
    }
  }, [getDocument, studio])

  const begin = useCallback(() => {
    if (runningRef.current) return
    const result = planNow()
    if ('blocked' in result) {
      setState({ kind: 'blocked', message: result.blocked })
      return
    }
    setState({ kind: 'confirm', plan: result.plan, needsKey: readApiKey() === null })
  }, [planNow])

  /**
   * 보낼 이미지들을 실제 바이너리로 모은다. 순서는 넘긴 목록 그대로.
   *
   * `preserve`는 두 번 나가고 두 번 다 같은 목록 모양을 쓰므로, 무엇을 보낼지는
   * 인자로 받는다 — 계획에서 꺼내 쓰면 두 번째 요청이 첫 번째의 목록을 보낸다.
   */
  /**
   * 이 그림을 원본 그대로 보낼 것인가, 줄여 보낼 것인가 (부분수정 실패 Patch).
   *
   * 참고용(`page_reference`)만 줄인다 — 스타일 레퍼런스, 만들어진 배경, 블록 참고
   * 그림이다. 이것들은 색과 짜임새를 읽으라고 보내는 자료이고, 작업자가 올린
   * 원본은 크기 제한 없이 저장되므로 웹에서 받은 큰 사진이 그대로 실린다.
   *
   * 제품 원본과 고칠 통이미지(`product_image`, `page_layout`)는 손대지 않는다.
   * 그쪽은 **다시 그려져 나와야 하는 그림**이라, 줄이면 결과가 나빠진다.
   */
  const sized = useCallback(
    async (input: GenerationInputImage, blob: Blob): Promise<Blob> =>
      input.role === 'page_reference' ? await shrinkReference(blob) : blob,
    [],
  )

  const collectImages = useCallback(
    async (
      plan: GenerationPlan,
      inputs: readonly GenerationInputImage[] = plan.inputs,
    ): Promise<{ fileName: string; blob: Blob }[]> => {
      const current = getDocument()
      const page = current.pages.find((p) => p.id === plan.pageId) ?? current.pages[0]!
      const stored = await getAllAssets()
      const byId = new Map(stored.map((a) => [a.id, a]))

      const files: { fileName: string; blob: Blob }[] = []
      if (plan.kind === 'edit') {
        // 편집은 지금 이미지를 다시 보내는 일이다. 모델은 지난 호출을 기억하지
        // 않으므로, 고칠 대상과 지켜야 할 것을 매번 이 그림과 함께 보낸다.
        //
        // **넘겨받은 목록을 쓴다** (부분수정 재료 Patch). 앞선 판은 여기서만
        // `plan.inputs`를 읽었는데, 문구 하나씩 고치는 길은 요청마다 목록이 달라
        // 계획에 담을 수가 없다 — 그 길의 `plan.inputs`는 빈 배열이었고, 그래서
        // 고치는 요청은 그림을 **한 장도** 보내지 않은 채 나갔다.
        for (const input of inputs) {
          const asset = input.assetId === undefined ? undefined : await getAsset(input.assetId)
          if (asset === undefined) continue
          // 이름이 곧 역할이다 — 서버 로그와 검사에서 무엇을 보냈는지 읽힌다.
          const name = input.fileName ?? `${input.role}-${input.assetId ?? ''}.png`
          files.push({ fileName: `${String(input.index)}-${name}`, blob: await sized(input, asset.blob) })
        }
        return files
      }
      if (plan.mode === 'preserve') {
        // 배치도를 만들지 않는다. 배치도에는 사용자의 그림이 이미 그려져 있어서,
        // 보내는 순간 "원본은 보내지 않는다"가 거짓이 된다 (§1).
        //
        // 파일명도 우리가 정한 것뿐이다 — 작업자가 올린 원본 파일명은 나가지
        // 않는다.
        for (const input of inputs) {
          const asset = input.assetId === undefined ? undefined : byId.get(input.assetId)
          if (asset === undefined) continue
          files.push({
            fileName: `${String(input.index)}-${input.fileName ?? `${input.role}.png`}`,
            blob: await sized(input, asset.blob),
          })
        }
        return files
      }
      for (const input of plan.inputs) {
        if (input.role === 'page_layout') {
          // 편집 핸들도 선택 테두리도 없는, 파일 저장에 쓰는 바로 그 그림이다.
          const blobs = new Map(stored.map((a) => [a.id, a.blob]))
          files.push({
            fileName: `${String(input.index)}-page-layout.png`,
            blob: await renderPreviewPng(pageAsEventBrief(current, page), blobs),
          })
          continue
        }
        const asset = input.assetId === undefined ? undefined : byId.get(input.assetId)
        if (asset === undefined) continue
        files.push({ fileName: `${String(input.index)}-${input.role}.png`, blob: asset.blob })
      }
      return files
    },
    [getDocument, sized],
  )

  /**
   * 이미 값을 치른 모델 원본. 작업본 변환이 실패하면 여기 남아 있고, 다시
   * 만들기는 이것만 다시 쓴다 — 그래서 재시도에 외부 호출이 0건이다.
   */
  const paidRef = useRef<{
    plan: GenerationPlan
    blob: Blob
    mimeType: string
    requestedSize: string
    requestId?: string
    /** `preserve`에서 저장해 둔 배경 플레이트. 다시 만들 때 재사용한다. */
    plateAssetId?: string
    /** 칸에서 잘라 낸 문구·버튼 오브젝트 (스티커판 Patch §5). */
    textObjects?: StudioTextObject[]
    /** 스티커판을 만들지 못했거나 쓸 수 없었던 이유. 없으면 정상이다. */
    foregroundProblem?: string
  } | null>(null)

  /**
   * 배경을 자산으로 남기고 이 페이지의 배경으로 삼는다 (스티커판 Patch §1).
   *
   * 두 번째 요청에 붙일 그림이 바로 이것이고, 나중에 문구 하나만 갈아 끼우고 다시
   * 합칠 때도 이 그림이 필요하다 — 결과 안에 섞여 버린 뒤에는 꺼낼 수 없다.
   *
   * 실패하면 `undefined`. 배경 없이도 주문은 성립하고, 저장은 `finishFromPaid`가
   * 다시 시도한다.
   */
  const storePlate = useCallback(
    async (
      plan: GenerationPlan,
      first: { blob: Blob; mimeType: string; requestedSize: string },
    ): Promise<string | undefined> => {
      if (studio === null) return undefined
      try {
        const working = await toWorkingImage(first.blob, plan.working)
        const plateAssetId = createId('asset')
        await putAsset({
          id: plateAssetId,
          blob: working.blob,
          fileName: `plate-${plan.pageId}.png`,
          mimeType: first.mimeType,
          byteSize: working.blob.size,
        })
        await studio.setBackground(plan.pageId, {
          assetId: plateAssetId,
          source: 'ai',
          requestedSize: first.requestedSize,
        })
        if (paidRef.current !== null) paidRef.current = { ...paidRef.current, plateAssetId }
        return plateAssetId
      } catch {
        return undefined
      }
    },
    [studio],
  )

  /**
   * 배경 위에 고정 오브젝트를 얹어 두고, 문구 자리마다 색을 잰다 (§2, §3).
   *
   * 외부 호출은 0건이다. 그리고 여기서 만든 **합성 페이지는 요청에 실리지 않는다** —
   * 나가는 것은 이 함수가 돌려주는 숫자뿐이다.
   */
  const measureRegions = useCallback(
    async (plan: GenerationPlan, plateAssetId: string | undefined): Promise<(TextLayerTone | null)[]> => {
      const blocks = plan.textBlocks ?? []
      const empty = blocks.map(() => null)
      if (studio === null || plateAssetId === undefined || blocks.length === 0) return empty
      try {
        const brief = getDocument()
        const page = brief.pages.find((p) => p.id === plan.pageId)
        if (page === undefined) return empty
        const composite = planLocalComposite({
          page,
          background: { assetId: plateAssetId, source: 'ai' },
          productImages: studio.job.productImages,
          effects: studio.job.effects ?? {},
          grain: studio.grain,
          onlyBlockIds: plan.fixedBlockIds,
          includeTexts: false,
        })
        const blob = await renderComposite(composite, await collectCompositeSources(composite))
        return await analyzeRegions(blob, blocks.map((b) => b.rect), composite.size)
      } catch {
        return empty
      }
    },
    [studio, getDocument],
  )

  /**
   * 부분수정할 자리 **아래에 실제로 깔려 있는 색**을 잰다 (부분수정 재료 Patch).
   *
   * `measureRegions`와 같은 일이지만 재는 자리가 다르다. 저쪽은 아직 만들지 않은
   * 문구의 자리를 미리 재고, 이쪽은 이미 놓여 있는 문구의 자리를 다시 잰다.
   *
   * 외부 호출은 0건이다. 여기서 만든 합성 페이지는 요청에 실리지 않는다 — 나가는
   * 것은 이 함수가 돌려주는 숫자뿐이다.
   */
  const measureEditTones = useCallback(
    async (pageId: string, rects: readonly LayoutRect[]): Promise<(TextLayerTone | null)[]> => {
      const empty = rects.map(() => null)
      if (studio === null || rects.length === 0) return empty
      const background = studio.backgroundOf(pageId)
      if (background === undefined) return empty
      try {
        const brief = getDocument()
        const page = brief.pages.find((p) => p.id === pageId)
        if (page === undefined) return empty
        const fixed = preserveParts(page, studio.job.productImages, (id) => studio.effectsOf(id).paperCutout).fixed
        const composite = planLocalComposite({
          page,
          background: { assetId: background.assetId, source: background.source },
          productImages: studio.job.productImages,
          effects: studio.job.effects ?? {},
          grain: studio.grain,
          onlyBlockIds: fixed.map((f) => f.blockId),
          includeTexts: false,
        })
        const blob = await renderComposite(composite, await collectCompositeSources(composite))
        return await analyzeRegions(blob, rects, composite.size)
      } catch {
        return empty
      }
    },
    [studio, getDocument],
  )

  /**
   * 문구 한 장을 받아 편집 오브젝트 하나로 만든다 (블록별 문구 Patch).
   *
   * 임시 바탕을 걷어 내고, **그려진 부분만** 남기고, 기획서가 정한 상자 안에
   * 비율을 지켜 앉힌다. 어느 픽셀이 누구 것인지 고르는 자리가 없다 — 이 그림에
   * 블록은 하나뿐이다.
   *
   * 실패하면 이유를 돌려준다. 다시 부르지 않는다.
   */
  const drawTextLayer = useCallback(
    async (
      blob: Blob,
      block: TextLayerBlock,
    ): Promise<{ object?: StudioTextObject; problem?: string }> => {
      const keyed = await removeKeyBackground(blob)
      if (keyed === null) return { problem: `"${block.content}"의 임시 배경을 걷어 내지 못했습니다.` }
      if (keyed.opaqueRatio > FOREGROUND_MAX_OPAQUE) {
        return { problem: `"${block.content}"이(가) 단색 배경 없이 돌아와 배경과 사진을 덮습니다.` }
      }
      const trimmed = await trimToContent(keyed.blob)
      if (trimmed === null) return { problem: `"${block.content}"에서 글자를 찾지 못했습니다.` }

      const assetId = createId('asset')
      await putAsset({
        id: assetId,
        blob: trimmed.blob,
        fileName: `text-${block.blockId}.png`,
        mimeType: 'image/png',
        byteSize: trimmed.blob.size,
      })
      return {
        object: {
          blockId: block.blockId,
          assetId,
          // 기획서 상자를 넘지 않는 가장 큰 크기로, 가운데에.
          rect: containRect(trimmed, block.rect),
          layer: block.layer,
        },
      }
    },
    [],
  )

  /**
   * 받아 둔 원본을 `840 × 페이지 세로길이` 작업본으로 맞춰 저장한다.
   *
   * Studio가 이후에 보고 고치고 저장하는 것은 전부 이 작업본이다. 모델 규격은
   * 메타데이터로만 남는다 — 파일이 832인데 840인 줄 알고 쓰는 일이 없도록.
   */
  const finishFromPaid = useCallback(async () => {
    const paid = paidRef.current
    if (paid === null) return

    let working: { blob: Blob; width: number; height: number }
    try {
      working = await toWorkingImage(paid.blob, paid.plan.working)
    } catch {
      // 원본은 그대로 손에 있다. 다시 만들기만 하면 되고, 모델은 부르지 않는다.
      setState({ kind: 'convert-failed', message: '이미지는 생성됐지만 840px 작업본 변환에 실패했습니다' })
      return
    }

    /**
     * 저장할 그림과 그 크기.
     *
     * `full_ai`에서는 모델이 준 것을 작업본으로 맞춘 그대로다. `preserve`에서는
     * 세 겹을 여기서 포갠다 (한방 생성 Patch 2 §4).
     *
     *   배경 플레이트 → 사용자가 배치한 이미지·컷아웃 원본 → 전경 문구 레이어
     *
     * 가운데 겹이 브라우저의 몫이고, 그 겹만이 좌표·크기·비율·레이어 순서를
     * 생성 전 값 그대로 지킨다.
     */
    let finalBlob = working.blob
    let finalSize = { width: working.width, height: working.height }
    let fileName = `ai-${paid.plan.pageId}.png`
    /**
     * 이 결과의 이미지 편집 오브젝트 (블록 연결 Patch §3).
     *
     * 합친 그림에서 이미지를 다시 찾아내지 않는다 — 찾아낸 덩어리는 블록이 아니다.
     * 무엇을 얹었는지는 방금 얹은 이 자리가 알고 있고, 그 목록을 그대로 남긴다.
     * 그래서 오브젝트 수는 언제나 얹은 이미지 블록 수와 같다.
     */
    const imageObjects: StudioTextObject[] = []

    if (paid.plan.mode === 'preserve') {
      if (studio === null) {
        setState({ kind: 'failed', message: errorTextFor('unknown') })
        return
      }
      try {
        // 플레이트를 자산으로 남긴 뒤 그것을 배경으로 삼는다. 다시 만들기에서는
        // 같은 플레이트를 그대로 쓰므로 모델을 부르는 자리가 없다.
        const plateAssetId = paid.plateAssetId ?? createId('asset')
        if (paid.plateAssetId === undefined) {
          await putAsset({
            id: plateAssetId,
            blob: working.blob,
            fileName: `plate-${paid.plan.pageId}.png`,
            mimeType: paid.mimeType,
            byteSize: working.blob.size,
          })
          paidRef.current = { ...paid, plateAssetId }
          // 배경으로도 남긴다. 나중에 문구 하나만 갈아 끼우고 다시 합칠 때
          // 이 그림이 필요한데, 결과 안에 이미 섞여 버린 뒤에는 꺼낼 수 없다.
          await studio.setBackground(paid.plan.pageId, {
            assetId: plateAssetId,
            source: 'ai',
            requestedSize: paid.requestedSize,
          })
        }

        const brief = getDocument()
        const page = brief.pages.find((p) => p.id === paid.plan.pageId) ?? brief.pages[0]!
        // 얹는 목록 그대로가 편집 오브젝트 목록이다 — 블록 하나에 오브젝트 하나.
        const fixed = new Set(paid.plan.fixedBlockIds)
        page.blocks.forEach((block, layer) => {
          if (!fixed.has(block.id)) return
          const assetId = studio.job.productImages[block.id] ?? block.assetId
          if (assetId === undefined) return
          imageObjects.push({ blockId: block.id, assetId, rect: { ...block.position }, layer })
        })
        // 이미지 블록은 **하나도 빠짐없이** 여기서 얹는다. 문구는 그리지 않는다 —
        // 문구는 전경 레이어가 이미 디자인해 왔다.
        const composite = planLocalComposite({
          page,
          background: { assetId: plateAssetId, source: 'ai', requestedSize: paid.requestedSize },
          // 칸에서 잘라 낸 조각들이다. 조각 하나가 블록 하나이고, 자리는 기획서
          // 원래 자리다 (스티커판 Patch §5).
          ...(paid.textObjects === undefined || paid.textObjects.length === 0
            ? {}
            : { textObjects: paid.textObjects.map((t) => ({ assetId: t.assetId, rect: t.rect, order: t.layer })) }),
          productImages: studio.job.productImages,
          effects: studio.job.effects ?? {},
          grain: studio.grain,
          tone: studio.toneOf(paid.plan.pageId),
          onlyBlockIds: paid.plan.fixedBlockIds,
          includeTexts: false,
        })
        finalBlob = await renderComposite(composite, await collectCompositeSources(composite))
        finalSize = { ...composite.size }
        fileName = `design-${paid.plan.pageId}.png`
      } catch {
        // 플레이트는 손에 있다. 다시 만들기만 하면 되고, 모델은 부르지 않는다.
        setState({ kind: 'convert-failed', message: '배경과 문구는 받았지만 원본 합성에 실패했습니다' })
        return
      }
    }

    const assetId = createId('asset')
    const current = pageResultOf(studio?.job ?? null, paid.plan.pageId)
    const editing = paid.plan.kind === 'edit' && current !== undefined

    const result: GeneratedPageResult = {
      pageId: paid.plan.pageId,
      assetId,
      model: IMAGE_MODEL,
      quality: IMAGE_QUALITY,
      requestedSize: paid.requestedSize,
      workingSize: sizeLabel(finalSize),
      // 부분수정은 기획서를 고친 것이 아니다. 그래서 "이 결과가 어느 기획서에서
      // 나왔는가"와 얼려 둔 대상 목록은 그대로 이어받는다.
      sourceFingerprint: editing ? current.sourceFingerprint : paid.plan.fingerprint,
      createdAt: Date.now(),
      ...(paid.requestId === undefined ? {} : { requestId: paid.requestId }),
      ...(editing
        ? (() => {
            // 지금 커서까지만 남기고 그 뒤의 미래는 버린다 — 되돌아간 자리에서
            // 새로 고쳤으면 그 뒤의 것들은 더 이상 이어지는 이야기가 아니다.
            const kept = revisionsOf(current).slice(0, cursorOf(current) + 1)
            const line: ImageRevision[] = [...kept, { assetId, kind: 'edit' }]
            return {
              previousAssetId: current.assetId,
              originalAssetId: line[0]!.assetId,
              ...(current.targets === undefined ? {} : { targets: current.targets }),
              editCount: (current.editCount ?? 0) + 1,
              revisions: line,
              cursor: line.length - 1,
            }
          })()
        : {
            // 첫 생성: 이 순간의 대상 목록을 얼려 둔다. 최초 생성본은 자기 자신.
            originalAssetId: assetId,
            targets: buildEditTargets(getDocument(), studio!.job, paid.plan.pageId),
            editCount: 0,
            revisions: [{ assetId, kind: 'initial' } as ImageRevision],
            cursor: 0,
          }),
    }
    try {
      await putAsset({
        id: assetId,
        blob: finalBlob,
        fileName,
        mimeType: paid.mimeType,
        byteSize: finalBlob.size,
      })
      await studio?.recordResult(result)
    } catch {
      setState({ kind: 'failed', message: errorTextFor('save_failed') })
      return
    }

    // 문구 오브젝트는 결과와 함께 남는다 — 합쳐진 그림 말고 이것이 나중에
    // 옮기고 다시 디자인할 대상이다 (§1).
    if (paid.plan.mode === 'preserve' && studio !== null) {
      await studio.setTextObjects(paid.plan.pageId, paid.textObjects ?? [])
      await studio.setImageObjects(paid.plan.pageId, imageObjects)
      studio.selectObject(null)
    }

    const problem = paid.foregroundProblem
    paidRef.current = null
    setSelectedTargetIds([])
    setInstructions({})
    setView('compare')
    // 문구 레이어를 못 얻었어도 배경과 사진까지는 저장한다 — 값은 이미 치렀고,
    // 버리면 아무것도 남지 않는다. 다만 무엇이 빠졌는지는 말한다.
    setState(
      problem === undefined
        ? { kind: 'idle' }
        : { kind: 'failed', message: `${problem} 배경과 이미지까지만 저장했습니다.` },
    )
  }, [studio, getDocument])

  /**
   * 지금 상태로 결과를 다시 합친다 — 배경, 사진, 그리고 **지금 자리의** 문구
   * 오브젝트 (텍스트 오브젝트 Patch §4).
   *
   * 문구를 옮기거나 크기를 바꾸거나 하나만 다시 디자인한 뒤에 부른다. 그림은
   * 전부 손에 있으므로 **외부 호출은 0건**이다.
   */
  /**
   * 배경과 조각들로 이 페이지를 한 장으로 합친다 (다시 합치기 Patch).
   *
   * 합치는 일만 한다 — 결과로 남기는 일은 부르는 쪽이 정한다. 두 부름이 있고,
   * 둘은 남기는 방식이 다르기 때문이다: 옮기고 나서 다시 합치는 쪽은 **줄에 한
   * 칸을 더하고**, 파일을 열고 되살리는 쪽은 **줄을 처음부터 세운다**.
   *
   * 외부 호출은 0건이다. 그림은 전부 손에 있다.
   */
  const composePage = useCallback(
    async (pageId: string): Promise<{ blob: Blob; size: { width: number; height: number } } | null> => {
      if (studio === null) return null
      const brief = getDocument()
      const page = brief.pages.find((p) => p.id === pageId)
      // 끌어 옮기는 동안의 값이 아니라 방금 저장된 값을 읽는다.
      const job = studio.currentJob()
      const background = job.backgrounds?.[pageId]
      const objects = job.textObjects?.[pageId] ?? []
      // **목록이 있는가**로 가른다. 비어 있는 목록과 없는 목록은 다르다 —
      // 마지막 하나를 지운 결과가 "예전 결과"로 읽히면 지운 것이 전부 되살아난다
      // (오브젝트 삭제 Patch).
      const imagesEntry = job.imageObjects?.[pageId]
      const images = imagesEntry ?? []
      if (page === undefined || background === undefined) return null

      // 이미지 오브젝트 목록이 있으면 그 목록이 곧 얹을 목록이고, 그 자리가 곧
      // 얹을 자리다. 없는 것은 이 Patch 이전에 만든 결과뿐이라, 그때는 지금까지
      // 처럼 기획서 블록에서 다시 센다.
      const fixed =
        imagesEntry !== undefined
          ? images.map((o) => o.blockId)
          : page.blocks
              .filter((b) => getBlockTypeMeta(b.type).requiresAsset)
              .filter((b) => (job.productImages[b.id] ?? b.assetId) !== undefined)
              .map((b) => b.id)
      const rectOverrides: Record<string, LayoutRect> = {}
      const orderOverrides: Record<string, number> = {}
      const angleOverrides: Record<string, number> = {}
      const objectTones: Record<string, ToneAdjust> = {}
      for (const object of images) {
        rectOverrides[object.blockId] = object.rect
        orderOverrides[object.blockId] = object.layer
        if (object.angle !== undefined) angleOverrides[object.blockId] = object.angle
        objectTones[object.blockId] = studio.objectToneOf(object.blockId)
      }

      const composite = planLocalComposite({
        page,
        background,
        textObjects: objects.map((t) => ({
          assetId: t.assetId,
          rect: t.rect,
          order: t.layer,
          ...(t.angle === undefined ? {} : { angle: t.angle }),
          // 이 문구 하나에만 거는 톤 (블록별 톤 Patch). 전체 톤과 따로 산다.
          tone: studio.objectToneOf(t.blockId),
        })),
        productImages: job.productImages,
        effects: job.effects ?? {},
        grain: studio.grain,
        tone: studio.toneOf(pageId),
        onlyBlockIds: fixed,
        rectOverrides,
        orderOverrides,
        angleOverrides,
        objectTones,
        includeTexts: false,
      })
      // 이 다시 합치기가 **아직 최신인가**. 슬라이더를 여러 번 놓거나 오브젝트를
      // 잇달아 지우면 두 번이 겹쳐 흐르고, 먼저 시작한 쪽이 늦게 끝나면 예전
      // 그림이 최신 결과를 덮는다. 자기 차례를 적어 두고 끝날 때 확인한다.
      const ticket = (recomposeRef.current += 1)
      const blob = await renderComposite(composite, await collectCompositeSources(composite))
      if (ticket !== recomposeRef.current) return null
      return { blob, size: composite.size }
    },
    [studio, getDocument],
  )

  /** 합친 그림을 자산으로 남긴다. 부르는 쪽이 그 번호로 결과를 세운다. */
  const storeComposed = useCallback(async (pageId: string, blob: Blob): Promise<string> => {
    const assetId = createId('asset')
    await putAsset({
      id: assetId,
      blob,
      fileName: `design-${pageId}.png`,
      mimeType: 'image/png',
      byteSize: blob.size,
    })
    return assetId
  }, [])

  /**
   * 지금 상태로 결과를 다시 합친다 — 배경, 사진, 그리고 **지금 자리의** 문구
   * 오브젝트 (텍스트 오브젝트 Patch §4).
   *
   * 문구를 옮기거나 크기를 바꾸거나 하나만 다시 디자인한 뒤에 부른다. 그림은
   * 전부 손에 있으므로 **외부 호출은 0건**이다.
   *
   * 결과가 아직 없으면 **아무것도 하지 않는다.** 이 함수는 되돌리기와 슬라이더
   * 에서도 불리는데, 거기서 없던 완성본이 만들어지면 안 된다 — 되살리는 일은
   * 사람이 누르는 `rebuildPage`가 맡는다.
   */
  const recomposePage = useCallback(
    async (pageId: string) => {
      if (studio === null) return
      const previous = pageResultOf(studio.currentJob(), pageId)
      if (previous === undefined) return
      const composed = await composePage(pageId)
      if (composed === null) return
      const assetId = await storeComposed(pageId, composed.blob)
      // 지나온 결과는 지우지 않는다 — 줄에 한 칸을 더할 뿐이다 (§3 마지막 줄).
      const kept = revisionsOf(previous).slice(0, cursorOf(previous) + 1)
      const line: ImageRevision[] = [...kept, { assetId, kind: 'edit' }]
      await studio.recordResult({
        ...previous,
        assetId,
        previousAssetId: previous.assetId,
        editCount: (previous.editCount ?? 0) + 1,
        revisions: line,
        cursor: line.length - 1,
        createdAt: Date.now(),
      })
    },
    [studio, composePage, storeComposed],
  )

  /**
   * 완성본을 **재료에서 되살린다** (다시 합치기 Patch).
   *
   * 작업 파일에는 합쳐진 완성본이 담기지 않는다. 담기에는 너무 크고, 결과 줄까지
   * 넣으면 감당이 안 된다. 그런데 **재료는 전부 담긴다** — 배경, 문구 조각,
   * 이미지 조각, 자리와 크기, 톤, 종이 두께까지.
   *
   * 재료가 다 있으면 완성본은 다시 만들 필요가 없다. **브라우저가 다시 합치면
   * 된다.** 그래서 파일을 열고 이것을 누르면 완성본이 돌아온다 — 유료 재생성이
   * 아니라 **외부 호출 0건**으로.
   *
   * 여기서 세우는 줄은 처음부터다. 지나온 수정 이력은 파일에 없으므로 되살릴
   * 것이 없고, 없는 이력을 지어내지 않는다.
   */
  const rebuildPage = useCallback(
    async (pageId: string) => {
      if (studio === null) return
      const job = studio.currentJob()
      const background = job.backgrounds?.[pageId]
      if (background === undefined) return
      setState({ kind: 'running' })
      try {
        const composed = await composePage(pageId)
        if (composed === null) {
          setState({ kind: 'failed', message: errorTextFor('save_failed') })
          return
        }
        const assetId = await storeComposed(pageId, composed.blob)
        await studio.recordResult({
          pageId,
          assetId,
          model: IMAGE_MODEL,
          quality: IMAGE_QUALITY,
          // 모델에게 요청했던 크기는 배경이 기억하고 있다. 없으면 합친 크기를
          // 적는다 — 지어내지 않는다.
          requestedSize: background.requestedSize ?? sizeLabel(composed.size),
          workingSize: sizeLabel(composed.size),
          sourceFingerprint: documentFingerprint(getDocument()),
          createdAt: Date.now(),
          originalAssetId: assetId,
          targets: buildEditTargets(getDocument(), job, pageId),
          editCount: 0,
          revisions: [{ assetId, kind: 'initial' } as ImageRevision],
          cursor: 0,
        })
        setView('compare')
        setState({ kind: 'idle' })
      } catch {
        setState({ kind: 'failed', message: errorTextFor('save_failed') })
      }
    },
    [studio, composePage, storeComposed, getDocument],
  )

  /** 같은 원본으로 작업본만 다시 만든다. 외부 호출 0건. */
  const retryConversion = useCallback(() => {
    if (paidRef.current === null) return
    void finishFromPaid()
  }, [finishFromPaid])

  /**
   * 한 겹을 만든다. **스스로 다시 부르지 않는다** — 실패는 실패한 채로 돌아온다.
   *
   * `preserve`가 두 겹이 되면서 이 부분이 두 번 쓰이게 됐다. 두 번 쓰이는 코드를
   * 두 벌로 두면, 언젠가 한쪽에만 키가 실리거나 한쪽만 재시도하게 된다.
   */
  const requestLayer = useCallback(
    async (
      plan: GenerationPlan,
      key: string,
      inputs: readonly GenerationInputImage[],
      prompt: string,
      /** 이 요청만의 판 크기. 없으면 계획의 페이지 규격 그대로다. */
      sizeOverride?: string,
    ): Promise<{ blob: Blob; mimeType: string; requestedSize: string; requestId?: string } | { code?: string }> => {
      const form = new FormData()
      form.set(FIELD_PROMPT, prompt)
      form.set(FIELD_SIZE, sizeOverride ?? plan.size)
      // 투명 배경은 요청하지 않는다. `gpt-image-2`가 거절한다 —
      // `param: background`, `Transparent background is not supported for this
      // model.` 대신 단색 위에 글자를 받아 브라우저가 그 단색을 걷어 낸다.
      for (const file of await collectImages(plan, inputs)) {
        form.append(FIELD_IMAGES, new File([file.blob], file.fileName, { type: file.blob.type || 'image/png' }))
      }

      // 키는 이 요청의 헤더에만 실린다 — 주소에도, 본문에도 없다.
      const response = await fetch(GENERATE_IMAGE_PATH, {
        method: 'POST',
        headers: { [API_KEY_HEADER]: key },
        body: form,
      })

      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const failure = (payload as { error?: { code?: string } } | null)?.error
        // 우리 서버 함수는 실패해도 코드를 담는다. 코드가 없으면 그 함수까지
        // 가지도 못한 요청이므로, 상태 코드로 이름을 붙인다 (부분수정 실패 Patch).
        return failure?.code === undefined ? { code: httpFailureCode(response.status) } : { ...failure }
      }
      const body = payload as {
        image?: { b64?: string; mimeType?: string }
        metadata?: { requestedSize?: string; requestId?: string }
      } | null
      const b64 = body?.image?.b64
      if (typeof b64 !== 'string' || b64.length === 0) return { code: 'no_image' }

      const mimeType = body?.image?.mimeType ?? 'image/png'
      return {
        blob: blobFromBase64(b64, mimeType),
        mimeType,
        requestedSize: body?.metadata?.requestedSize ?? sizeOverride ?? plan.size,
        ...(body?.metadata?.requestId === undefined ? {} : { requestId: body.metadata.requestId }),
      }
    },
    [collectImages],
  )

  /**
   * 배경 주문을 요청 직전에 마무리한다 (배경 색맞춤 Patch).
   *
   * 그 자리에 놓일 사진이 어떤 색인지 브라우저가 읽어 주문에 얹는다. 배경이
   * 지금까지 그 자리에 무엇이 놓일지 모르는 채로 만들어지던 자리다. 나가는 것은
   * 숫자뿐이고, 그림은 여전히 나가지 않는다. 외부 호출은 0건이다.
   */
  const platePrompt = useCallback(async (plan: GenerationPlan): Promise<string> => {
    const plate = plan.plate
    if (plate === undefined || plate.fixed.length === 0) return plan.prompt
    try {
      const toned: FixedTone[] = []
      const kept: (typeof plate.fixed)[number][] = []
      for (const item of plate.fixed) {
        const asset = await getAsset(item.assetId)
        const analysis = asset === undefined ? null : await analyzeImageBlob(asset.blob)
        kept.push(item)
        if (analysis === null) continue
        toned[kept.length - 1] = {
          palette: analysis.palette.map((p) => p.hex),
          average: analysis.average,
          brightness: analysis.brightness,
          contrast: analysis.contrast,
          saturation: analysis.saturation,
          temperature: analysis.temperature,
        }
      }
      return buildPlatePrompt({
        ...plate,
        fixed: kept.map((item, i) => ({ ...item, tone: toned[i] ?? null })),
      })
    } catch {
      // 색을 못 읽는 것이 배경을 못 만드는 이유는 아니다. 계획의 주문 그대로 간다.
      return plan.prompt
    }
  }, [])

  const run = useCallback(
    async (plan: GenerationPlan, key: string) => {
      runningRef.current = true
      setState({ kind: 'running' })
      try {
        // ── 고른 문구만 하나씩 갈아 끼우는 길 (블록별 부분수정 Patch) ────────
        //
        // 통이미지를 다시 그리지 않으므로 배경도 사진도 고르지 않은 문구도 손대지
        // 않는다. 하나가 실패해도 나머지는 그대로 간다 — 값을 이미 치렀다.
        if (plan.textEdits !== undefined && studio !== null) {
          const problems: string[] = []
          let changed = 0
          const context = plan.textEditContext
          // 고칠 자리마다 그 아래에 실제로 깔려 있는 색. 외부 호출 0건이다.
          const tones = await measureEditTones(plan.pageId, plan.textEdits.map((e) => e.rect))
          for (const [index, edit] of plan.textEdits.entries()) {
            const answer = await requestLayer(
              plan,
              key,
              planTextEditInputs({
                currentAssetId: edit.assetId,
                ...(context?.styleReferenceAssetId === undefined
                  ? {}
                  : { styleReferenceAssetId: context.styleReferenceAssetId }),
                ...(context?.backgroundAssetId === undefined
                  ? {}
                  : { backgroundAssetId: context.backgroundAssetId }),
                ...(edit.referenceAssetId === undefined
                  ? {}
                  : { blockReferenceAssetId: edit.referenceAssetId }),
              }),
              buildTextEditPrompt({
                size: { width: edit.rect.width, height: edit.rect.height },
                pageSize: context?.pageSize,
                content: edit.content,
                instruction: edit.instruction,
                rect: edit.rect,
                lines: edit.lines,
                tone: tones[index] ?? null,
                styleReference: context?.styleReferenceAssetId !== undefined,
                background: context?.backgroundAssetId !== undefined,
                blockReference: edit.referenceAssetId !== undefined,
                blockNote: edit.blockNote,
                fixed: context?.fixed,
              }),
              edit.size,
            )
            if (!('blob' in answer)) {
              problems.push(`"${edit.content}": ${errorTextFor(answer.code)}`)
              continue
            }
            const keyed = await removeKeyBackground(answer.blob)
            if (keyed === null || keyed.opaqueRatio > FOREGROUND_MAX_OPAQUE) {
              problems.push(`"${edit.content}": 임시 배경을 걷어 내지 못했습니다.`)
              continue
            }
            const trimmed = await trimToContent(keyed.blob)
            if (trimmed === null) {
              problems.push(`"${edit.content}": 새 디자인에서 글자를 찾지 못했습니다.`)
              continue
            }
            const assetId = createId('asset')
            await putAsset({
              id: assetId,
              blob: trimmed.blob,
              fileName: `text-${edit.blockId}.png`,
              mimeType: 'image/png',
              byteSize: trimmed.blob.size,
            })
            // 자리와 크기는 그대로. 바뀌는 것은 그림 하나뿐이다 — 판을 그 자리
            // 모양으로 주문했으므로 늘어나거나 눌리지 않는다.
            await studio.replaceTextObjectAsset(plan.pageId, edit.blockId, assetId)
            changed += 1
          }
          if (changed > 0) await recomposePage(plan.pageId)
          setSelectedTargetIds([])
          setInstructions({})
          setView('compare')
          setState(
            problems.length === 0
              ? { kind: 'idle' }
              : { kind: 'failed', message: `문구 ${String(problems.length)}개를 고치지 못했습니다 — ${problems.join(' / ')}` },
          )
          return
        }

        const first = await requestLayer(plan, key, plan.inputs, await platePrompt(plan))
        if (!('blob' in first)) {
          setState({ kind: 'failed', message: errorTextFor(first.code) })
          return
        }

        // 여기서부터는 이미 결제된 그림이다. 이 뒤로 무엇이 실패하든 이 원본을
        // 버리지 않는다 — 버리면 돈만 쓰고 아무것도 남지 않는다.
        paidRef.current = {
          plan,
          blob: first.blob,
          mimeType: first.mimeType,
          requestedSize: first.requestedSize,
          ...(first.requestId === undefined ? {} : { requestId: first.requestId }),
        }

        // ── 두 번째 겹부터: 문구·버튼 한 블록에 한 장 (블록별 문구 Patch) ────
        const textBlocks = plan.textBlocks ?? []
        if (plan.mode === 'preserve' && textBlocks.length > 0 && studio !== null) {
          // ① 배경을 먼저 완성해 둔다 — 자산으로 남기고 이 페이지의 배경으로
          //    삼는다. 이어지는 요청마다 붙일 그림이 바로 이것이다.
          const plateAssetId = await storePlate(plan, first)

          // ② 고정 오브젝트 로컬 배치 + ③ 자리별 색. 둘 다 브라우저 안에서
          //    끝난다 — 여기서 나가는 외부 호출은 0건이다. 합성 페이지 자체는
          //    요청에 실리지 않고, 여기서 뽑은 숫자만 실린다.
          const tones = await measureRegions(plan, plateAssetId)
          const styleRefId = studio.styleReferenceOf(plan.pageId)
          const note = getDocument().project.aiNote?.trim() ?? ''
          const fixed = preserveParts(
            getDocument().pages.find((p) => p.id === plan.pageId) ?? getDocument().pages[0]!,
            studio.job.productImages,
            (id) => studio.effectsOf(id).paperCutout,
          ).fixed

          // ④ 블록마다 한 번씩. 하나가 실패해도 나머지는 그대로 간다 — 값을 치른
          //    것을 잃지 않기 위해서다. 스스로 다시 부르는 자리는 없다.
          const objects: StudioTextObject[] = []
          const problems: string[] = []
          for (const [index, block] of textBlocks.entries()) {
            const withTone: TextLayerBlock = { ...block, tone: tones[index] ?? null }
            // 첨부와 주문은 블록마다 다르다 — 이 블록에만 붙여 둔 참고 그림이
            // 있으면 그 요청에만 실린다 (블록별 주문 Patch).
            const order = plan.blockOrders?.[block.blockId] ?? {}
            const answer = await requestLayer(
              plan,
              key,
              planTextLayerInputs({
                ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
                ...(plateAssetId === undefined ? {} : { backgroundAssetId: plateAssetId }),
                ...(order.referenceAssetId === undefined ? {} : { blockReferenceAssetId: order.referenceAssetId }),
              }),
              buildTextLayerPrompt({
                size: plan.working,
                ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
                ...(plateAssetId === undefined ? {} : { backgroundAssetId: plateAssetId }),
                block: withTone,
                siblings: textBlocks,
                fixed,
                ...(note.length === 0 ? {} : { note }),
                ...(order.note === undefined ? {} : { blockNote: order.note }),
                ...(order.referenceAssetId === undefined ? {} : { blockReference: true }),
              }),
              plan.textSizes?.[block.blockId],
            )
            if (!('blob' in answer)) {
              problems.push(`"${block.content}": ${errorTextFor(answer.code)}`)
              continue
            }
            const drawn = await drawTextLayer(answer.blob, withTone)
            if (drawn.object !== undefined) objects.push(drawn.object)
            if (drawn.problem !== undefined) problems.push(drawn.problem)
          }

          paidRef.current = {
            ...paidRef.current,
            textObjects: objects,
            ...(problems.length === 0
              ? {}
              : { foregroundProblem: `문구 ${String(problems.length)}개를 얹지 못했습니다 — ${problems.join(' / ')}` }),
          }
        }

        await finishFromPaid()
      } catch {
        // 스스로 다시 부르지 않는다. 다음 호출은 사람의 클릭이다.
        setState({ kind: 'failed', message: errorTextFor('network_error') })
      } finally {
        runningRef.current = false
      }
    },
    [requestLayer, finishFromPaid, studio, getDocument, recomposePage, storePlate, measureRegions, measureEditTones, drawTextLayer, platePrompt],
  )

  const confirm = useCallback(
    (key?: string) => {
      if (state.kind !== 'confirm' || runningRef.current) return
      const plan = state.plan
      const trimmed = key?.trim()
      if (trimmed !== undefined && trimmed.length > 0) {
        saveApiKey(trimmed)
        setHasKey(true)
      }
      const usable = trimmed !== undefined && trimmed.length > 0 ? trimmed : readApiKey()
      if (usable === null) {
        setState({ kind: 'blocked', message: errorTextFor('missing_api_key') })
        return
      }
      void run(plan, usable)
    },
    [state, run],
  )

  // ── 부분수정 ───────────────────────────────────────────────────────────────

  const currentResult = studio === null ? undefined : pageResultOf(studio.job, activePageId)
  // 결과 안에 얼려 둔 목록 그대로. 매 렌더 새 배열을 만들면 아래 훅들이 계속
  // 다시 만들어지므로, 결과가 바뀔 때만 새로 잡는다.
  const editTargets = useMemo<EditTarget[]>(() => currentResult?.targets ?? [], [currentResult])

  const toggleTarget = useCallback((targetId: string) => {
    setSelectedTargetIds((ids) => (ids.includes(targetId) ? ids.filter((id) => id !== targetId) : [...ids, targetId]))
  }, [])

  const instructionFor = useCallback((targetId: string) => instructions[targetId] ?? '', [instructions])
  const setInstructionFor = useCallback((targetId: string, text: string) => {
    setInstructions((all) => ({ ...all, [targetId]: text }))
  }, [])

  /**
   * 고른 대상과 그 대상에 적을 지시. 선택을 풀면 요청에서 빠지지만, 쓰던 초안은
   * `instructions`에 남아 있어 다시 고르면 그대로 돌아온다.
   */
  const editItems = useMemo(
    () =>
      selectedTargets(editTargets, selectedTargetIds).map((target) => ({
        target,
        instruction: (instructions[target.targetId] ?? '').trim(),
      })),
    [editTargets, selectedTargetIds, instructions],
  )

  const missingInstruction = editItems.some((i) => i.instruction.length === 0)
  const canEdit =
    currentResult !== undefined && editItems.length > 0 && !missingInstruction && editTargets.length > 0
  const editBlockedReason =
    editItems.length > 0 && missingInstruction ? '선택한 모든 대상에 수정 지시를 적어 주세요.' : null

  /**
   * 편집 한 번의 계획.
   *
   * 보내는 이미지는 ①지금 커서가 가리키는 결과 ②고른 자리에 연결된 실제 제품·로고
   * 원본이다. 고르지 않은 자리의 원본은 보내지 않는다 — 보내면 모델이 그것도
   * 손대도 된다고 읽을 수 있다.
   */
  const planEdit = useCallback((): { plan: GenerationPlan } | { blocked: string } => {
    if (studio === null || currentResult === undefined) return { blocked: errorTextFor('unknown') }
    if (editItems.length === 0) return { blocked: errorTextFor('target_not_found') }

    const current = getDocument()
    const page = current.pages.find((p) => p.id === currentResult.pageId) ?? current.pages[0]!
    const size = resolveGptImageSize(page.canvasWidth, page.canvasHeight)
    if (!size.ok) return { blocked: size.message }
    const working = workingImageTarget(page.canvasHeight)

    // ── 고른 것이 모두 문구 오브젝트인 자리 (블록별 부분수정 Patch) ───────────
    //
    // 통이미지를 다시 그리지 않는다. 배경도 사진도 고르지 않은 문구도 그대로 두고,
    // **고른 것만 하나씩** 새로 받아 갈아 끼운다. 고르지 않은 것은 별개 파일이라
    // 바뀔 수가 없다 — 고정한다고 따로 말할 필요가 없는 것은 그래서다.
    //
    // 이미지·컷아웃이 섞여 있으면 지금까지의 통이미지 길로 간다. 그쪽은 원본
    // 사진이라 다시 그리게 할 수 없고, 문구와 같은 방법이 통하지 않는다.
    const objects = studio.textObjectsOf(currentResult.pageId)
    const picked = editItems.map((item) => ({
      item,
      object: objects.find((o) => o.blockId === item.target.blockId),
    }))
    if (picked.length > 0 && picked.every((p) => p.object !== undefined)) {
      // 첫 생성이 보는 것을 그대로 챙긴다 (부분수정 재료 Patch). 새로 계산할 것이
      // 없다 — 스타일 레퍼런스도, 배경도, 블록 주문도 이미 저장되어 있다.
      const pageSize = { width: page.canvasWidth, height: page.canvasHeight }
      const styleRefId = studio.styleReferenceOf(currentResult.pageId)
      const background = studio.backgroundOf(currentResult.pageId)
      const fixed = preserveParts(page, studio.job.productImages, (id) => studio.effectsOf(id).paperCutout).fixed

      const textEdits = picked.map(({ item, object }) => {
        const canvas = textLayerCanvas(object!.rect)
        const resolved = resolveGptImageSize(canvas.width, canvas.height)
        const content = item.target.content ?? ''
        const block = page.blocks.find((b) => b.id === object!.blockId)
        const order = studio.blockOrderOf(object!.blockId)
        const note = (order.note ?? '').trim()
        return {
          blockId: object!.blockId,
          assetId: object!.assetId,
          rect: object!.rect,
          content,
          instruction: item.instruction,
          size: resolved.ok ? resolved.size : size.size,
          // 자리와 크기가 그대로이므로 줄 나눔도 그대로다. 기획서 화면이 끊는
          // 그 줄을 다시 보낸다 — 고치다가 한 줄이 두 줄이 되지 않게.
          lines:
            block === undefined ? [] : planLines(content, block.position, drawsBareText(block)),
          ...(note.length === 0 ? {} : { blockNote: note }),
          ...(order.referenceAssetId === undefined ? {} : { referenceAssetId: order.referenceAssetId }),
        }
      })
      const first = textEdits[0]!
      return {
        plan: {
          kind: 'edit',
          mode: 'preserve',
          fixedBlockIds: [],
          // 고른 문구 하나에 한 번씩. 확인창이 이 수를 그대로 말한다.
          calls: textEdits.length,
          pageId: currentResult.pageId,
          prompt: buildTextEditPrompt({
            size: { width: first.rect.width, height: first.rect.height },
            pageSize,
            content: first.content,
            instruction: first.instruction,
            rect: first.rect,
            lines: first.lines,
            styleReference: styleRefId !== undefined,
            background: background !== undefined,
            blockReference: first.referenceAssetId !== undefined,
            blockNote: first.blockNote,
            fixed,
          }),
          size: size.size,
          working,
          inputs: [],
          fingerprint: currentResult.sourceFingerprint,
          textEdits,
          textEditContext: {
            pageSize,
            ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
            ...(background === undefined ? {} : { backgroundAssetId: background.assetId }),
            fixed: fixed.map((f) => ({ rect: f.rect })),
          },
        },
      }
    }

    const inputs: GenerationInputImage[] = [
      {
        index: 1,
        role: 'page_layout',
        assetId: currentResult.assetId,
        label: '현재 결과 이미지 — 이 그림을 고칩니다.',
        fileName: 'current-result.png',
      },
    ]
    for (const assetId of selectedProductAssetIds(editItems.map((i) => i.target))) {
      const owner = editItems.find((i) => i.target.productAssetId === assetId)?.target
      inputs.push({
        index: inputs.length + 1,
        role: 'product_image',
        assetId,
        fileName: `${assetId}.png`,
        ...(owner?.blockId === undefined ? {} : { blockId: owner.blockId }),
        label: `${owner?.label ?? '선택한 자리'}의 실제 제품·로고 원본`,
      })
    }
    if (inputs.length > MAX_INPUT_IMAGES) return { blocked: errorTextFor('too_many_inputs') }

    return {
      plan: {
        kind: 'edit',
        // 부분수정은 이미 만들어진 한 장을 고치는 일이다 — 갈림길과 무관하다.
        mode: 'full_ai',
        fixedBlockIds: [],
        calls: 1,
        pageId: currentResult.pageId,
        prompt: buildEditPrompt(editTargets, editItems, {
          currentImage: working,
          page: { width: page.canvasWidth, height: page.canvasHeight },
          inputs: inputs.map((i) => ({ index: i.index, what: i.label })),
        }),
        size: size.size,
        working,
        inputs,
        fingerprint: currentResult.sourceFingerprint,
      },
    }
  }, [studio, currentResult, editTargets, editItems, getDocument])

  const beginEdit = useCallback(() => {
    if (runningRef.current || !canEdit) return
    const planned = planEdit()
    if ('blocked' in planned) {
      setState({ kind: 'blocked', message: planned.blocked })
      return
    }
    setState({ kind: 'edit-confirm', plan: planned.plan, items: editItems })
  }, [canEdit, planEdit, editItems])

  const confirmEdit = useCallback(() => {
    if (state.kind !== 'edit-confirm' || runningRef.current) return
    const key = readApiKey()
    if (key === null) {
      setState({ kind: 'blocked', message: errorTextFor('missing_api_key') })
      return
    }
    void run(state.plan, key)
  }, [state, run])

  // ── 결과의 줄 ──────────────────────────────────────────────────────────────

  const revisions = currentResult === undefined ? [] : revisionsOf(currentResult)
  const cursor = currentResult === undefined ? 0 : cursorOf(currentResult)
  const canGoPrevious = cursor > 0
  const canGoNext = cursor < revisions.length - 1

  /**
   * 커서만 옮긴다. 그림을 새로 만들지도 지우지도 않으므로 외부 호출이 0건이고,
   * 옮긴 뒤에도 지나온 결과는 그대로 남는다.
   */
  const goTo = useCallback(
    (next: number) => {
      if (studio === null || currentResult === undefined) return
      const line = revisionsOf(currentResult)
      const target = line[next]
      if (target === undefined || next === cursorOf(currentResult)) return
      void studio.recordResult({ ...currentResult, revisions: line, cursor: next, assetId: target.assetId })
    },
    [studio, currentResult],
  )

  /**
   * 생성은 Studio 작업에 딸린 일이다. 작업이 없는 화면 — 작성기, 그리고 요청
   * 작업 화면 — 에서는 아예 없는 기능이어야 하므로 `null`을 내려보낸다. 값을
   * 내려놓고 버튼만 숨기면, 숨기는 것을 한 군데라도 빠뜨렸을 때 남의 화면에
   * 결제 버튼이 나타난다.
   */
  const api = useMemo<ImageGenerationApi | null>(
    () =>
      studio === null
        ? null
        : {
            state,
            hasResult,
            hasKey,
            saveKey: (key: string) => {
              saveApiKey(key)
              setHasKey(readApiKey() !== null)
            },
            clearKey: () => {
              clearApiKey()
              setHasKey(false)
            },
            view,
            setView,
            begin,
            confirm,
            retryConversion,
            recomposePage,
            rebuildPage,
            canRebuild,
            editTargets,
            selectedTargetIds,
            toggleTarget,
            instructionFor,
            setInstructionFor,
            canEdit,
            editBlockedReason,
            beginEdit,
            confirmEdit,
            revisionCount: revisions.length,
            revisionPosition: cursor + 1,
            canGoPrevious,
            canGoNext,
            goPrevious: () => goTo(cursor - 1),
            goNext: () => goTo(cursor + 1),
            goOriginal: () => goTo(0),
            dismiss: () => setState({ kind: 'idle' }),
          },
    [
      studio, state, hasResult, hasKey, view, begin, confirm, retryConversion, recomposePage,
      rebuildPage, canRebuild,
      editTargets, selectedTargetIds, toggleTarget, instructionFor, setInstructionFor,
      canEdit, editBlockedReason, beginEdit, confirmEdit,
      revisions.length, cursor, canGoPrevious, canGoNext, goTo,
    ],
  )

  return <ImageGenerationContext.Provider value={api}>{children}</ImageGenerationContext.Provider>
}

/** 작업판 밖(= 작성기 표면)에서는 `null`. */
export function useImageGeneration(): ImageGenerationApi | null {
  return useContext(ImageGenerationContext)
}

/** 확인 창이 사람에게 보여 주는 값 — 무엇을, 어떻게, 몇 번. */
export const CALL_SUMMARY = {
  model: IMAGE_MODEL,
  quality: IMAGE_QUALITY,
  calls: IMAGE_CALLS_PER_CLICK,
}
