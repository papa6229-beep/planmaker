/**
 * 결과 위의 꾸며진 문구 오브젝트 (텍스트 오브젝트 Patch §2).
 *
 * 새 편집기를 만들지 않는다. 캔버스의 이미지 블록이 쓰는 것과 **같은 제스처**를
 * 쓴다 — 포인터를 눌러 고르고, 끌어 옮기고, 모서리 조작점으로 크기를 바꾼다.
 * 크기 계산도 그 블록이 쓰는 `resizeRect` 그대로다.
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

interface Props {
  pageId: string
  /** 페이지 좌표계의 크기 — 화면 배율을 여기서 구한다. */
  page: { width: number; height: number }
}

export function TextObjectLayer({ pageId, page }: Props) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const boxRef = useRef<HTMLDivElement | null>(null)
  const objects = studio?.textObjectsOf(pageId) ?? []
  const ids = objects.map((o) => o.assetId).join(',')

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

  const startMove = (blockId: string, rect: LayoutRect) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    studio.selectTextObject(blockId)
    const startX = e.clientX
    const startY = e.clientY
    const k = scale()
    let moved = false
    const onMove = (ev: PointerEvent) => {
      moved = true
      studio.moveTextObject(pageId, blockId, {
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
    (blockId: string, rect: LayoutRect, handle: ResizeHandle) => (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      studio.selectTextObject(blockId)
      const startX = e.clientX
      const startY = e.clientY
      const k = scale()
      let moved = false
      const onMove = (ev: PointerEvent) => {
        moved = true
        // 캔버스의 이미지 블록과 같은 계산이다 — 잡은 모서리의 반대쪽이 제자리에
        // 남는다. 문구는 지면 밖으로도 걸칠 수 있으므로 가두지 않는다.
        studio.moveTextObject(
          pageId,
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
      className="text-objects"
      ref={boxRef}
      // 빈 곳을 누르면 선택이 풀린다. 조작 UI가 남아 있으면 무엇이 골라져
      // 있는지 화면이 거짓말을 한다.
      onPointerDown={() => studio.selectTextObject(null)}
    >
      {objects.map((object) => {
        const selected = studio.selectedTextBlockId === object.blockId
        const url = urls[object.assetId]
        return (
          <div
            key={object.blockId}
            className={`text-object${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`꾸며진 문구 ${object.blockId}`}
            style={{
              left: percent(object.rect.x, page.width),
              top: percent(object.rect.y, page.height),
              width: percent(object.rect.width, page.width),
              height: percent(object.rect.height, page.height),
            }}
            onPointerDown={startMove(object.blockId, object.rect)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                studio.selectTextObject(object.blockId)
              }
            }}
          >
            {url !== undefined && (
              <img className="text-object__image" src={url} alt="" draggable={false} />
            )}
            {selected &&
              RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`text-object__handle text-object__handle--${handle}`}
                  aria-hidden="true"
                  onPointerDown={startResize(object.blockId, object.rect, handle)}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
