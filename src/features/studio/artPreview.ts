/**
 * 기획서 캔버스의 미리보기 그림 (문자·도형 도구 Patch, 2026-09-17).
 *
 * 문구와 도형 블록은 **완성본과 같은 붓**으로 그린 그림을 캔버스에 건다. 글자별 색,
 * 세로쓰기, 원호, 이중 테두리, 흐린 그림자, 레벨·커브까지 — CSS로 흉내 내면 어딘가
 * 어긋나고, 어긋나면 "캔버스에서 본 것과 결과가 다르다"가 된다.
 *
 * 값이 바뀌면 잠깐 기다렸다가(끄는 동안 수십 번 그리지 않게) 한 장을 새로 그리고,
 * 그동안은 앞의 그림을 들고 있는다. 주소는 바꿀 때와 떠날 때 되돌려 준다.
 */

import { useEffect, useRef, useState } from 'react'
import type { TextArtAlign, CharStyles } from '../../domain/textArt'
import type { TextLook } from '../../domain/textLook'
import type { ShapeLook } from '../../domain/shapeLook'
import type { ToneAdjust } from '../../domain/toneAdjust'
import { renderTextArt } from '../../services/textArt'
import { renderShapeArt } from '../../services/shapeArt'
import { trimToContent } from '../../services/trimToContent'
import { artTarget } from './liveText'

export type ArtRequest =
  | {
      kind: 'text'
      content: string
      lines: readonly string[]
      family: string
      weight?: number | undefined
      chars?: CharStyles | undefined
      look: TextLook
      align: TextArtAlign
      box: { width: number; height: number }
      tone?: ToneAdjust | undefined
    }
  | {
      kind: 'shape'
      look: ShapeLook
      box: { width: number; height: number }
      tone?: ToneAdjust | undefined
    }

export interface ArtPreview {
  url: string
  /** 도형만 — 상자 밖으로 나간 여백(지면 px). */
  pad?: { left: number; top: number; right: number; bottom: number }
  /** 이 그림을 만든 값의 지문. 검사와 화면이 같은 것을 가리키는지 볼 때 쓴다. */
  key: string
}

const WAIT_MS = 40

export function useArtPreview(request: ArtRequest | null): ArtPreview | null {
  const [preview, setPreview] = useState<ArtPreview | null>(null)
  const key = request === null ? '' : JSON.stringify(request)
  const current = useRef<ArtPreview | null>(null)

  useEffect(() => {
    if (request === null) {
      if (current.current !== null) URL.revokeObjectURL(current.current.url)
      current.current = null
      setPreview(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let blob: Blob | null = null
          let pad: ArtPreview['pad']
          if (request.kind === 'text') {
            const drawn = await renderTextArt({
              content: request.content,
              lines: request.lines,
              family: request.family,
              weight: request.weight,
              chars: request.chars,
              look: request.look,
              align: request.align,
              target: artTarget(request.box, 2),
              tone: request.tone,
            })
            const trimmed = drawn === null ? null : await trimToContent(drawn.blob)
            blob = trimmed?.blob ?? null
          } else {
            const drawn = await renderShapeArt(request.look, request.box, { tone: request.tone, scale: 2 })
            blob = drawn?.blob ?? null
            pad = drawn?.pad
          }
          if (!alive || blob === null) return
          const next: ArtPreview = { url: URL.createObjectURL(blob), key, ...(pad === undefined ? {} : { pad }) }
          // 앞 그림은 화면이 새 주소로 바뀐 뒤에 놓는다 — 곧바로 놓으면 깨진 그림을 한 번 부른다.
          const old = current.current
          if (old !== null) setTimeout(() => URL.revokeObjectURL(old.url), 1000)
          current.current = next
          setPreview(next)
        } catch {
          // 미리보기를 못 그려도 블록은 글자로 남는다.
        }
      })()
    }, WAIT_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // 요청은 지문(key)으로만 본다 — 매 렌더 새 객체라도 값이 같으면 다시 그리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(
    () => () => {
      if (current.current !== null) URL.revokeObjectURL(current.current.url)
    },
    [],
  )

  return preview
}
