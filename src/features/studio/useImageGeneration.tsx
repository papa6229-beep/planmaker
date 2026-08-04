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
import { clearApiKey, readApiKey, saveApiKey } from './apiKeySession'
import { buildGenerationRequest } from '../../domain/generationRequest'
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
import { getAllAssets, putAsset } from '../../services/assetStore'
import { renderPreviewPng } from '../../services/previewRenderer'
import { createId } from '../../domain/factory'

/** 중앙 패널이 무엇을 보여 주는가. 참고 이미지 보기와는 아무 관계가 없다. */
export type StudioCenterView = 'brief' | 'compare'

interface GenerationPlan {
  pageId: string
  prompt: string
  size: string
  inputs: GenerationInputImage[]
  fingerprint: string
}

export type GenerationState =
  | { kind: 'idle' }
  /** 사람이 무엇에 얼마를 쓰는지 보고 누르는 자리. */
  | { kind: 'confirm'; plan: GenerationPlan; needsKey: boolean }
  | { kind: 'running' }
  | { kind: 'failed'; message: string }
  /** 호출하기 전에 멈춘 것 — 아직 아무것도 쓰지 않았다. */
  | { kind: 'blocked'; message: string }

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
  dismiss: () => void
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
        pageId: page.id,
        prompt: buildOpenAIImagePrompt(request, inputs),
        size: size.size,
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
        const blob = blobFromBase64(b64, mimeType)
        const assetId = createId('asset')
        const result: GeneratedPageResult = {
          pageId: plan.pageId,
          assetId,
          model: IMAGE_MODEL,
          quality: IMAGE_QUALITY,
          requestedSize: body?.metadata?.requestedSize ?? plan.size,
          sourceFingerprint: plan.fingerprint,
          createdAt: Date.now(),
          ...(body?.metadata?.requestId === undefined ? {} : { requestId: body.metadata.requestId }),
        }
        try {
          await putAsset({
            id: assetId,
            blob,
            fileName: `ai-${plan.pageId}.png`,
            mimeType,
            byteSize: blob.size,
          })
          await studio?.recordResult(result)
        } catch {
          setState({ kind: 'failed', message: errorTextFor('save_failed') })
          return
        }

        setState({ kind: 'idle' })
        setView('compare')
      } catch {
        // 스스로 다시 부르지 않는다. 다음 호출은 사람의 클릭이다.
        setState({ kind: 'failed', message: errorTextFor('network_error') })
      } finally {
        runningRef.current = false
      }
    },
    [collectImages, studio],
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
            dismiss: () => setState({ kind: 'idle' }),
          },
    [studio, state, hasResult, hasKey, view, begin, confirm],
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
