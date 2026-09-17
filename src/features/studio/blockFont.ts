/**
 * 캔버스의 문구를 고른 글꼴로 보여 준다 (글꼴 미리보기 Patch, 2026-09-17).
 *
 * 사용자: "글꼴을 선택하면 즉각적으로 텍스트블록의 텍스트가 그 모양으로 바뀌어서
 * 어떤 모양인지 볼 수 있게 하고 싶다."
 *
 * 전에는 글꼴을 골라도 캔버스는 기본 글꼴로만 그렸다. 생성 결과의 글자는 그
 * 글꼴로 그려지므로(`useImageGeneration`의 `decorateText`), 캔버스도 같은 파일로
 * 그리면 생성 전에 모양을 본다. 색·테두리는 생성 때 입혀진다.
 *
 * **가리키는 중인 글꼴**은 저장하지 않는다. 목록에서 마우스를 올린 동안만
 * 캔버스가 그 글꼴로 바뀌고, 목록을 벗어나면 고른 글꼴로 돌아온다 — 포토샵의
 * 글꼴 목록과 같다. 그 값은 이 파일의 작은 저장소 하나에만 있다. 목록이 둘
 * (오른쪽 칸, 블록 위 막대)이라 둘이 같은 곳에 적는다.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { parseFontCatalog, pickWeight, type FontFamily } from '../../domain/fontCatalog'
import { faceName, fetchFontCatalog, loadFont } from '../../services/fontLoader'

export interface FontPreview {
  blockId: string
  family: string
  weight?: number | undefined
}

let preview: FontPreview | null = null
const listeners = new Set<() => void>()

export function setFontPreview(next: FontPreview | null): void {
  if (
    preview === next ||
    (preview !== null &&
      next !== null &&
      preview.blockId === next.blockId &&
      preview.family === next.family &&
      preview.weight === next.weight)
  ) {
    return
  }
  preview = next
  for (const l of listeners) l()
}

/** 이 블록에 대해서만 미리보기를 지운다 — 다른 블록의 목록이 적은 값은 두고. */
export function clearFontPreview(blockId: string): void {
  if (preview?.blockId === blockId) setFontPreview(null)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** 이 블록에 지금 가리키는 글꼴이 있으면 그것. */
export function useFontPreview(blockId: string): FontPreview | null {
  const value = useSyncExternalStore(subscribe, () => preview, () => null)
  return value?.blockId === blockId ? value : null
}

let catalog: Promise<FontFamily[]> | null = null

/** 글꼴 목록을 한 번만 읽는다. 읽지 못하면 빈 목록 — 다음에 다시 읽는다. */
export function fontFamilies(): Promise<FontFamily[]> {
  if (catalog === null) {
    catalog = fetchFontCatalog().then((raw) => {
      const list = parseFontCatalog(raw)
      if (list.length === 0) catalog = null
      return list
    })
  }
  return catalog
}

/** 검사마다 다른 목록을 쓸 수 있게. */
export function resetFontFamiliesForTests(): void {
  catalog = null
}

export interface CanvasFace {
  /** CSS `font-family`에 그대로 쓰는 값. 받지 못한 글자는 기본 글꼴이 채운다. */
  fontFamily: string
  fontWeight: number
}

const FALLBACK_STACK = "'Pretendard', 'Noto Sans KR', system-ui, sans-serif"

/**
 * 이 글꼴을 받아 와서 CSS 값으로 돌려준다. 고른 것이 없거나 아직 받는 중이면
 * `null` — 캔버스는 그동안 앞의 모양(또는 기본 글꼴)으로 그린다.
 *
 * 받는 동안 앞의 글꼴을 들고 있는 이유: 목록을 훑을 때 매번 기본 글꼴로 한 번
 * 깜빡이면 무엇이 바뀌었는지 보기 어렵다.
 */
export function useCanvasFace(family: string | undefined, weight: number | undefined): CanvasFace | null {
  const [face, setFace] = useState<{ key: string; face: CanvasFace } | null>(null)
  const key = family === undefined || family.length === 0 ? '' : `${family}@${String(weight ?? '')}`

  useEffect(() => {
    if (key === '') {
      setFace(null)
      return
    }
    let alive = true
    void (async () => {
      const found = (await fontFamilies()).find((f) => f.family === family)
      const file = found === undefined ? null : pickWeight(found, weight)
      if (file === null) {
        if (alive) setFace(null)
        return
      }
      const ok = await loadFont(file)
      if (!alive) return
      setFace(
        ok
          ? { key, face: { fontFamily: `"${faceName(file)}", ${FALLBACK_STACK}`, fontWeight: file.weight } }
          : null,
      )
    })()
    return () => {
      alive = false
    }
  }, [key, family, weight])

  return key === '' ? null : (face?.face ?? null)
}
