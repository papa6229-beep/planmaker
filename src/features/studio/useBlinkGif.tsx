/**
 * 깜빡이는 버튼을 **켜고 끈다** (깜빡이는 버튼 Patch).
 *
 * 여기서는 **만들기만** 한다. 만든 GIF는 자산으로 남고, 완성본 화면이 그것을 보여
 * 주며, 저장은 기존 `이 이미지 저장`·`전부 저장`이 그대로 가져간다.
 *
 * 앞선 판은 버튼 하나가 만들고 곧장 내려받기까지 했다. 작업자의 말이 정확했다 —
 * "버튼만 만들어야지, 저장은 기존 전부 저장·이 이미지 저장으로만 처리해야지."
 * 그러면 낱장을 저마다 따로 내려받게 되고, 묶어 저장하는 길과 어긋난다.
 *
 * 외부 호출이 없다. 이미 만들어 둔 완성본 PNG를 읽어 버튼 모양 안쪽만 밝기를
 * 흔들고 두 프레임으로 엮을 뿐이다.
 */

import { useCallback, useState } from 'react'
import { useBriefDocument } from '../document/useBriefDocument'
import { useStudioJob } from './useStudioJob'
import { pageResultOf } from '../../domain/studioJob'
import { BLINK_DEFAULT_STRENGTH } from '../../domain/buttonBlink'
import type { LayoutRect } from '../../domain/imageLayout'
import { createId } from '../../domain/factory'
import { getAsset, putAsset } from '../../services/assetStore'
import { renderBlinkGif, type BlinkButton } from '../../services/blinkGif'

export type BlinkState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'failed'; message: string }

export interface BlinkApi {
  state: BlinkState
  /** 이 페이지에 깜빡일 버튼이 몇 개 있는가. 0이면 켤 것이 없다. */
  buttonCount: number
  on: boolean
  strength: number
  /** 켜거나 끈다. 켜면 그 자리에서 GIF를 만든다. */
  toggle: () => void
  /** 세기를 바꾸고 다시 만든다. */
  setStrength: (value: number) => void
  dismiss: () => void
}

/** 이 페이지에서 CTA 버튼 조각이 앉은 자리와 그 그림. */
export function buttonPiecesOf(
  blocks: readonly { id: string; type: string }[],
  objects: readonly { blockId: string; assetId: string; rect: LayoutRect; angle?: number }[],
): { rect: LayoutRect; assetId: string; angle?: number | undefined }[] {
  const cta = new Set(blocks.filter((b) => b.type === 'cta_button').map((b) => b.id))
  return objects
    .filter((o) => cta.has(o.blockId))
    .map((o) => ({ rect: o.rect, assetId: o.assetId, angle: o.angle }))
}

export function useBlinkGif(): BlinkApi | null {
  const studio = useStudioJob()
  const { pages, activePageId, getDocument } = useBriefDocument()
  const [state, setState] = useState<BlinkState>({ kind: 'idle' })

  const page = pages.find((p) => p.id === activePageId)
  const pieces =
    studio === null || page === undefined
      ? []
      : buttonPiecesOf(page.blocks, [
          ...studio.textObjectsOf(activePageId),
          ...studio.imageObjectsOf(activePageId),
        ])
  const blink = studio?.blinkOf(activePageId)

  /** 지금 설정으로 GIF를 다시 만들어 심는다. */
  const build = useCallback(
    (strength: number) => {
      if (studio === null) return
      const doc = getDocument()
      const pageId = doc.activePageId
      const target = doc.pages.find((p) => p.id === pageId)
      const result = pageResultOf(studio.currentJob(), pageId)
      if (target === undefined || result === undefined) {
        setState({ kind: 'failed', message: '먼저 완성본을 만들어 주세요.' })
        return
      }
      const found = buttonPiecesOf(target.blocks, [
        ...studio.textObjectsOf(pageId),
        ...studio.imageObjectsOf(pageId),
      ])
      if (found.length === 0) {
        setState({ kind: 'failed', message: '이 페이지에는 버튼 조각이 없습니다.' })
        return
      }
      setState({ kind: 'working' })
      void (async () => {
        try {
          const asset = await getAsset(result.assetId)
          if (asset === undefined) throw new Error('no asset')
          // 버튼 조각의 그림을 **모양 틀**로 함께 보낸다. 없으면 사각형이 깜빡인다.
          const buttons: BlinkButton[] = []
          for (const piece of found) {
            const shape = await getAsset(piece.assetId)
            buttons.push({
              rect: piece.rect,
              ...(shape === undefined ? {} : { shape: shape.blob }),
              ...(piece.angle === undefined ? {} : { angle: piece.angle }),
            })
          }
          const gif = await renderBlinkGif({ page: asset.blob, buttons, strength })
          if (gif === null) throw new Error('no gif')
          const assetId = createId('asset')
          await putAsset({
            id: assetId,
            blob: gif,
            fileName: `${pageId}-blink.gif`,
            mimeType: 'image/gif',
            byteSize: gif.size,
          })
          await studio.setBlink(pageId, { strength, assetId })
          setState({ kind: 'idle' })
        } catch {
          setState({ kind: 'failed', message: 'GIF를 만들지 못했습니다. 다시 시도해 주세요.' })
        }
      })()
    },
    [studio, getDocument],
  )

  const toggle = useCallback(() => {
    if (studio === null) return
    const current = studio.blinkOf(getDocument().activePageId)
    if (current !== undefined) {
      void studio.setBlink(getDocument().activePageId, null)
      setState({ kind: 'idle' })
      return
    }
    build(BLINK_DEFAULT_STRENGTH)
  }, [studio, getDocument, build])

  const setStrength = useCallback((value: number) => build(value), [build])

  if (studio === null) return null
  return {
    state,
    buttonCount: pieces.length,
    on: blink !== undefined,
    strength: blink?.strength ?? BLINK_DEFAULT_STRENGTH,
    toggle,
    setStrength,
    dismiss: () => setState({ kind: 'idle' }),
  }
}
