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
import { pageResultOf } from '../../domain/studioJob'
import { clearApiKey, readApiKey, saveApiKey } from './apiKeySession'
import { buildGenerationRequest } from '../../domain/generationRequest'
import { buildEditTargets, selectedProductAssetIds, selectedTargets, type EditTarget } from '../../domain/editTargets'
import { buildEditPrompt } from '../../domain/editPrompt'
import { planGenerationInputs, MAX_INPUT_IMAGES, type GenerationInputImage } from '../../domain/imageGenerationInputs'
import { buildOpenAIImagePrompt } from '../../domain/imagePrompt'
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
} from '../../domain/imageGeneration'
import { getAllAssets, getAsset, putAsset } from '../../services/assetStore'
import { sizeLabel, toWorkingImage, workingImageTarget, type WorkingImageTarget } from '../../services/workingImage'
import { renderPreviewPng } from '../../services/previewRenderer'
import { createId } from '../../domain/factory'

/** 중앙 패널이 무엇을 보여 주는가. 참고 이미지 보기와는 아무 관계가 없다. */
export type StudioCenterView = 'brief' | 'compare'

interface GenerationPlan {
  /** 처음부터 만드는 것인가, 이미 있는 결과를 고치는 것인가. */
  kind: 'generate' | 'edit'
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

  /** 되돌리기 — 외부 호출 0건. */
  canRevertPrevious: boolean
  canRevertOriginal: boolean
  revertToPrevious: () => void
  revertToOriginal: () => void
}

const ImageGenerationContext = createContext<ImageGenerationApi | null>(null)

/** base64 → 이미지 한 장. 이 문자열은 여기서 끝나고 어디에도 저장되지 않는다. */
function blobFromBase64(b64: string, mimeType: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
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

    const inputs = planGenerationInputs(request)
    if (inputs.length > MAX_INPUT_IMAGES) {
      return { blocked: errorTextFor('too_many_inputs') }
    }

    return {
      plan: {
        kind: 'generate',
        pageId: page.id,
        prompt: buildOpenAIImagePrompt(request, inputs),
        size: size.size,
        working: workingImageTarget(page.canvasHeight),
        inputs,
        fingerprint: documentFingerprint(current),
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

    const assetId = createId('asset')
    const current = pageResultOf(studio?.job ?? null, paid.plan.pageId)
    const editing = paid.plan.kind === 'edit' && current !== undefined

    const result: GeneratedPageResult = {
      pageId: paid.plan.pageId,
      assetId,
      model: IMAGE_MODEL,
      quality: IMAGE_QUALITY,
      requestedSize: paid.requestedSize,
      workingSize: sizeLabel({ width: working.width, height: working.height }),
      // 부분수정은 기획서를 고친 것이 아니다. 그래서 "이 결과가 어느 기획서에서
      // 나왔는가"와 얼려 둔 대상 목록은 그대로 이어받는다.
      sourceFingerprint: editing ? current.sourceFingerprint : paid.plan.fingerprint,
      createdAt: Date.now(),
      ...(paid.requestId === undefined ? {} : { requestId: paid.requestId }),
      ...(editing
        ? {
            previousAssetId: current.assetId,
            originalAssetId: current.originalAssetId ?? current.assetId,
            ...(current.targets === undefined ? {} : { targets: current.targets }),
            editCount: (current.editCount ?? 0) + 1,
          }
        : {
            // 첫 생성: 이 순간의 대상 목록을 얼려 둔다. 최초 생성본은 자기 자신.
            originalAssetId: assetId,
            targets: buildEditTargets(getDocument(), studio!.job, paid.plan.pageId),
            editCount: 0,
          }),
    }
    try {
      await putAsset({
        id: assetId,
        blob: working.blob,
        fileName: `ai-${paid.plan.pageId}.png`,
        mimeType: paid.mimeType,
        byteSize: working.blob.size,
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

  /**
   * 되돌리기. 가리키는 번호만 바꾼다 — 그림을 다시 만들지도, 지우지도 않는다.
   * 그래서 외부 호출이 0건이고, 되돌린 뒤에도 방금 만든 그림은 그대로 남는다.
   */
  const revertTo = useCallback(
    (which: 'previous' | 'original') => {
      if (studio === null || currentResult === undefined) return
      const target = which === 'previous' ? currentResult.previousAssetId : currentResult.originalAssetId
      if (target === undefined || target === currentResult.assetId) return
      void studio.recordResult({
        ...currentResult,
        assetId: target,
        // 되돌린 자리에서 또 되돌릴 곳은 없다. 최초 생성본은 그대로 남는다.
        ...(currentResult.previousAssetId === undefined ? {} : { previousAssetId: undefined }),
      } as GeneratedPageResult)
    },
    [studio, currentResult],
  )

  const canRevertPrevious =
    currentResult?.previousAssetId !== undefined && currentResult.previousAssetId !== currentResult.assetId
  const canRevertOriginal =
    currentResult?.originalAssetId !== undefined && currentResult.originalAssetId !== currentResult.assetId

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
            canRevertPrevious,
            canRevertOriginal,
            revertToPrevious: () => revertTo('previous'),
            revertToOriginal: () => revertTo('original'),
            dismiss: () => setState({ kind: 'idle' }),
          },
    [
      studio, state, hasResult, hasKey, view, begin, confirm, retryConversion,
      editTargets, selectedTargetIds, toggleTarget, instructionFor, setInstructionFor,
      canEdit, editBlockedReason, beginEdit, confirmEdit,
      canRevertPrevious, canRevertOriginal, revertTo,
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
