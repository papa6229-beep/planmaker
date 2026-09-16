/**
 * 고른 글꼴만 그때 내려받는다 (문구 판 Patch).
 *
 * 한글 글꼴은 한 벌이 수백 KB다. 스물네 가지를 미리 받아 두면 화면이 열리지
 * 않는다. 그래서 목록만 먼저 읽고(`domain/fontCatalog.ts`), 실제 파일은 작업자가
 * 그 글꼴을 고른 순간에 받는다.
 *
 * 같은 글꼴을 두 번 받지 않는다. 받다가 실패하면 **기억해 두고 다시 시도하지
 * 않는다** — 없는 파일을 문구마다 다시 부르면 그리기가 그만큼씩 늦어진다.
 *
 * 글자를 그리기 **전에** 반드시 `loadFont`를 기다려야 한다. 글꼴이 준비되기 전에
 * 재면 브라우저가 기본 글꼴로 재고, 그 너비로 그린 판은 글자가 바뀌는 순간
 * 넘치거나 덜 찬다. 덜 찬 판은 모델이 빈 자리를 채운다 (2026-09-16 확인).
 */

import { pickWeight, type FontFamily, type FontFile } from '../domain/fontCatalog'

/** 빌드에 담긴 글꼴이 놓이는 자리. 목록 파일도 같은 곳에 있다. */
export const FONT_BASE = 'fonts'
export const FONT_CATALOG_URL = `/${FONT_BASE}/fonts.json`

const loaded = new Map<string, Promise<boolean>>()

/** 화면과 캔버스가 같은 이름으로 이 글꼴을 부르도록, 굵기까지 넣어 한 이름으로 만든다. */
export function faceName(file: FontFile): string {
  return `pm-${file.file.replace(/\.woff2?$/i, '')}`
}

async function load(file: FontFile): Promise<boolean> {
  if (typeof FontFace !== 'function' || typeof document === 'undefined') return false
  try {
    const face = new FontFace(faceName(file), `url(/${FONT_BASE}/${file.file}) format("woff2")`, {
      weight: String(file.weight),
      display: 'block',
    })
    await face.load()
    document.fonts.add(face)
    return true
  } catch {
    return false
  }
}

/** 이 파일을 쓸 수 있게 만든다. 이미 받았으면 곧바로 참을 돌려준다. */
export function loadFont(file: FontFile): Promise<boolean> {
  const key = file.file
  const found = loaded.get(key)
  if (found !== undefined) return found
  const started = load(file)
  loaded.set(key, started)
  return started
}

/** 패밀리와 굵기로 고른 뒤 받아 온다. 받지 못하면 `null` — 부르는 쪽이 기본 글꼴로 간다. */
export async function loadFamilyWeight(family: FontFamily, weight?: number): Promise<FontFile | null> {
  const file = pickWeight(family, weight)
  if (file === null) return null
  return (await loadFont(file)) ? file : null
}

/** 목록을 한 번 읽어 둔다. 읽지 못하면 빈 목록 — 글꼴 없이도 화면은 열려야 한다. */
export async function fetchFontCatalog(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  try {
    const response = await fetchImpl(FONT_CATALOG_URL)
    if (!response.ok) return []
    return await response.json()
  } catch {
    return []
  }
}
