/**
 * 배경 후보를 만들고 갈아 끼운다 (배경 후보 Patch, 2026-09-17). 규칙은
 * `domain/backgroundLab.ts`에 있다.
 *
 * 후보 한 장 = 호출 두 번:
 *  1. `scene` — 제품(1~2장)과 분위기 그림(있으면)을 보여 주고 작업자의 말대로 장면을 만든다.
 *     제품이 다시 그려져 나온다 — 괜찮다.
 *  2. `scene-clean` — 받은 장면에서 제품만 지운다.
 * 지운 그림을 작업 크기로 맞춰 후보 목록 맨 앞에 쌓는다. 배경은 **적용할 때만** 바뀐다.
 *
 * 만드는 중인지는 화면 밖에 둔다 — 칸을 접었다 펴도 "만드는 중"이 사라지지 않게.
 */

import { useSyncExternalStore } from 'react'
import { useStudioJob } from './useStudioJob'
import { useImageGeneration } from './useImageGeneration'
import { authHeaders } from './apiKeySession'
import { useBriefDocument } from '../document/useBriefDocument'
import { useAssets } from '../assets/useAssets'
import { createId } from '../../domain/factory'
import { resolveGptImageSize } from '../../domain/gptImageSize'
import { errorTextFor, FIELD_IMAGES, FIELD_INTENT, FIELD_PROMPT, FIELD_SIZE } from '../../domain/imageGeneration'
import { pageResultOf } from '../../domain/studioJob'
import {
  SCENE_CLEAN_NOTE,
  SCENE_DEFAULT_NOTE,
  SCENE_IMAGE_FILE,
  SCENE_PRODUCT_FILE,
  SCENE_REFERENCE_FILE,
  pickSceneProducts,
  sceneReference,
  withCandidate,
  withoutCandidate,
  type BackgroundLab,
  type SceneCandidate,
} from '../../domain/backgroundLab'
import { getAsset, putAsset } from '../../services/assetStore'
import { postImageRequest } from '../../services/imageRequest'
import { shrinkReference } from '../../services/referenceUpload'
import { toWorkingImage, workingImageTarget } from '../../services/workingImage'

export type LabStep = 'scene' | 'clean' | 'save'

interface LabRun {
  busy: { pageId: string; step: LabStep } | null
  error: { pageId: string; message: string } | null
}

let run: LabRun = { busy: null, error: null }
const listeners = new Set<() => void>()
function setRun(next: Partial<LabRun>): void {
  run = { ...run, ...next }
  for (const l of listeners) l()
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function resetBackgroundLabForTests(): void {
  run = { busy: null, error: null }
  for (const l of listeners) l()
}

export interface BackgroundLabApi {
  pageId: string
  lab: BackgroundLab
  /** 보여 줄 제품 수 (0이면 만들 수 없다). */
  productCount: number
  /** 분위기 그림 — 첨부한 것, 없으면 스타일 레퍼런스. */
  reference: { assetId: string; basis: 'attached' | 'style' } | null
  /** 지금 배경의 자산 id. */
  currentAssetId: string | undefined
  busy: LabStep | null
  /** 다른 페이지에서 만드는 중이면 참 — 한 번에 하나만. */
  busyElsewhere: boolean
  error: string | null
  make: (note: string) => Promise<void>
  apply: (candidate: SceneCandidate) => Promise<void>
  remove: (candidateId: string) => Promise<void>
  attach: (file: File) => Promise<void>
  detach: () => Promise<void>
}

async function fileOf(assetId: string, name: string): Promise<File | null> {
  const asset = await getAsset(assetId)
  if (asset === undefined) return null
  const blob = await shrinkReference(asset.blob)
  return new File([blob], name, { type: blob.type || 'image/png' })
}

export function useBackgroundLab(): BackgroundLabApi | null {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { activePageId, getDocument } = useBriefDocument()
  const { storeImage, loadFromStore } = useAssets()
  const state = useSyncExternalStore(subscribe, () => run, () => run)
  if (studio === null) return null

  const pageId = activePageId
  const lab = studio.backgroundLabOf(pageId)
  const page = getDocument().pages.find((p) => p.id === pageId)
  const products = page === undefined ? [] : pickSceneProducts(page, studio.job.productImages)
  const reference = sceneReference(lab, studio.styleReferenceOf(pageId))
  const currentAssetId = studio.backgroundOf(pageId)?.assetId

  const fail = (message: string) => setRun({ busy: null, error: { pageId, message } })

  const make = async (note: string) => {
    if (run.busy !== null) return
    const doc = getDocument()
    const target = doc.pages.find((p) => p.id === pageId)
    if (target === undefined) return
    const job = studio.currentJob()
    const productIds = pickSceneProducts(target, job.productImages)
    if (productIds.length === 0) {
      fail('이미지 블록에 실제 제품 이미지를 먼저 연결해 주세요.')
      return
    }
    const size = resolveGptImageSize(target.canvasWidth, target.canvasHeight)
    if (!size.ok) {
      fail(size.message)
      return
    }
    const auth = authHeaders()
    if (auth === null) {
      fail(errorTextFor('missing_api_key'))
      return
    }
    const ref = sceneReference(studio.backgroundLabOf(pageId), studio.styleReferenceOf(pageId))
    const wish = note.trim()
    setRun({ busy: { pageId, step: 'scene' }, error: null })
    try {
      // ── 1. 제품을 보고 장면을 만든다 ────────────────────────────────────
      const first = new FormData()
      first.set(FIELD_PROMPT, wish.length > 0 ? wish : SCENE_DEFAULT_NOTE)
      first.set(FIELD_SIZE, size.size)
      first.set(FIELD_INTENT, 'scene')
      for (const [i, assetId] of productIds.entries()) {
        const file = await fileOf(assetId, SCENE_PRODUCT_FILE(i + 1))
        if (file === null) {
          fail('연결한 제품 이미지를 찾지 못했습니다. 이미지 블록에 다시 연결해 주세요.')
          return
        }
        first.append(FIELD_IMAGES, file)
      }
      if (ref !== null) {
        const file = await fileOf(ref.assetId, SCENE_REFERENCE_FILE)
        if (file !== null) first.append(FIELD_IMAGES, file)
      }
      const scene = await postImageRequest(first, auth, 'scene')
      if (!('blob' in scene)) {
        fail(errorTextFor(scene.code))
        return
      }

      // ── 2. 그 장면에서 제품만 지운다 ────────────────────────────────────
      setRun({ busy: { pageId, step: 'clean' } })
      const second = new FormData()
      second.set(FIELD_PROMPT, SCENE_CLEAN_NOTE)
      second.set(FIELD_SIZE, size.size)
      second.set(FIELD_INTENT, 'scene-clean')
      second.append(FIELD_IMAGES, new File([scene.blob], SCENE_IMAGE_FILE, { type: scene.mimeType }))
      const clean = await postImageRequest(second, auth, 'scene-clean')
      if (!('blob' in clean)) {
        fail(`장면은 만들었지만 제품을 지우지 못했습니다 — ${errorTextFor(clean.code)}`)
        return
      }

      // ── 3. 후보로 쌓는다 ───────────────────────────────────────────────
      setRun({ busy: { pageId, step: 'save' } })
      const working = await toWorkingImage(clean.blob, workingImageTarget(target.canvasHeight))
      const assetId = createId('asset')
      await putAsset({
        id: assetId,
        blob: working.blob,
        fileName: `scene-${pageId}.png`,
        mimeType: clean.mimeType,
        byteSize: working.blob.size,
      })
      // 저장소에 직접 넣은 그림은 화면 주소가 아직 없다 — 다시 만든다 (배경 합성과 같은 길).
      await loadFromStore()
      await studio.updateBackgroundLab(pageId, (current) =>
        withCandidate(
          current,
          {
            id: createId('cand'),
            assetId,
            note: wish,
            basis: ref?.basis ?? 'none',
            createdAt: Date.now(),
            requestedSize: clean.requestedSize ?? size.size,
          },
          studio.currentJob().backgrounds?.[pageId]?.assetId,
        ),
      )
      setRun({ busy: null, error: null })
    } catch {
      fail(errorTextFor('network_error'))
    }
  }

  const apply = async (candidate: SceneCandidate) => {
    const before = studio.currentJob().backgrounds?.[pageId]
    if (before?.assetId === candidate.assetId) return
    studio.markStep()
    // 밀려나는 배경도 후보로 남긴다 — 번갈아 끼워 보며 고르는 것이 이 칸의 일이다.
    if (before !== undefined) {
      await studio.updateBackgroundLab(pageId, (current) =>
        current.candidates.some((c) => c.assetId === before.assetId)
          ? current
          : withCandidate(
              current,
              {
                id: createId('cand'),
                assetId: before.assetId,
                note: '',
                basis: 'previous',
                createdAt: Date.now(),
                ...(before.requestedSize === undefined ? {} : { requestedSize: before.requestedSize }),
              },
              candidate.assetId,
            ),
      )
    }
    await studio.setBackground(pageId, {
      assetId: candidate.assetId,
      source: 'ai',
      createdAt: Date.now(),
      ...(candidate.requestedSize === undefined ? {} : { requestedSize: candidate.requestedSize }),
      ...(candidate.note.length > 0 ? { wish: candidate.note } : {}),
      // 배너에서 옮겨 둔 자리는 그대로 — 그림만 바뀐다.
      ...(before?.rect === undefined ? {} : { rect: before.rect }),
    })
    if (generation !== null && pageResultOf(studio.currentJob(), pageId) !== undefined) {
      await generation.recomposePage(pageId)
    }
  }

  const remove = (candidateId: string) =>
    studio.updateBackgroundLab(pageId, (current) => withoutCandidate(current, candidateId))

  const attach = async (file: File) => {
    const asset = await storeImage(file)
    if (asset === null) return
    await studio.updateBackgroundLab(pageId, (current) => ({ ...current, referenceAssetId: asset.id }))
  }

  const detach = () =>
    studio.updateBackgroundLab(pageId, (current) => {
      const { referenceAssetId: _gone, ...rest } = current
      return rest
    })

  return {
    pageId,
    lab,
    productCount: products.length,
    reference,
    currentAssetId,
    busy: state.busy?.pageId === pageId ? state.busy.step : null,
    busyElsewhere: state.busy !== null && state.busy.pageId !== pageId,
    error: state.error?.pageId === pageId ? state.error.message : null,
    make,
    apply,
    remove,
    attach,
    detach,
  }
}
