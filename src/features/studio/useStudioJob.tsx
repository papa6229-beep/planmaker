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
  blockOrderOf,
  withBlockOrder,
  toneOf,
  objectToneOf,
  withTone,
  withObjectTone,
  createStudioJob,
  linkProductImage,
  methodOf,
  pageBackgroundOf,
  productImageOf,
  sourceChanged as jobSourceChanged,
  unlinkProductImage,
  withBlockEffects,
  withClonedBlock,
  withOnlyBlocks,
  withMethod,
  withPageBackground,
  withStyleReference,
  withoutStyleReference,
  styleReferenceOf,
  keepReferenceBgOf,
  withKeepReferenceBg,
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
  type BlockOrder,
  type GenerationMethod,
  type StudioBackground,
  type StudioJob,
} from '../../domain/studioJob'
import { DEFAULT_GRAIN, type CompositeEffects } from '../../domain/compositeEffects'
import type { GeneratedPageResult } from '../../domain/imageGeneration'
import type { StudioTextObject } from '../../domain/textObjects'
import { layerOrderOf, reorderLayers } from '../../domain/textLayers'
import type { LayerMove } from '../../domain/layerOrder'
import type { ToneAdjust } from '../../domain/toneAdjust'
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
  /**
   * 레퍼런스의 배경 구성을 그대로 살릴 것인가 (배경 색맞춤 Patch).
   *
   * 꺼 두면 지금까지처럼 색감과 결만 참고한다. 어느 쪽이든 레퍼런스를 그대로
   * 복제하라는 뜻은 아니다.
   */
  keepReferenceBackgroundOf: (pageId: string) => boolean
  setKeepReferenceBackground: (pageId: string, keep: boolean) => Promise<void>
  /**
   * 블록 하나에만 붙는 **생성 전** 주문 (블록별 주문 Patch).
   *
   * 완성 뒤의 부분수정과 목적이 다르다. 저쪽은 이미 만들어진 것을 고치는 일이고,
   * 이쪽은 처음 만들 때 "이 문구는 이런 느낌으로"라고 미리 말해 두는 일이다.
   */
  blockOrderOf: (blockId: string) => BlockOrder
  setBlockOrder: (blockId: string, patch: BlockOrder) => Promise<void>
  /** 이미지별 합성 효과 세기 (§9). 원본 자산은 건드리지 않는다. */
  effectsOf: (blockId: string) => CompositeEffects
  setEffects: (blockId: string, patch: Partial<CompositeEffects>) => void
  /**
   * 복제한 블록에 원본의 설정을 **전부** 옮긴다 (§4, 복제 설정 Patch).
   *
   * 합성 효과만이 아니라 연결한 제품 이미지·블록 주문·블록별 톤까지. 넷 다 기획서
   * 문서 밖에 있어서, 옮겨 주지 않으면 복제한 블록은 빈 채로 태어난다.
   */
  copyBlockSettings: (from: string, to: string) => void
  /** 문서에 없는 블록의 설정을 치운다 (§4). */
  pruneEffects: (liveBlockIds: ReadonlySet<string>) => void
  /** 완성 결과 전체의 그레인 (§9.5). */
  grain: number
  setGrain: (value: number) => void
  /**
   * 완성 결과 전체의 톤 조절 (톤 조절 Patch).
   *
   * 원본 결과 그림은 바뀌지 않는다. 다시 그릴 때 곱하는 값이라, 전부 0으로
   * 내리면 손대기 전 그림이 그대로 돌아온다.
   */
  toneOf: (pageId: string) => ToneAdjust
  setTone: (pageId: string, patch: Partial<ToneAdjust>) => Promise<void>
  /**
   * 오브젝트 **하나에만** 거는 톤 (블록별 톤 Patch).
   *
   * 페이지 전체 톤과 따로 산다. 사진 하나만 어둡게 깔고 페이지 전체를 밝히는
   * 일은 한 벌의 값으로는 되지 않기 때문이다. 그리는 차례는 블록별이 먼저,
   * 전체가 나중이다.
   */
  objectToneOf: (blockId: string) => ToneAdjust
  setObjectTone: (blockId: string, patch: Partial<ToneAdjust>) => Promise<void>
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
  /**
   * 오브젝트를 기울인다 (회전 Patch). 상자 한가운데가 축이다.
   *
   * 이미 기울어져 그려진 그림을 펴 주지는 않는다 — 이 값은 우리가 더 기울이는
   * 각도다.
   */
  spinObject: (pageId: string, blockId: string, angle: number) => void
  /** 이 오브젝트가 뒤에서 몇 번째인가. 끝에 닿은 버튼을 흐리게 하는 데 쓴다. */
  layerPositionOf: (pageId: string, blockId: string) => { index: number; count: number } | null
  /**
   * 결과 화면에서 고른 오브젝트 — 문구든 이미지든 하나뿐이다.
   *
   * 화면에만 있는 값이라 저장되지 않는다. 두 갈래를 따로 두지 않는 것은, 둘 다
   * 골라 둔 상태가 화면에 동시에 나타나면 무엇을 옮기는지 알 수 없기 때문이다.
   */
  selectedObjectBlockId: string | null
  /**
   * 고른 오브젝트 전부 (복수 선택 Patch).
   *
   * `selectedObjectBlockId`는 그중 **마지막에 고른 것**이다. 조작점과 손잡이는
   * 그 하나에만 붙는다 — 여럿에 동시에 붙으면 무엇을 잡은 것인지 화면이 말해
   * 주지 못한다. 끌면 고른 것이 함께 움직인다.
   */
  selectedObjectBlockIds: string[]
  /** `add`가 참이면 고른 것에 더하거나 뺀다 (Shift·⌘ 클릭). */
  selectObject: (blockId: string | null, add?: boolean) => void
  /**
   * 완성 결과에서 오브젝트 하나를 뺀다 (오브젝트 삭제 Patch).
   *
   * **기획서는 손대지 않는다.** 여기서 지우는 것은 이번 결과에 얹힌 그림이고,
   * 기획서의 그 블록은 그대로 남는다 — 다시 생성하면 다시 나온다. 결과 화면에서
   * "이번 장에는 이게 없는 편이 낫다"고 정하는 일이지, 기획을 고치는 일이 아니다.
   *
   * 문구든 이미지든 같은 함수로 지운다. 블록 하나에 오브젝트도 하나라, 어느
   * 목록에 있는지는 부르는 쪽이 알 필요가 없다.
   */
  removeObject: (pageId: string, blockId: string) => Promise<void>
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
  /**
   * 지금 상태를 되돌릴 자리로 표시한다 (결과 되돌리기 Patch).
   *
   * 끌기를 **시작할 때** 한 번 부른다. 그 뒤의 첫 쓰기에서만 칸이 만들어지므로,
   * 손가락을 따라 수십 번 고쳐 써도 `실행 취소` 한 번이면 끌기 전으로 돌아간다.
   * 표시만 하고 아무것도 고치지 않으면 칸도 생기지 않는다.
   */
  markStep: () => void
  undo: () => void
  redo: () => void
  lastChangeAt: number
}

const StudioJobContext = createContext<StudioJobApi | null>(null)

function emptyJob(now: number): StudioJob {
  return createStudioJob(createEmptyDocument(createEmptyProject('')), now, STUDIO_JOB_ID)
}

/**
 * 되돌리기 한 칸 (결과 되돌리기 Patch).
 *
 * 앞선 판은 **제품 이미지 연결만** 담았다. 그래서 결과 화면에서 오브젝트를 옮기고
 * `실행 취소`를 누르면 되돌릴 것이 없다고 판정되어, 아무 관계 없는 **기획서**가 한
 * 단계 뒤로 갔다 — 방금 한 일은 그대로 남고 하지 않은 일이 사라지는, 가장 나쁜
 * 종류의 되돌리기였다.
 *
 * 그래서 편집기 히스토리 **밖에 있는 것 전부**를 한 칸에 담는다. 기획서 문서는
 * 여기 들어오지 않는다 — 그쪽은 편집기가 이미 자기 히스토리로 갖고 있다.
 */
interface StudioStep {
  productImages: Record<string, string>
  textObjects: Record<string, StudioTextObject[]>
  imageObjects: Record<string, StudioTextObject[]>
  objectTones: Record<string, ToneAdjust>
  tones: Record<string, ToneAdjust>
  effects: Record<string, CompositeEffects>
}

/** 되돌리기가 기억하는 칸 수. 넘으면 오래된 것부터 버린다. */
const STUDIO_HISTORY_MAX = 40

function snapshotOf(job: StudioJob): StudioStep {
  return {
    productImages: { ...job.productImages },
    textObjects: { ...job.textObjects },
    imageObjects: { ...job.imageObjects },
    objectTones: { ...job.objectTones },
    tones: { ...job.tones },
    effects: { ...job.effects },
  }
}

export function StudioJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<StudioJob | null>(null)
  const jobRef = useRef<StudioJob | null>(null)
  jobRef.current = job
  // 연결만 담는 얕은 히스토리. 문서 편집은 편집기가 이미 되돌린다.
  const [past, setPast] = useState<StudioStep[]>([])
  const [future, setFuture] = useState<StudioStep[]>([])
  /**
   * 다음 변경이 되돌릴 자리 — 아직 쌓지 않은 것.
   *
   * 끌기 한 번은 수십 번 고쳐 쓴다. 고칠 때마다 쌓으면 `실행 취소` 수십 번이
   * 한 번의 끌기를 되감게 되므로, **끌기가 시작될 때 한 번** 표시해 두고 그
   * 뒤의 첫 쓰기에서만 칸을 만든다.
   */
  const pendingRef = useRef<StudioStep | null>(null)
  const [lastChangeAt, setLastChangeAt] = useState(0)
  /** 고른 편집 오브젝트 — 새로고침에 남을 이유가 없는 화면 상태다. */
  const [selectedObjectBlockIds, setSelectedObjectBlockIds] = useState<string[]>([])

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
    // 표시해 둔 자리가 있으면 그것이 되돌릴 칸이 된다. 표시가 없으면 이 쓰기는
    // 되돌리기와 무관한 일이다 (결과 저장, 파일 채택 같은 것).
    const pending = pendingRef.current
    if (pending !== null) {
      pendingRef.current = null
      setPast((p) => [...p, pending].slice(-STUDIO_HISTORY_MAX))
      setFuture([])
      setLastChangeAt(Date.now())
    }
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

  /** 지금 상태를 되돌릴 자리로 표시한다. 실제 칸은 다음 쓰기에서 만들어진다. */
  const markStep = useCallback(() => {
    const current = jobRef.current
    if (current !== null) pendingRef.current = snapshotOf(current)
  }, [])

  /** 연결을 바꾸면서 되돌릴 자리를 남긴다. */
  const commitLinks = useCallback(
    (next: StudioJob) => {
      markStep()
      void commit(next)
    },
    [commit, markStep],
  )

  /** 되돌리기·다시하기가 칸 하나를 그대로 되돌려 놓는다. 새 칸은 만들지 않는다. */
  const applyStep = useCallback(
    (step: StudioStep) => {
      const current = jobRef.current
      if (!current) return
      pendingRef.current = null
      setLastChangeAt(Date.now())
      void commit({
        ...current,
        productImages: { ...step.productImages },
        textObjects: { ...step.textObjects },
        imageObjects: { ...step.imageObjects },
        objectTones: { ...step.objectTones },
        tones: { ...step.tones },
        effects: { ...step.effects },
        updatedAt: Date.now(),
      })
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
              // 아래 넷은 **파일에 적히기만 하고 읽히지 않았다** (파일 왕복 Patch).
              // 저장한 값이 파일 안에 멀쩡히 들어 있는데 여는 쪽에서 조용히
              // 버렸다는 뜻이고, 아예 안 담는 것보다 나쁘다 — 저장됐다고 믿게
              // 해 놓고 잃기 때문이다.
              keepReferenceBg: { ...state.keepReferenceBg },
              blockOrders: { ...state.blockOrders },
              tones: { ...state.tones },
              objectTones: { ...state.objectTones },
              // 완성본은 파일에 담기지 않는다. 그런데 지금까지 이 자리는 **열기
              // 전에 보던 작업의 결과**를 그대로 물려받았다 — 다른 기획서를 열었는데
              // 앞 기획서의 완성본이 붙어 있는 셈이다. 파일이 말하지 않은 것은
              // 없는 것으로 연다.
              results: {},
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
      keepReferenceBackgroundOf: (pageId) => keepReferenceBgOf(job, pageId),
      setKeepReferenceBackground: (pageId, keep) =>
        mutate((j) => withKeepReferenceBg(j, pageId, keep, Date.now())),
      blockOrderOf: (blockId) => blockOrderOf(job, blockId),
      setBlockOrder: (blockId, patch) => mutate((j) => withBlockOrder(j, blockId, patch, Date.now())),
      effectsOf: (blockId) => blockEffectsOf(job, blockId),
      setEffects: (blockId, patch) => void mutate((j) => withBlockEffects(j, blockId, patch, Date.now())),
      copyBlockSettings: (from, to) => {
        const next = withClonedBlock(job, from, to, Date.now())
        if (next !== job) void commit(next)
      },
      pruneEffects: (liveBlockIds) => {
        const next = withOnlyBlocks(job, liveBlockIds, Date.now())
        if (next !== job) void commit(next)
      },
      grain: job.grain ?? DEFAULT_GRAIN,
      setGrain: (value) =>
        void commit({ ...job, grain: Math.min(1, Math.max(0, value)), updatedAt: Date.now() }),
      toneOf: (pageId) => toneOf(job, pageId),
      setTone: (pageId, patch) => mutate((j) => withTone(j, pageId, patch, Date.now())),
      objectToneOf: (blockId) => objectToneOf(job, blockId),
      setObjectTone: (blockId, patch) => mutate((j) => withObjectTone(j, blockId, patch, Date.now())),
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
      spinObject: (pageId, blockId, angle) =>
        void mutate((j) => {
          const wrapped = ((angle % 360) + 360) % 360
          const patch = { angle: wrapped > 180 ? wrapped - 360 : wrapped }
          return imageObjectsOf(j, pageId).some((o) => o.blockId === blockId)
            ? withImageObject(j, pageId, blockId, patch, Date.now())
            : withTextObject(j, pageId, blockId, patch, Date.now())
        }),
      layerPositionOf: (pageId, blockId) => {
        const order = layerOrderOf(imageObjectsOf(job, pageId), textObjectsOf(job, pageId))
        const index = order.indexOf(blockId)
        return index < 0 ? null : { index, count: order.length }
      },
      selectedObjectBlockId: selectedObjectBlockIds.at(-1) ?? null,
      selectedObjectBlockIds,
      selectObject: (blockId, add = false) =>
        setSelectedObjectBlockIds((current) => {
          if (blockId === null) return []
          if (!add) return current.length === 1 && current[0] === blockId ? current : [blockId]
          // 이미 고른 것을 다시 누르면 뺀다. 마지막에 고른 것이 조작 대상이므로
          // 더할 때는 언제나 끝에 붙인다.
          return current.includes(blockId) ? current.filter((id) => id !== blockId) : [...current, blockId]
        }),
      removeObject: async (pageId, blockId) => {
        await mutate((j) => {
          const now = Date.now()
          const texts = textObjectsOf(j, pageId)
          const images = imageObjectsOf(j, pageId)
          return {
            ...j,
            textObjects: { ...j.textObjects, [pageId]: texts.filter((o) => o.blockId !== blockId) },
            imageObjects: { ...j.imageObjects, [pageId]: images.filter((o) => o.blockId !== blockId) },
            updatedAt: now,
          }
        })
        setSelectedObjectBlockIds((current) => current.filter((id) => id !== blockId))
      },
      sourceChanged: jobSourceChanged(job),
      adoptFile,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      markStep,
      undo: () => {
        const previous = past.at(-1)
        if (previous === undefined) return
        setPast((p) => p.slice(0, -1))
        setFuture((f) => [...f, snapshotOf(job)])
        applyStep(previous)
      },
      redo: () => {
        const next = future.at(-1)
        if (next === undefined) return
        setFuture((f) => f.slice(0, -1))
        setPast((p) => [...p, snapshotOf(job)])
        applyStep(next)
      },
      lastChangeAt,
    }
  }, [
    job, binding, commit, mutate, commitLinks, applyStep, markStep, adoptFile, recordResult,
    past, future, lastChangeAt, selectedObjectBlockIds,
  ])

  // 작업을 읽는 동안에는 편집기를 만들지 않는다.
  if (api === null) return null

  return <StudioJobContext.Provider value={api}>{children}</StudioJobContext.Provider>
}

/** Studio 작업. provider 밖(= 작성기 표면)에서는 `null`. */
export function useStudioJob(): StudioJobApi | null {
  return useContext(StudioJobContext)
}
