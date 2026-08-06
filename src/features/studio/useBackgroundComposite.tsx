/**
 * 배경 생성 + 원본 합성 (배경 합성 1차 §6, §7, §8, §9).
 *
 * 기존 `전체 AI 디자인`은 이 파일을 지나가지 않는다. 두 방식은 서로의 결과도
 * 이력도 덮어쓰지 않아야 하므로, 코드에서도 갈라 둔다.
 *
 * 이 방식이 하는 일은 정확히 둘이다.
 *
 *  1. **배경 한 장 만들기** — 브라우저가 연결된 제품 이미지를 읽어 숫자로
 *     바꾸고, 그 숫자와 작업자가 적은 분위기만 보낸다. 원본은 나가지 않는다.
 *     외부 호출 1회, 자동 재시도 0회.
 *  2. **로컬 합성** — 그 배경 위에 원본을 그대로 얹어 `840 × 페이지 높이` 한
 *     장을 만든다. 외부 호출 0회.
 *
 * 2번은 1번 없이도 성립한다. 작업자가 배경을 직접 넣었다면 그대로 저장하면
 * 되고, 그 길에는 결제가 없다 (§5 마지막 줄).
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAssets } from '../assets/useAssets'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { readApiKey } from './apiKeySession'
import { getAsset, putAsset } from '../../services/assetStore'
import { analyzeImageBlob } from '../../services/imageAnalysisRunner'
import { renderComposite } from '../../services/compositeRenderer'
import { collectCompositeSources } from '../../services/compositeSources'
import { backgroundAttachmentIds, buildBackgroundRequest } from '../../domain/backgroundRequest'
import { planLocalComposite, type CompositePlan } from '../../domain/composite'
import { resolveGptImageSize } from '../../domain/gptImageSize'
import { createId } from '../../domain/factory'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import {
  API_KEY_HEADER,
  errorTextFor,
  FIELD_IMAGES,
  FIELD_PROMPT,
  FIELD_SIZE,
  GENERATE_IMAGE_PATH,
  IMAGE_CALLS_PER_CLICK,
  IMAGE_MODEL,
} from '../../domain/imageGeneration'
import type { BriefPage } from '../../domain/pageSchema'

/** 확인창에 그대로 보여 줄 사실들 (§6). */
export interface BackgroundFacts {
  /** GPT가 만드는 것. */
  generates: string
  /** 원본 그대로 합성하는 것. */
  keeps: string
  externalCalls: number
  autoRetries: number
  finalSize: string
}

export type BackgroundState =
  | { kind: 'idle' }
  | { kind: 'confirm'; facts: BackgroundFacts }
  | { kind: 'analyzing' }
  | { kind: 'running' }
  | { kind: 'composing' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

export interface BackgroundCompositeApi {
  state: BackgroundState
  /** 작업자가 적은 배경 분위기. 프롬프트에 그대로 실린다. */
  wish: string
  setWish: (value: string) => void
  /** 확인창을 연다. 막을 이유가 있으면 열지 않고 이유를 말한다. */
  beginGenerate: () => void
  /** 확인창의 실행 — 여기서 딱 한 번 외부로 나간다. */
  confirmGenerate: () => void
  /** 배경을 이미 손에 쥔 채로, 호출 없이 결과를 만든다. */
  saveComposite: () => void
  dismiss: () => void
  /** 지금 페이지의 합성 계획 — 화면이 "몇 장이 얹히는가"를 말할 때 쓴다. */
  plan: CompositePlan | null
}

const BackgroundCompositeContext = createContext<BackgroundCompositeApi | null>(null)

/**
 * 문구가 놓일 자리 — **좌표만**.
 *
 * 원문은 보내지 않는다. AI가 글을 다시 그리는 것이 아니라 그 자리를 비워 두게
 * 하려는 것이고, 문구를 보내면 모델은 그것을 그려 넣으려 한다.
 */
function textRectsOf(page: BriefPage) {
  return page.blocks
    .filter((b) => !getBlockTypeMeta(b.type).requiresAsset && (b.content ?? '').trim().length > 0)
    .map((b) => ({ ...b.position }))
}

/** 이 페이지에서 실제로 얹힐 그림들. */
function imageBlocksOf(page: BriefPage, productImages: Readonly<Record<string, string>>) {
  return page.blocks
    .filter((b) => getBlockTypeMeta(b.type).requiresAsset)
    .map((b) => ({ blockId: b.id, assetId: productImages[b.id] ?? b.assetId, rect: { ...b.position } }))
    .filter((b): b is { blockId: string; assetId: string; rect: BriefPage['blocks'][number]['position'] } =>
      b.assetId !== undefined,
    )
}

export function BackgroundCompositeProvider({ children }: { children: ReactNode }) {
  const studio = useStudioJob()
  const { document: doc, activePageId } = useBriefDocument()
  // 자산 저장소에 직접 쓴 그림은 화면의 주소 목록에 아직 없다. 새로 만든 배경이
  // 새로고침 전까지 보이지 않던 것이 그 때문이었다 — 쓴 뒤에 한 번 다시 읽는다.
  const { loadFromStore } = useAssets()
  const [state, setState] = useState<BackgroundState>({ kind: 'idle' })
  const [wish, setWish] = useState('')

  const page = doc.pages.find((p) => p.id === activePageId) ?? null

  const plan = useMemo<CompositePlan | null>(() => {
    if (studio === null || page === null) return null
    return planLocalComposite({
      page,
      background: studio.backgroundOf(page.id),
      productImages: studio.job.productImages,
      effects: studio.job.effects ?? {},
      grain: studio.grain,
    })
  }, [studio, page])

  /**
   * 합성 결과를 자산으로 남긴다.
   *
   * 기존 `전체 AI 디자인`의 결과 이력과 같은 자리를 쓰지 않는다 — 두 방식이
   * 서로의 이력을 덮어쓰지 않아야 하기 때문이다 (§2 마지막 줄). 합성 결과는
   * 만들 때마다 새 그림이고, 되돌릴 것은 배경과 효과 설정이지 결과가 아니다.
   */
  const saveComposite = useCallback(() => {
    if (studio === null || plan === null || page === null) return
    if (plan.background === undefined) {
      setState({ kind: 'failed', message: '먼저 배경을 넣거나 만들어 주세요.' })
      return
    }
    setState({ kind: 'composing' })
    void (async () => {
      try {
        const sources = await collectCompositeSources(plan)
        const blob = await renderComposite(plan, sources)
        const assetId = createId('asset')
        await putAsset({
          id: assetId,
          blob,
          fileName: `composite-${page.id}.png`,
          mimeType: 'image/png',
          byteSize: blob.size,
        })
        await loadFromStore()
        await studio.recordResult({
          pageId: page.id,
          assetId,
          model: IMAGE_MODEL,
          quality: 'medium',
          // 이 결과는 모델이 만든 것이 아니다. 크기를 그렇게 적어 둔다.
          requestedSize: `${plan.size.width}x${plan.size.height}`,
          workingSize: `${plan.size.width}x${plan.size.height}`,
          sourceFingerprint: '',
          createdAt: Date.now(),
          revisions: [{ assetId, kind: 'initial' }],
          cursor: 0,
          originalAssetId: assetId,
          editCount: 0,
        })
        setState({ kind: 'done', message: '원본 합성으로 결과를 만들었습니다. 외부 호출 0건입니다.' })
      } catch {
        setState({ kind: 'failed', message: '합성 결과를 만들지 못했습니다.' })
      }
    })()
  }, [studio, plan, page, loadFromStore])

  const beginGenerate = useCallback(() => {
    if (studio === null || page === null) return
    if (readApiKey() === null) {
      setState({ kind: 'failed', message: errorTextFor('missing_api_key') })
      return
    }
    const images = imageBlocksOf(page, studio.job.productImages)
    const styleRef = studio.styleReferenceOf(page.id)
    setState({
      kind: 'confirm',
      facts: {
        generates: styleRef === undefined ? '빈 배경 1장' : '스타일 레퍼런스를 참고한 배경 플레이트 1장',
        keeps: images.length > 0 ? `제품·인물·로고 ${images.length}장을 원본 그대로` : '원본 그대로 (연결된 이미지 없음)',
        externalCalls: IMAGE_CALLS_PER_CLICK,
        autoRetries: 0,
        finalSize: `${page.canvasWidth} × ${page.canvasHeight}`,
      },
    })
  }, [studio, page])

  const confirmGenerate = useCallback(() => {
    if (studio === null || page === null) return
    const key = readApiKey()
    if (key === null) {
      setState({ kind: 'failed', message: errorTextFor('missing_api_key') })
      return
    }
    const resolved = resolveGptImageSize(page.canvasWidth, page.canvasHeight)
    if (!resolved.ok) {
      setState({ kind: 'failed', message: resolved.message })
      return
    }

    setState({ kind: 'analyzing' })
    void (async () => {
      try {
        // ── §7: 브라우저에서 읽는다. 여기서 나오는 것은 숫자뿐이다 ───────────
        const inputs = imageBlocksOf(page, studio.job.productImages)
        const analysed = []
        for (const input of inputs) {
          const asset = await getAsset(input.assetId)
          analysed.push({
            blockId: input.blockId,
            rect: input.rect,
            analysis: asset === undefined ? null : await analyzeImageBlob(asset.blob),
          })
        }

        // ── §8: 숫자와 주문만 실은 요청 하나. 원본은 실리지 않는다 ───────────
        const styleRefId = studio.styleReferenceOf(page.id)
        const body = buildBackgroundRequest({
          wish,
          size: { width: page.canvasWidth, height: page.canvasHeight },
          page: null,
          images: analysed,
          // 문구가 놓일 자리도 비워 달라고 말한다. 원문은 가지 않는다.
          reserved: textRectsOf(page),
          requestedSize: resolved.size,
          ...(styleRefId === undefined ? {} : { styleReferenceAssetId: styleRefId }),
        })

        setState({ kind: 'running' })
        const form = new FormData()
        form.set(FIELD_PROMPT, body.prompt)
        form.set(FIELD_SIZE, resolved.size)
        // 붙일 수 있는 그림은 스타일 레퍼런스 하나뿐이다. 제품·인물·로고·종이
        // 컷아웃 원본이 여기 실릴 길은 없다 — 목록을 만드는 함수의 인자가 그것
        // 하나다. 레퍼런스가 없으면 칸이 비고, 서버 함수는 생성 경로로 나간다.
        for (const assetId of backgroundAttachmentIds(styleRefId)) {
          const asset = await getAsset(assetId)
          if (asset === undefined) continue
          // 파일명도 우리가 정한다. 작업자가 올린 원본 파일명은 나가지 않는다.
          form.append(FIELD_IMAGES, new File([asset.blob], 'style-reference.png', { type: 'image/png' }))
        }

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
        const b64 = (payload as { image?: { b64?: string } } | null)?.image?.b64
        if (typeof b64 !== 'string' || b64.length === 0) {
          setState({ kind: 'failed', message: errorTextFor('no_image') })
          return
        }

        // 여기서부터는 이미 결제된 그림이다. 무엇이 실패하든 버리지 않는다.
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'image/png' })

        const assetId = createId('asset')
        await putAsset({
          id: assetId,
          blob,
          fileName: `background-${page.id}.png`,
          mimeType: 'image/png',
          byteSize: blob.size,
        })
        await loadFromStore()
        await studio.setBackground(page.id, {
          assetId,
          source: 'ai',
          requestedSize: resolved.size,
          ...(wish.trim().length === 0 ? {} : { wish: wish.trim() }),
        })
        setState({ kind: 'done', message: '배경을 만들어 이 페이지에 적용했습니다.' })
      } catch {
        // 스스로 다시 부르지 않는다. 다음 호출은 사람의 클릭이다.
        setState({ kind: 'failed', message: errorTextFor('network_error') })
      }
    })()
  }, [studio, page, wish, loadFromStore])

  const api = useMemo<BackgroundCompositeApi | null>(() => {
    if (studio === null) return null
    return {
      state,
      wish,
      setWish,
      beginGenerate,
      confirmGenerate,
      saveComposite,
      dismiss: () => setState({ kind: 'idle' }),
      plan,
    }
  }, [studio, state, wish, beginGenerate, confirmGenerate, saveComposite, plan])

  return <BackgroundCompositeContext.Provider value={api}>{children}</BackgroundCompositeContext.Provider>
}

/** 작업판 밖(= 작성기 표면)에서는 `null`. */
export function useBackgroundComposite(): BackgroundCompositeApi | null {
  return useContext(BackgroundCompositeContext)
}
