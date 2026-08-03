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
  createStudioJob,
  linkProductImage,
  productImageOf,
  sourceChanged as jobSourceChanged,
  unlinkProductImage,
  withSource,
  withWorkingDoc,
  type StudioJob,
} from '../../domain/studioJob'
import { loadStudioJob, saveStudioJob, STUDIO_JOB_ID } from '../../services/studioStore'
import { createEmptyDocument } from '../../domain/pageSchema'
import { createEmptyProject } from '../../domain/factory'
import type { BriefDocument } from '../../domain/pageSchema'
import type { DocumentBinding } from '../document/useBriefDocument'

export interface StudioJobApi {
  job: StudioJob
  /** 편집기가 읽고 쓰는 곳 — Studio 작업 행. */
  binding: DocumentBinding
  /** 이미지 자리에 연결된 실제 사용 제품 이미지의 자산 id. */
  productImageOf: (blockId: string) => string | undefined
  setProductImage: (blockId: string, assetId: string) => void
  removeProductImage: (blockId: string) => void
  /** 원본 기획서와 작업본이 달라졌는지 (§7). 자동 병합은 하지 않는다. */
  sourceChanged: boolean
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
      // 파일을 여는 것은 편집이 아니라 원본 채택이다. 문서의 신원도 파일이
      // 지니고 있던 그대로 둔다 — Studio 작업은 보관함의 행이 아니다.
      adopt: async (doc: BriefDocument, now: number) => {
        const current = jobRef.current ?? emptyJob(now)
        await commit(withSource(current, doc, now))
      },
    }),
    [commit],
  )

  const api = useMemo<StudioJobApi | null>(() => {
    if (!job) return null
    return {
      job,
      binding,
      productImageOf: (blockId) => productImageOf(job, blockId),
      setProductImage: (blockId, assetId) => commitLinks(linkProductImage(job, blockId, assetId)),
      removeProductImage: (blockId) => commitLinks(unlinkProductImage(job, blockId)),
      sourceChanged: jobSourceChanged(job),
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
  }, [job, binding, commitLinks, applyLinks, past, future, lastChangeAt])

  // 작업을 읽는 동안에는 편집기를 만들지 않는다.
  if (api === null) return null

  return <StudioJobContext.Provider value={api}>{children}</StudioJobContext.Provider>
}

/** Studio 작업. provider 밖(= 작성기 표면)에서는 `null`. */
export function useStudioJob(): StudioJobApi | null {
  return useContext(StudioJobContext)
}
