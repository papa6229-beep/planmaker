/**
 * 배너에서 **배경도** 옮기고 키운다 (배경 이동 Patch).
 *
 * 작업자가 이벤트 페이지 작업창과의 차이로 꼽은 것은 딱 하나였다 — "차이점은
 * 배경도 위치, 크기 조절 가능한 것뿐이야." 이벤트 페이지에서는 배경이 지면 전체라
 * 옮길 이유가 없지만, 배너는 큰 배경의 **어디를 보여 줄지**가 곧 디자인이다.
 * 1020×70 띠에서 인물의 얼굴이 걸리느냐 여백이 걸리느냐가 그 한 번의 이동으로
 * 갈린다.
 *
 * 조각과 **같은 제스처**를 쓴다 — 눌러 끌면 옮기고, 모서리를 잡으면 크기가 바뀐다.
 * 다만 조각처럼 목록에 서지 않는다. 배경은 늘 맨 뒤 한 장이고 앞뒤도 삭제도 없다.
 *
 * 조각보다 **뒤에** 그린다. 앞에 두면 배경을 잡으려다 조각을 못 잡는다 — 화면
 * 전체가 배경이라 어디를 눌러도 배경이 먼저 걸린다. 그래서 이 겹은 잡히지 않고,
 * 아래 가장자리의 손잡이 하나로만 잡는다.
 *
 * 배너 페이지에서만 나온다.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { minPieceSize, RESIZE_HANDLES, resizeRect, type ResizeHandle } from '../../features/editor/canvasGeometry'
import type { LayoutRect } from '../../domain/imageLayout'

interface Props {
  pageId: string
  page: { width: number; height: number }
}

export function BannerBackgroundHandle({ pageId, page }: Props) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages } = useBriefDocument()
  const boxRef = useRef<HTMLDivElement | null>(null)

  const specId = studio?.bannerSpecOf(pageId) ?? null
  const background = studio?.backgroundOf(pageId)
  if (studio === null || specId === null || background === undefined) return null
  if (!pages.some((p) => p.id === pageId)) return null

  // 자리를 아직 안 옮겼으면 캔버스 전체가 그 자리다.
  const rect: LayoutRect = background.rect ?? { x: 0, y: 0, width: page.width, height: page.height }

  const scale = () => {
    const width = boxRef.current?.getBoundingClientRect().width ?? page.width
    return width > 0 ? page.width / width : 1
  }
  const settle = () => void generation?.recomposePage(pageId)

  const drag = (compute: (dx: number, dy: number, shift: boolean) => LayoutRect) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    // 이 끌기 하나가 되돌리기 한 칸이다. 손가락을 따라 수십 번 고쳐 써도 칸은
    // 여기서 한 번만 만들어진다.
    studio.markStep()
    const startX = e.clientX
    const startY = e.clientY
    const k = scale()
    let moved = false
    const onMove = (ev: PointerEvent) => {
      moved = true
      studio.moveBackground(pageId, compute((ev.clientX - startX) * k, (ev.clientY - startY) * k, ev.shiftKey))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) settle()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const move = drag((dx, dy) => ({ ...rect, x: Math.round(rect.x + dx), y: Math.round(rect.y + dy) }))
  const resize = (handle: ResizeHandle) =>
    drag((dx, dy) => {
      // 캔버스 밖으로 걸치는 것이 정상이다 — 큰 배경의 한 조각만 보이는 것이
      // 이 기능의 요점이라, 안으로 가두면 아무것도 못 한다.
      const next = resizeRect(rect, handle, dx, dy, page.width, page.height, true, minPieceSize(page.width, page.height))
      return {
        x: Math.round(next.x),
        y: Math.round(next.y),
        width: Math.round(next.width),
        height: Math.round(next.height),
      }
    })

  const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(4)}%`

  return (
    <div className="banner-bg" ref={boxRef} aria-hidden={false}>
      <div
        className="banner-bg__frame"
        style={{
          left: percent(rect.x, page.width),
          top: percent(rect.y, page.height),
          width: percent(rect.width, page.width),
          height: percent(rect.height, page.height),
        }}
      >
        <button
          type="button"
          className="banner-bg__grab"
          aria-label="배경 옮기기"
          title="끌어서 배경을 옮깁니다"
          onPointerDown={move}
        >
          배경
        </button>
        {RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className={`banner-bg__handle banner-bg__handle--${handle}`}
            role="button"
            tabIndex={-1}
            aria-label={`배경 크기 ${handle}`}
            onPointerDown={resize(handle)}
          />
        ))}
      </div>
    </div>
  )
}
