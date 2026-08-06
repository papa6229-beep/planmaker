/**
 * 결과 위의 편집 오브젝트 (블록 연결 Patch §2, §3).
 *
 * 새 편집기를 만들지 않는다. 캔버스의 이미지 블록이 쓰는 것과 **같은 제스처**를
 * 쓴다 — 포인터를 눌러 고르고, 끌어 옮기고, 모서리 조작점으로 크기를 바꾼다.
 * 크기 계산도 그 블록이 쓰는 `resizeRect` 그대로다.
 *
 * 여기 놓이는 상자는 기획서 블록에서 그대로 온 것이다. 합쳐진 그림을 다시 뜯어
 * 만들지 않는다 — 뜯어 만든 덩어리는 블록이 아니라 픽셀이고, 그러면 가까운 둘이
 * 하나로 붙거나 하나가 둘로 갈라진다. 그래서 오브젝트 수는 언제나 블록 수와
 * 같고, 오브젝트의 이름은 언제나 그 블록의 `blockId`다.
 *
 * 이미지가 먼저 오고 문구가 뒤에 온다. 나중에 놓인 것이 위에 그려지므로, 화면의
 * 앞뒤가 합성 순서(배경 → 이미지·컷아웃 → 문구)와 같아진다 — 겹친 자리를 눌렀을
 * 때 잡히는 것도 문구다.
 *
 * 옮기고 늘리는 동안 외부로 나가는 요청은 없다. 손을 떼는 순간 한 번, 지금
 * 상태로 결과를 다시 합친다 (§4).
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { getAsset } from '../../services/assetStore'
import { RESIZE_HANDLES, resizeRect, type ResizeHandle } from '../../features/editor/canvasGeometry'
import type { LayoutRect } from '../../domain/imageLayout'
import type { StudioTextObject } from '../../domain/textObjects'

interface Props {
  pageId: string
  /** 페이지 좌표계의 크기 — 화면 배율을 여기서 구한다. */
  page: { width: number; height: number }
}

/** 이 오브젝트가 무엇에서 나왔는가. 옮길 때 어디에 적는지가 여기서 갈린다. */
type ObjectKind = 'image' | 'text'

export function ResultObjectLayer({ pageId, page }: Props) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const boxRef = useRef<HTMLDivElement | null>(null)
  const texts = studio?.textObjectsOf(pageId) ?? []
  const images = studio?.imageObjectsOf(pageId) ?? []
  const objects: { kind: ObjectKind; object: StudioTextObject }[] = [
    ...images.map((object) => ({ kind: 'image' as const, object })),
    ...texts.map((object) => ({ kind: 'text' as const, object })),
  ]
  // 그림을 거는 것은 문구뿐이다 — 이미지는 결과 안에 이미 그려져 있고, 여기서
  // 한 장 더 여는 것은 그저 큰 원본을 두 번 읽는 일이다.
  const ids = texts.map((o) => o.assetId).join(',')

  // 그림 주소는 볼 때만 만들고 떠날 때 되돌려 준다.
  useEffect(() => {
    let alive = true
    const made: string[] = []
    void (async () => {
      const next: Record<string, string> = {}
      for (const id of ids.split(',').filter(Boolean)) {
        const asset = await getAsset(id)
        if (asset === undefined) continue
        const url = URL.createObjectURL(asset.blob)
        made.push(url)
        next[id] = url
      }
      if (alive) setUrls(next)
      else for (const url of made) URL.revokeObjectURL(url)
    })()
    return () => {
      alive = false
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [ids])

  if (studio === null || objects.length === 0) return null

  /** 화면 1px이 페이지 좌표로 몇인가. */
  const scale = () => {
    const width = boxRef.current?.getBoundingClientRect().width ?? page.width
    return width > 0 ? page.width / width : 1
  }

  const settle = () => void generation?.recomposePage(pageId)

  /** 이 오브젝트 하나만 적는다. 옆 오브젝트는 같은 값 그대로 남는다. */
  const place = (kind: ObjectKind, blockId: string, rect: LayoutRect) => {
    if (kind === 'image') studio.moveImageObject(pageId, blockId, rect)
    else studio.moveTextObject(pageId, blockId, rect)
  }

  const startMove = (kind: ObjectKind, blockId: string, rect: LayoutRect) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    studio.selectObject(blockId)
    const startX = e.clientX
    const startY = e.clientY
    const k = scale()
    let moved = false
    const onMove = (ev: PointerEvent) => {
      moved = true
      place(kind, blockId, {
        ...rect,
        x: Math.round(rect.x + (ev.clientX - startX) * k),
        y: Math.round(rect.y + (ev.clientY - startY) * k),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) settle()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startResize =
    (kind: ObjectKind, blockId: string, rect: LayoutRect, handle: ResizeHandle) => (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      studio.selectObject(blockId)
      const startX = e.clientX
      const startY = e.clientY
      const k = scale()
      let moved = false
      const onMove = (ev: PointerEvent) => {
        moved = true
        // 캔버스의 이미지 블록과 같은 계산이다 — 잡은 모서리의 반대쪽이 제자리에
        // 남는다. 지면 밖으로도 걸칠 수 있으므로 가두지 않는다. 밖으로 나간
        // 부분은 다시 합칠 때 지금까지처럼 잘린다.
        place(
          kind,
          blockId,
          resizeRect(rect, handle, (ev.clientX - startX) * k, (ev.clientY - startY) * k, page.width, page.height, true),
        )
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (moved) settle()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

  const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(4)}%`

  return (
    <div
      className="result-objects"
      ref={boxRef}
      // 빈 곳을 누르면 선택이 풀린다. 조작 UI가 남아 있으면 무엇이 골라져
      // 있는지 화면이 거짓말을 한다.
      onPointerDown={() => studio.selectObject(null)}
    >
      {objects.map(({ kind, object }) => {
        const selected = studio.selectedObjectBlockId === object.blockId
        const url = urls[object.assetId]
        return (
          <div
            key={`${kind}-${object.blockId}`}
            className={`result-object ${kind}-object${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${kind === 'image' ? '이미지' : '꾸며진 문구'} ${object.blockId}`}
            style={{
              left: percent(object.rect.x, page.width),
              top: percent(object.rect.y, page.height),
              width: percent(object.rect.width, page.width),
              height: percent(object.rect.height, page.height),
            }}
            onPointerDown={startMove(kind, object.blockId, object.rect)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                studio.selectObject(object.blockId)
              }
            }}
          >
            {url !== undefined && (
              <img className="result-object__image" src={url} alt="" draggable={false} />
            )}
            {selected &&
              RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`result-object__handle result-object__handle--${handle}`}
                  aria-hidden="true"
                  onPointerDown={startResize(kind, object.blockId, object.rect, handle)}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
