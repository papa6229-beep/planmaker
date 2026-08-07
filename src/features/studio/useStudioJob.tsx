/**
 * Studio 작업 바인딩 (이미지 생성기 0단계 §3, §7).
 *
 * 작업판은 작성기와 같은 편집기를 쓰지만 저장하는 곳이 다르다. 이 provider가
 * 그 차이를 전부 맡는다.
 *
 *  - 작업 한 건을 Studio 전용 저장소에서 읽어 두고, 그 안의 작업본을
 *    `DocumentBinding`으로 내준다. 그래서 작성기 보관함의 어떤 행도 이 화면
 *    때문에 바뀌지 않는다.
 *  - 파일을 열면(`adopt`) 그 문서를 이 작업의 *원본*으로 채택한다. 원본은 그
 *    뒤로 다시 쓰이지 않으므로, 작업본이 편집돼도 원본은 남고 둘이 달라졌다는
 *    사실을 판정할 수 있다.
 *  - 디자인팀이 연결한 실제 사용 제품 이미지는 기획서 문서가 아니라 여기에만
 *    적힌다.
 *
 * provider 밖에서는 `useStudioJob()`이 `null`을 돌려준다. 작성기 표면은 이
 * provider를 아예 마운트하지 않으므로, 같은 캔버스 컴포넌트가 두 표면에서
 * 그대로 쓰이면서도 작성기에는 Studio가 조금도 나타나지 않는다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  blockEffectsOf,
  createStudioJob,
  linkProductImage,
  methodOf,
  pageBackgroundOf,
  productImageOf,
  sourceChanged as jobSourceChanged,
  unlinkProductImage,
  withBlockEffects,
  withClonedEffects,
  withOnlyBlocks,
  withMethod,
  withPageBackground,
  withStyleReference,
  withoutStyleReference,
  styleReferenceOf,
  imageObjectsOf,
  withImageObject,
  withImageObjects,
  textObjectsOf,
  withTextObject,
  withTextObjects,
  withPageResult,
  withSource,
  withWorkingDoc,
  withoutPageBackground,
  type GenerationMethod,
  type StudioBackground,
  type StudioJob,
} from '../../domain/studioJob'
import { DEFAULT_GRAIN, type CompositeEffects } from '../../domain/compositeEffects'
import type { GeneratedPageResult } from '../../domain/imageGeneration'
import type { StudioTextObject } from '../../domain/textObjects'
import { layerOrderOf, reorderLayers } from '../../domain/textLayers'
import type { LayerMove } from '../../domain/layerOrder'
import type { LayoutRect } from '../../domain/imageLayout'
import { loadStudioJob, saveStudioJob, STUDIO_JOB_ID } from '../../services/studioStore'
import type { StudioFileState } from '../../domain/studioFile'
import { createEmptyDocument } from '../../domain/pageSchema'
import { createEmptyProject } from '../../domain/factory'
import type { BriefDocument } from '../../domain/pageSchema'
import type { DocumentBinding } from '../document/useBriefDocument'

export interface StudioJobApi {
  job: StudioJob
  /**
   * 지금 저장된 작업 — 렌더에 얼린 값이 아니라 **가장 최근 값**이다.
   *
   * 끌어 옮기는 동안처럼 한 렌더의 값이 손에 남아 있는 자리에서, 그 값으로 다시
   * 합치면 방금 옮긴 자리가 아니라 옮기기 전 자리가 실린다.
   */
  currentJob: () => StudioJob
  /** 편집기가 읽고 쓰는 곳 — Studio 작업 행. */
  binding: DocumentBinding
  /** 이미지 자리에 연결된 실제 사용 제품 이미지의 자산 id. */
  productImageOf: (blockId: string) => string | undefined
  setProductImage: (blockId: string, assetId: string) => void
  removeProductImage: (blockId: string) => void
  /**
   * 페이지별 배경 레이어 (배경 합성 1차 §5).
   *
   * 참고 이미지와 달리 최종 결과에 실제로 출력되므로, 기획서 문서가 아니라
   * Studio 작업에만 적힌다 — 작성기가 만든 기획서는 이 때문에 바뀌지 않는다.
   */
  backgroundOf: (pageId: string) => StudioBackground | undefined
  setBackground: (pageId: string, background: StudioBackground) => Promise<void>
  removeBackground: (pageId: string) => Promise<void>
  /**
   * 페이지별 디자인 스타일 레퍼런스 (스타일 레퍼런스 Patch).
   *
   * 작성기의 참고 이미지와 다른 자료다 — 그쪽은 배치를 눈으로 맞추는 용도이고
   * 결과에 남지 않지만, 이쪽은 AI에게 실제로 보내는 한 장이다.
   */
  styleReferenceOf: (pageId: string) => string | undefined
  setStyleReference: (pageId: string, assetId: string) => Promise<void>
  removeStyleReference: (pageId: string) => Promise<void>
  /** 이미지별 합성 효과 세기 (§9). 원본 자산은 건드리지 않는다. */
  effectsOf: (blockId: string) => CompositeEffects
  setEffects: (blockId: string, patch: Partial<CompositeEffects>) => void
  /** 복제한 블록에 원본의 설정을 옮긴다 (§4). */
  copyEffects: (from: string, to: string) => void
  /** 문서에 없는 블록의 설정을 치운다 (§4). */
  pruneEffects: (liveBlockIds: ReadonlySet<string>) => void
  /** 완성 결과 전체의 그레인 (§9.5). */
  grain: number
  setGrain: (value: number) => void
  /** 이 작업이 고른 생성 방식 (§6). */
  method: GenerationMethod
  setMethod: (method: GenerationMethod) => void
  /**
   * 이 페이지의 꾸며진 문구 오브젝트 (텍스트 오브젝트 Patch §1, §2).
   *
   * 생성 결과 안에 합쳐지지 않고 따로 남아 있다. 옮기기·크기 변경은 이 값만
   * 바꾸고 외부를 부르지 않는다.
   */
  textObjectsOf: (pageId: string) => StudioTextObject[]
  setTextObjects: (pageId: string, objects: readonly StudioTextObject[]) => Promise<void>
  moveTextObject: (pageId: string, blockId: string, rect: LayoutRect) => void
  replaceTextObjectAsset: (pageId: string, blockId: string, assetId: string) => Promise<void>
  /**
   * 이 페이지의 이미지 편집 오브젝트 (블록 연결 Patch).
   *
   * 기획서의 이미지·컷아웃 블록 하나당 하나다. 문구 오브젝트와 같은 모양을 쓰고
   * 같은 제스처로 움직이지만, 옮긴 자리는 다시 합칠 때 그 블록의 자리로 쓰인다 —
   * 종이 테두리와 그림자도 그 자리에서 다시 그려지므로 함께 따라온다.
   */
  imageObjectsOf: (pageId: string) => StudioTextObject[]
  setImageObjects: (pageId: string, objects: readonly StudioTextObject[]) => Promise<void>
  moveImageObject: (pageId: string, blockId: string, rect: LayoutRect) => void
  /**
   * 결과 화면의 앞뒤 순서를 바꾼다 (레이어 순서 Patch).
   *
   * 이미지·컷아웃과 문구가 **한 줄에** 선다. 기획서는 손대지 않는다 — 앞뒤
   * 겹침은 결과를 보면서 정할 일이고, 기획서는 "무엇을 어디에"를 적는 곳이다.
   */
  reorderObject: (pageId: string, blockId: string, move: LayerMove) => Promise<void>
  /** 이 오브젝트가 뒤에서 몇 번째인가. 끝에 닿은 버튼을 흐리게 하는 데 쓴다. */
  layerPositionOf: (pageId: string, blockId: string) => { index: number; count: number } | null
  /**
   * 결과 화면에서 고른 오브젝트 — 문구든 이미지든 하나뿐이다.
   *
   * 화면에만 있는 값이라 저장되지 않는다. 두 갈래를 따로 두지 않는 것은, 둘 다
   * 골라 둔 상태가 화면에 동시에 나타나면 무엇을 옮기는지 알 수 없기 때문이다.
   */
  selectedObjectBlockId: string | null
  selectObject: (blockId: string | null) => void
  /** 원본 기획서와 작업본이 달라졌는지 (§7). 자동 병합은 하지 않는다. */
  sourceChanged: boolean
  /**
   * 파일 하나를 이 작업으로 채택한다 — 문서, 원본 지문, 제품 이미지 연결까지 한
   * 번에. Studio 상태가 없는 보통 기획서 파일이면 `state`가 `null`이고, 그때는
   * 지금까지처럼 새 원본으로 시작하며 연결은 비어 있다 (Studio 파일 §4.4).
   *
   * 저장이 끝난 뒤에야 화면을 바꾸는 것은 호출부의 몫이다.
   */
  adoptFile: (doc: BriefDocument, state: StudioFileState | null) => Promise<void>
  /**
   * 한 페이지의 AI 생성 결과를 남긴다 (1단계 §11). 저장이 끝난 뒤에야 화면이
   * 결과를 갖는다 — 새로고침하면 사라지는 결과를 보여 주지 않기 위해서다.
   */
  recordResult: (result: GeneratedPageResult) => Promise<void>
  /**
   * 제품 이미지 연결의 실행 취소·다시 실행.
   *
   * 연결은 기획서 문서 밖에 있으므로 편집기의 히스토리에 들어가지 않는다. 그래서
   * 여기서 따로 쌓고, 상단바는 "마지막에 일어난 일"을 되돌린다 — 그 판정을 위해
   * 마지막 변경 시각을 함께 내놓는다 (첫 사용 흐름 §7).
   */
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  lastChangeAt: number
}

const StudioJobContext = createContext<StudioJobApi | null>(null)

function emptyJob(now: number): StudioJob {
  return createStudioJob(createEmptyDocument(createEmptyProject('')), now, STUDIO_JOB_ID)
}

type Links = Record<string, string>

export function StudioJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<StudioJob | null>(null)
  const jobRef = useRef<StudioJob | null>(null)
  jobRef.current = job
  // 연결만 담는 얕은 히스토리. 문서 편집은 편집기가 이미 되돌린다.
  const [past, setPast] = useState<Links[]>([])
  const [future, setFuture] = useState<Links[]>([])
  const [lastChangeAt, setLastChangeAt] = useState(0)
  /** 고른 편집 오브젝트 — 새로고침에 남을 이유가 없는 화면 상태다. */
  const [selectedObjectBlockId, setSelectedObjectBlockId] = useState<string | null>(null)

  // 작업을 먼저 읽고 나서 편집기를 마운트한다. 편집기는 마운트 순간 한 번
  // `binding.load()`를 호출하므로, 그 전에 작업이 손에 있어야 새로고침 복원이
  // 빈 문서로 덮이지 않는다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let loaded: StudioJob | null = null
      try {
        loaded = await loadStudioJob(STUDIO_JOB_ID)
      } catch {
        // 저장소를 읽지 못하면 빈 작업에서 시작한다.
      }
      if (!cancelled) setJob(loaded ?? emptyJob(Date.now()))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 작업을 바꾸고 즉시 저장한다. 화면과 저장소가 어긋나지 않게 한 곳에서. */
  const commit = useCallback(async (next: StudioJob) => {
    jobRef.current = next
    setJob(next)
    await saveStudioJob(next)
  }, [])

  /**
   * 지금 저장된 작업을 읽어 고친다.
   *
   * `job`이 아니라 `jobRef`를 읽는 것이 요점이다. 한 흐름에서 여러 번 고치는
   * 자리(생성 뒤 배경·문구 오브젝트·결과를 잇달아 쓰는 길)에서 메모된 `job`을
   * 쓰면 뒤의 쓰기가 앞의 쓰기를 지운다 — 결과가 저장됐다가 사라진다.
   */
  const mutate = useCallback(
    (fn: (current: StudioJob) => StudioJob): Promise<void> => {
      const current = jobRef.current
      if (current === null) return Promise.resolve()
      return commit(fn(current))
    },
    [commit],
  )

  /** 연결을 바꾸면서 되돌릴 자리를 남긴다. */
  const commitLinks = useCallback(
    (next: StudioJob) => {
      const before = jobRef.current?.productImages ?? {}
      setPast((p) => [...p, before])
      setFuture([])
      setLastChangeAt(Date.now())
      void commit(next)
    },
    [commit],
  )

  const applyLinks = useCallback(
    (links: Links) => {
      const current = jobRef.current
      if (!current) return
      setLastChangeAt(Date.now())
      void commit({ ...current, productImages: links })
    },
    [commit],
  )

  const binding = useMemo<DocumentBinding>(
    () => ({
      load: async () => jobRef.current?.doc ?? null,
      save: async (doc: BriefDocument, now: number) => {
        const current = jobRef.current
        if (!current) return
        await commit(withWorkingDoc(current, doc, now))
      },
    }),
    [commit],
  )

  /**
   * 파일을 여는 것은 편집이 아니라 원본 채택이다. 문서의 신원도 파일이 지니고
   * 있던 그대로 둔다 — Studio 작업은 보관함의 행이 아니다. 파일이 Studio 상태를
   * 지니고 있으면 그 안의 원본 지문과 제품 이미지 연결을 함께 되살린다.
   *
   * 편집과 달리 여기서는 저장이 **먼저**다. 보통의 편집은 화면을 먼저 바꾸고
   * 저장이 뒤따라도 잃을 것이 다음 한 글자뿐이지만, 채택은 하던 작업 전체를
   * 물러나게 한다. 저장이 실패했는데 화면만 넘어가 있으면, 새 작업은 어디에도
   * 없고 하던 작업은 화면에서 사라진 상태가 된다.
   */
  const adoptFile = useCallback(
    async (doc: BriefDocument, state: StudioFileState | null) => {
      const now = Date.now()
      const base = jobRef.current ?? emptyJob(now)
      const adopted = withSource(base, doc, now, state?.source?.fileName)
      const next: StudioJob =
        state === null
          ? adopted
          : {
              ...adopted,
              // 파일이 기억한 원본 지문을 그대로 쓴다. 저장할 때 이미 달라져
              // 있었다면 그 사실까지 복원되어야 판정이 거짓말을 하지 않는다.
              source: adopted.source === null ? null : { ...adopted.source, fingerprint: state.source?.fingerprint ?? adopted.source.fingerprint },
              productImages: { ...state.productImages },
              // 예전 판 파일에는 이 넷이 없다. 그때는 빈 값이 맞는 복원이다.
              backgrounds: { ...state.backgrounds },
              effects: { ...state.effects },
              styleRefs: { ...state.styleRefs },
              // 편집 오브젝트의 자리와 크기도 파일이 기억한 그대로 돌아온다 —
              // 빼면 파일을 다시 연 순간 옮겨 둔 문구와 이미지가 제자리로 튄다.
              textObjects: { ...state.textObjects },
              imageObjects: { ...state.imageObjects },
              ...(state.grain === undefined ? {} : { grain: state.grain }),
              ...(state.method === undefined ? {} : { method: state.method }),
            }
      await saveStudioJob(next)
      setPast([])
      setFuture([])
      jobRef.current = next
      setJob(next)
    },
    [],
  )

  /**
   * 결과는 편집이 아니므로 되돌리기 자리에 쌓지 않는다. 저장이 먼저이고, 저장이
   * 실패하면 화면도 결과를 갖지 않는다.
   */
  const recordResult = useCallback(async (result: GeneratedPageResult) => {
    const current = jobRef.current
    if (current === null) return
    const next = withPageResult(current, result, Date.now())
    await saveStudioJob(next)
    jobRef.current = next
    setJob(next)
  }, [])

  const api = useMemo<StudioJobApi | null>(() => {
    if (!job) return null
    return {
      job,
      currentJob: () => jobRef.current ?? job,
      binding,
      recordResult,
      productImageOf: (blockId) => productImageOf(job, blockId),
      setProductImage: (blockId, assetId) => commitLinks(linkProductImage(job, blockId, assetId)),
      removeProductImage: (blockId) => commitLinks(unlinkProductImage(job, blockId)),
      backgroundOf: (pageId) => pageBackgroundOf(job, pageId),
      // 배경은 값을 치렀거나 작업자가 고른 그림이다. 저장이 먼저이고, 저장이
      // 실패하면 화면도 배경을 갖지 않는다 — 새로고침에 사라질 것을 보여 주지
      // 않기 위해서다.
      setBackground: (pageId, background) => mutate((j) => withPageBackground(j, pageId, background, Date.now())),
      removeBackground: (pageId) => mutate((j) => withoutPageBackground(j, pageId, Date.now())),
      styleReferenceOf: (pageId) => styleReferenceOf(job, pageId),
      setStyleReference: (pageId, assetId) => mutate((j) => withStyleReference(j, pageId, assetId, Date.now())),
      removeStyleReference: (pageId) => mutate((j) => withoutStyleReference(j, pageId, Date.now())),
      effectsOf: (blockId) => blockEffectsOf(job, blockId),
      setEffects: (blockId, patch) => void mutate((j) => withBlockEffects(j, blockId, patch, Date.now())),
      copyEffects: (from, to) => {
        const next = withClonedEffects(job, from, to, Date.now())
        if (next !== job) void commit(next)
      },
      pruneEffects: (liveBlockIds) => {
        const next = withOnlyBlocks(job, liveBlockIds, Date.now())
        if (next !== job) void commit(next)
      },
      grain: job.grain ?? DEFAULT_GRAIN,
      setGrain: (value) =>
        void commit({ ...job, grain: Math.min(1, Math.max(0, value)), updatedAt: Date.now() }),
      method: methodOf(job),
      setMethod: (next) => void commit(withMethod(job, next, Date.now())),
      textObjectsOf: (pageId) => textObjectsOf(job, pageId),
      setTextObjects: (pageId, objects) => mutate((j) => withTextObjects(j, pageId, objects, Date.now())),
      // 옮기기는 손가락을 따라 수십 번 일어난다. 화면이 먼저 따라가고 저장이
      // 뒤따르며, 외부를 부르는 자리는 없다 (§2 마지막 줄).
      moveTextObject: (pageId, blockId, rect) =>
        void mutate((j) => withTextObject(j, pageId, blockId, { rect }, Date.now())),
      replaceTextObjectAsset: (pageId, blockId, assetId) =>
        mutate((j) => withTextObject(j, pageId, blockId, { assetId }, Date.now())),
      imageObjectsOf: (pageId) => imageObjectsOf(job, pageId),
      setImageObjects: (pageId, objects) => mutate((j) => withImageObjects(j, pageId, objects, Date.now())),
      moveImageObject: (pageId, blockId, rect) =>
        void mutate((j) => withImageObject(j, pageId, blockId, { rect }, Date.now())),
      reorderObject: (pageId, blockId, move) =>
        mutate((j) => {
          const images = imageObjectsOf(j, pageId)
          const texts = textObjectsOf(j, pageId)
          const next = reorderLayers(layerOrderOf(images, texts), blockId, move)
          const rank = new Map(next.map((id, i) => [id, i]))
          const now = Date.now()
          return {
            ...j,
            imageObjects: { ...j.imageObjects, [pageId]: images.map((o) => ({ ...o, layer: rank.get(o.blockId) ?? o.layer })) },
            textObjects: { ...j.textObjects, [pageId]: texts.map((o) => ({ ...o, layer: rank.get(o.blockId) ?? o.layer })) },
            updatedAt: now,
          }
        }),
      layerPositionOf: (pageId, blockId) => {
        const order = layerOrderOf(imageObjectsOf(job, pageId), textObjectsOf(job, pageId))
        const index = order.indexOf(blockId)
        return index < 0 ? null : { index, count: order.length }
      },
      selectedObjectBlockId,
      selectObject: setSelectedObjectBlockId,
      sourceChanged: jobSourceChanged(job),
      adoptFile,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undo: () => {
        const previous = past.at(-1)
        if (previous === undefined) return
        setPast((p) => p.slice(0, -1))
        setFuture((f) => [...f, job.productImages])
        applyLinks(previous)
      },
      redo: () => {
        const next = future.at(-1)
        if (next === undefined) return
        setFuture((f) => f.slice(0, -1))
        setPast((p) => [...p, job.productImages])
        applyLinks(next)
      },
      lastChangeAt,
    }
  }, [
    job, binding, commit, mutate, commitLinks, applyLinks, adoptFile, recordResult,
    past, future, lastChangeAt, selectedObjectBlockId,
  ])

  // 작업을 읽는 동안에는 편집기를 만들지 않는다.
  if (api === null) return null

  return <StudioJobContext.Provider value={api}>{children}</StudioJobContext.Provider>
}

/** Studio 작업. provider 밖(= 작성기 표면)에서는 `null`. */
export function useStudioJob(): StudioJobApi | null {
  return useContext(StudioJobContext)
}
