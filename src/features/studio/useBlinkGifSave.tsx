/**
 * `깜빡이는 버튼 GIF` 한 번 (깜빡이는 버튼 Patch).
 *
 * **선택 기능이다.** 기본 저장은 지금까지처럼 PNG이고, 이 버튼을 눌러야 GIF가
 * 나온다. 작업자의 말 그대로다 — "저 깜빡이는 버튼 난 극혐한다고. 그래서 선택
 * 기능으로 놔둬야 해."
 *
 * 외부 호출이 없다. 이미 만들어 둔 완성본 PNG를 읽어 버튼 자리만 밝기를 흔들고
 * 두 프레임으로 엮을 뿐이다.
 *
 * 지금 보고 있는 페이지 하나만 만든다. 이벤트 페이지든 배너든 같다 — 버튼이 앉은
 * 자리는 그 페이지의 조각이 알고 있다.
 */

import { useCallback, useState } from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { pageResultOf } from '../../domain/studioJob'
import { BLINK_DEFAULT_STRENGTH } from '../../domain/buttonBlink'
import { imageBaseName } from '../../domain/imageSaveFile'
import type { LayoutRect } from '../../domain/imageLayout'
import { getAsset } from '../../services/assetStore'
import { renderBlinkGif } from '../../services/blinkGif'
import { downloadBlob } from '../../services/downloadFile'

export type BlinkGifState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'saved' }
  /** 버튼 조각이 없어 깜빡일 것이 없다. */
  | { kind: 'no-button' }
  | { kind: 'failed'; message: string }

export interface BlinkGifApi {
  state: BlinkGifState
  /** 이 페이지에 깜빡일 버튼이 몇 개 있는가. 0이면 버튼을 내놓지 않는다. */
  buttonCount: number
  strength: number
  setStrength: (value: number) => void
  save: () => void
  dismiss: () => void
}

/** 이 페이지에서 CTA 버튼 조각이 앉은 자리들 — 완성본 좌표 그대로. */
export function buttonRectsOf(
  blocks: readonly { id: string; type: string }[],
  objects: readonly { blockId: string; rect: LayoutRect }[],
): LayoutRect[] {
  const cta = new Set(blocks.filter((b) => b.type === 'cta_button').map((b) => b.id))
  return objects.filter((o) => cta.has(o.blockId)).map((o) => o.rect)
}

export function useBlinkGifSave(): BlinkGifApi | null {
  const studio = useStudioJob()
  const { pages, activePageId, getDocument } = useBriefDocument()
  const [state, setState] = useState<BlinkGifState>({ kind: 'idle' })
  const [strength, setStrength] = useState(BLINK_DEFAULT_STRENGTH)

  const page = pages.find((p) => p.id === activePageId)
  const rects =
    studio === null || page === undefined
      ? []
      : buttonRectsOf(page.blocks, [
          ...studio.textObjectsOf(activePageId),
          ...studio.imageObjectsOf(activePageId),
        ])

  const save = useCallback(() => {
    if (studio === null) return
    const doc = getDocument()
    const target = doc.pages.find((p) => p.id === doc.activePageId)
    const result = pageResultOf(studio.currentJob(), doc.activePageId)
    if (target === undefined || result === undefined) {
      setState({ kind: 'failed', message: '먼저 완성본을 만들어 주세요.' })
      return
    }
    const buttons = buttonRectsOf(target.blocks, [
      ...studio.textObjectsOf(target.id),
      ...studio.imageObjectsOf(target.id),
    ])
    if (buttons.length === 0) {
      setState({ kind: 'no-button' })
      return
    }
    setState({ kind: 'working' })
    void (async () => {
      try {
        const asset = await getAsset(result.assetId)
        if (asset === undefined) throw new Error('no asset')
        const gif = await renderBlinkGif({ page: asset.blob, buttons, strength })
        if (gif === null) throw new Error('no gif')
        const size = `${String(target.canvasWidth)}x${String(target.canvasHeight)}`
        downloadBlob(gif, `${imageBaseName(doc.project.title)}_${size}_blink.gif`)
        setState({ kind: 'saved' })
      } catch {
        setState({ kind: 'failed', message: 'GIF를 만들지 못했습니다. 다시 시도해 주세요.' })
      }
    })()
  }, [studio, getDocument, strength])

  if (studio === null) return null
  return {
    state,
    buttonCount: rects.length,
    strength,
    setStrength,
    save,
    dismiss: () => setState({ kind: 'idle' }),
  }
}
