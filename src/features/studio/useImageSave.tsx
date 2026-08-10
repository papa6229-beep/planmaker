/**
 * `이미지 저장` 한 번 (실작업 UI 마감 §5).
 *
 * 상단의 저장 버튼이 내놓는 것은 기획서 파일이 아니라 **방금 만든 이미지**다.
 * 작업자가 마지막에 하는 일이고, 여기서 잘못 나가면 앞의 모든 작업이 헛것이
 * 되므로 세 가지를 지킨다.
 *
 *  - 만든 적 없는 페이지는 만들어 내지 않는다. 없으면 없다고 말한다.
 *  - 전부가 아니면 먼저 묻는다. 두 장인 줄 알았는데 한 장만 받는 일이 없도록.
 *  - 외부를 부르지 않는다. 저장은 이미 손에 있는 자산을 내놓는 일이다.
 */

import { useCallback, useState } from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { imageZipFileName, isPartialSave, planImageSave, type ImageSavePlan } from '../../domain/imageSaveFile'
import { collectSavedImages, zipSavedImages } from '../../services/imageSave'
import { downloadBlob } from '../../services/downloadFile'

export type ImageSaveState =
  | { kind: 'idle' }
  /** 아직 아무 페이지도 만들지 않았다. 저장할 것이 없다. */
  | { kind: 'nothing' }
  /** 일부 페이지만 있다 — 사람이 먼저 확인한다. */
  | { kind: 'partial'; plan: ImageSavePlan }
  | { kind: 'saving' }
  | { kind: 'saved'; count: number }
  | { kind: 'failed'; message: string }

export interface ImageSaveApi {
  state: ImageSaveState
  save: () => void
  /** 일부만 저장하겠다고 사람이 답한 뒤. */
  confirmPartial: () => void
  dismiss: () => void
}

export function useImageSave(): ImageSaveApi | null {
  const studio = useStudioJob()
  const { getDocument } = useBriefDocument()
  const [state, setState] = useState<ImageSaveState>({ kind: 'idle' })

  const run = useCallback(
    async (plan: ImageSavePlan, title: string) => {
      setState({ kind: 'saving' })
      try {
        const files = await collectSavedImages(plan)
        if (files.length === 1) downloadBlob(files[0]!.blob, files[0]!.fileName)
        else downloadBlob(await zipSavedImages(files), imageZipFileName(title))
        setState({ kind: 'saved', count: files.length })
      } catch {
        setState({ kind: 'failed', message: '이미지를 저장하지 못했습니다. 다시 시도해 주세요.' })
      }
    },
    [],
  )

  const save = useCallback(() => {
    if (studio === null) return
    const doc = getDocument()
    // 배너를 보면서 누르면 **그 배너 한 장**이다 (배너 저장 Patch). 앞선 판은
    // 원본 이벤트 페이지와 열어 둔 다른 배너까지 압축파일로 내보냈다.
    const onBanner = studio.bannerSpecOf(doc.activePageId) !== null
    const plan = planImageSave(doc, studio.job, onBanner ? { onlyPageId: doc.activePageId } : {})
    if (plan.files.length === 0) {
      setState({ kind: 'nothing' })
      return
    }
    if (isPartialSave(plan)) {
      setState({ kind: 'partial', plan })
      return
    }
    void run(plan, doc.project.title)
  }, [studio, getDocument, run])

  const confirmPartial = useCallback(() => {
    if (state.kind !== 'partial') return
    void run(state.plan, getDocument().project.title)
  }, [state, run, getDocument])

  if (studio === null) return null
  return { state, save, confirmPartial, dismiss: () => setState({ kind: 'idle' }) }
}
