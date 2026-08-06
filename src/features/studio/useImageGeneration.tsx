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
 * 돈이 드는 일이라 두 가지를 특히 지킨다.
 *
 *  - **한 번은 한 번이다.** 요청이 나가 있는 동안 버튼은 잠기고, 실패해도 스스로
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
  buildPreserveDesignPrompt,
  planPreserveInputs,
  type PreserveDesignInput,
  type PreserveImageEntry,
  type PreserveTextEntry,
} from '../../domain/preserveDesign'
import { planLocalComposite } from '../../domain/composite'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { isPairedLinkUrl, textAlignOf } from '../../domain/simpleBlocks'
import { resolveGptImageSize } from '../../domain/gptImageSize'
import { documentFingerprint } from '../../domain/documentFingerprint'
import { pageAsEventBrief } from '../../domain/briefMigration'
import {
  API_KEY_HEADER,
  errorTextFor,
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
import { collectCompositeSources } from '../../services/compositeSources'
import { createId } from '../../domain/factory'
import type { BriefPage } from '../../domain/pageSchema'

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
  /** `preserve`에서 브라우저가 나중에 원본 그대로 얹을 블록들. */
  cutoutBlockIds: string[]
  pageId: string
  prompt: string
  /** 모델에게 요청하는 크기 (16의 배수). */
  size: string
  /** Studio가 쓰는 크기 — `840 × 페이지 세로길이`. 모델에게 보내지 않는다. */
  working: WorkingImageTarget
  inputs: GenerationInputImage[]
  fingerprint: string
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

/** base64 → 이미지 한 장. 이 문자열은 여기서 끝나고 어디에도 저장되지 않는다. */
function blobFromBase64(b64: string, mimeType: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

/**
 * 이 페이지를 세 뭉치로 가른다 (한방 생성 Patch §2).
 *
 * 문구는 원문 그대로, 컷아웃이 아닌 이미지는 원본을 보낼 자리로, 컷아웃은
 * **자리만** 적을 자리로. 가르는 기준은 종이 컷아웃 체크 하나뿐이다.
 *
 * 앞뒤 순서는 블록 차례 그대로다 — 화면에서 뒤에 오는 블록이 앞에 그려지므로,
 * 번호가 클수록 앞이라는 프롬프트의 말과 같은 뜻이 된다.
 */
function preserveParts(
  page: BriefPage,
  productImages: Readonly<Record<string, string>>,
  isCutout: (blockId: string) => boolean,
): { texts: PreserveTextEntry[]; images: PreserveImageEntry[]; cutouts: PreserveImageEntry[] } {
  const texts: PreserveTextEntry[] = []
  const images: PreserveImageEntry[] = []
  const cutouts: PreserveImageEntry[] = []

  page.blocks.forEach((block, layer) => {
    // 퍼블리싱 주소는 디자인이 아니다 — 합성 계획과 같은 규칙으로 뺀다.
    if (isPairedLinkUrl(page.blocks, block)) return
    const meta = getBlockTypeMeta(block.type)
    const rect = { ...block.position }

    if (meta.requiresAsset) {
      const assetId = productImages[block.id] ?? block.assetId
      if (assetId === undefined) return
      const entry: PreserveImageEntry = { blockId: block.id, assetId, rect, layer }
      if (isCutout(block.id)) cutouts.push(entry)
      else images.push(entry)
      return
    }

    const content = block.content ?? ''
    if (!meta.hasText || content.trim().length === 0) return
    texts.push({ blockId: block.id, content, rect, align: textAlignOf(block), layer })
  })

  return { texts, images, cutouts }
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

  const doc = studio === null ? null : getDocument()
  const activePageId = doc?.activePageId ?? ''
  const hasResult = studio !== null && (studio.job.results?.[activePageId] ?? null) !== null

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

    if (parts.cutouts.length > 0) {
      const styleRefId = studio.styleReferenceOf(page.id)
      const note = current.project.aiNote?.trim() ?? ''
      const preserve: PreserveDesignInput = {
        size: { width: page.canvasWidth, height: page.canvasHeight },
        ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
        texts: parts.texts,
        images: parts.images,
        cutouts: parts.cutouts,
        ...(note.length === 0 ? {} : { note }),
      }
      // 컷아웃은 이 목록에 들어갈 길이 없다 — 그 하나가 이 흐름의 경계다.
      const preserveInputs = planPreserveInputs(preserve)
      if (preserveInputs.length > MAX_INPUT_IMAGES) {
        return { blocked: errorTextFor('too_many_inputs') }
      }
      return {
        plan: {
          kind: 'generate',
          mode: 'preserve',
          cutoutBlockIds: parts.cutouts.map((c) => c.blockId),
          pageId: page.id,
          prompt: buildPreserveDesignPrompt(preserve, preserveInputs),
          size: size.size,
          working,
          inputs: preserveInputs,
          fingerprint,
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
        cutoutBlockIds: [],
        pageId: page.id,
        prompt: buildOpenAIImagePrompt(request, inputs),
        size: size.size,
        working,
        inputs,
        fingerprint,
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

  /** 보낼 이미지들을 실제 바이너리로 모은다. 순서는 `plan.inputs` 그대로. */
  const collectImages = useCallback(
    async (plan: GenerationPlan): Promise<{ fileName: string; blob: Blob }[]> => {
      const current = getDocument()
      const page = current.pages.find((p) => p.id === plan.pageId) ?? current.pages[0]!
      const stored = await getAllAssets()
      const byId = new Map(stored.map((a) => [a.id, a]))

      const files: { fileName: string; blob: Blob }[] = []
      if (plan.kind === 'edit') {
        // 편집은 지금 이미지를 다시 보내는 일이다. 모델은 지난 호출을 기억하지
        // 않으므로, 고칠 대상과 지켜야 할 것을 매번 이 그림과 함께 보낸다.
        for (const input of plan.inputs) {
          const asset = input.assetId === undefined ? undefined : await getAsset(input.assetId)
          if (asset === undefined) continue
          // 이름이 곧 역할이다 — 서버 로그와 검사에서 무엇을 보냈는지 읽힌다.
          const name = input.fileName ?? `${input.role}-${input.assetId ?? ''}.png`
          files.push({ fileName: `${String(input.index)}-${name}`, blob: asset.blob })
        }
        return files
      }
      if (plan.mode === 'preserve') {
        // 배치도를 만들지 않는다. 배치도에는 컷아웃 픽셀이 이미 그려져 있어서,
        // 보내는 순간 "원본은 보내지 않는다"가 거짓이 된다 (§2).
        //
        // 파일명도 우리가 정한 것뿐이다 — 작업자가 올린 원본 파일명은 나가지
        // 않는다.
        for (const input of plan.inputs) {
          const asset = input.assetId === undefined ? undefined : byId.get(input.assetId)
          if (asset === undefined) continue
          files.push({
            fileName: `${String(input.index)}-${input.fileName ?? `${input.role}.png`}`,
            blob: asset.blob,
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
    [getDocument],
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
    /** `preserve`에서 저장해 둔 완성 디자인 플레이트. 다시 만들 때 재사용한다. */
    plateAssetId?: string
  } | null>(null)

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
     * 모델이 준 것이 **완성 디자인 플레이트**이고, 그 위에 컷아웃만 브라우저가
     * 원본 그대로 얹은 뒤의 한 장이 결과다 (§2 마지막 줄).
     */
    let finalBlob = working.blob
    let finalSize = { width: working.width, height: working.height }
    let fileName = `ai-${paid.plan.pageId}.png`

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
        }

        const brief = getDocument()
        const page = brief.pages.find((p) => p.id === paid.plan.pageId) ?? brief.pages[0]!
        // 얹는 것은 **AI에게 보내지 않은 컷아웃**뿐이다. 문구와 일반 이미지는
        // 이미 플레이트 안에 그려져 있으므로 다시 그리면 두 번 나온다.
        const composite = planLocalComposite({
          page,
          background: { assetId: plateAssetId, source: 'ai', requestedSize: paid.requestedSize },
          productImages: studio.job.productImages,
          effects: studio.job.effects ?? {},
          grain: studio.grain,
          onlyBlockIds: paid.plan.cutoutBlockIds,
          includeTexts: false,
        })
        finalBlob = await renderComposite(composite, await collectCompositeSources(composite))
        finalSize = { ...composite.size }
        fileName = `design-${paid.plan.pageId}.png`
      } catch {
        // 플레이트는 손에 있다. 다시 만들기만 하면 되고, 모델은 부르지 않는다.
        setState({ kind: 'convert-failed', message: '완성 디자인은 받았지만 원본 합성에 실패했습니다' })
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

    paidRef.current = null
    setSelectedTargetIds([])
    setInstructions({})
    setState({ kind: 'idle' })
    setView('compare')
  }, [studio, getDocument])

  /** 같은 원본으로 작업본만 다시 만든다. 외부 호출 0건. */
  const retryConversion = useCallback(() => {
    if (paidRef.current === null) return
    void finishFromPaid()
  }, [finishFromPaid])

  const run = useCallback(
    async (plan: GenerationPlan, key: string) => {
      runningRef.current = true
      setState({ kind: 'running' })
      try {
        const form = new FormData()
        form.set(FIELD_PROMPT, plan.prompt)
        form.set(FIELD_SIZE, plan.size)
        for (const file of await collectImages(plan)) {
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
          const error = (payload as { error?: { code?: string } } | null)?.error
          setState({ kind: 'failed', message: errorTextFor(error?.code) })
          return
        }

        const body = payload as {
          image?: { b64?: string; mimeType?: string }
          metadata?: { requestedSize?: string; requestId?: string }
        } | null
        const b64 = body?.image?.b64
        if (typeof b64 !== 'string' || b64.length === 0) {
          setState({ kind: 'failed', message: errorTextFor('no_image') })
          return
        }

        // 이미지는 자산 저장소로, 작업 행에는 번호와 메타데이터만.
        const mimeType = body?.image?.mimeType ?? 'image/png'
        // 여기서부터는 이미 결제된 그림이다. 이 뒤로 무엇이 실패하든 이 원본을
        // 버리지 않는다 — 버리면 돈만 쓰고 아무것도 남지 않는다.
        const original = blobFromBase64(b64, mimeType)
        paidRef.current = {
          plan,
          blob: original,
          mimeType,
          requestedSize: body?.metadata?.requestedSize ?? plan.size,
          ...(body?.metadata?.requestId === undefined ? {} : { requestId: body.metadata.requestId }),
        }
        await finishFromPaid()
      } catch {
        // 스스로 다시 부르지 않는다. 다음 호출은 사람의 클릭이다.
        setState({ kind: 'failed', message: errorTextFor('network_error') })
      } finally {
        runningRef.current = false
      }
    },
    [collectImages, finishFromPaid],
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
        cutoutBlockIds: [],
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
      studio, state, hasResult, hasKey, view, begin, confirm, retryConversion,
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
