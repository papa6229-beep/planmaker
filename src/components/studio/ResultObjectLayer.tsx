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
import { keepAspect } from '../../domain/photoBox'
import { LAYER_MOVES } from '../../domain/layerOrder'
import { boundsOf, layerOrderOf, scaleWithin } from '../../domain/textLayers'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import type { LayoutRect } from '../../domain/imageLayout'
import type { StudioTextObject } from '../../domain/textObjects'

interface Props {
  pageId: string
  /** 페이지 좌표계의 크기 — 화면 배율을 여기서 구한다. */
  page: { width: number; height: number }
}

/** 이 오브젝트가 무엇에서 나왔는가. 옮길 때 어디에 적는지가 여기서 갈린다. */
type ObjectKind = 'image' | 'text'

/** 순서 버튼의 글자. 좁은 자리라 이름 대신 기호를 쓰고, 이름은 툴팁에 남긴다. */
const LAYER_ICONS: Record<string, string> = {
  front: '⤒',
  forward: '↑',
  backward: '↓',
  back: '⤓',
}

export function ResultObjectLayer({ pageId, page }: Props) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { pages } = useBriefDocument()
  const [urls, setUrls] = useState<Record<string, string>>({})
  /** 지우기를 한 번 누른 오브젝트. 두 번째 누름이 실제로 지운다. */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** 사람이 읽는 이름. 기획서 블록에서 그대로 가져온다. */
  const labelOf = (blockId: string) =>
    pages.find((p) => p.id === pageId)?.blocks.find((b) => b.id === blockId)?.label ?? '오브젝트'
  const boxRef = useRef<HTMLDivElement | null>(null)
  const texts = studio?.textObjectsOf(pageId) ?? []
  const images = studio?.imageObjectsOf(pageId) ?? []
  // 화면의 앞뒤가 합성의 앞뒤와 같아야 한다. 나중에 놓인 것이 위에 그려지므로,
  // 뒤에서 앞 차례로 세운 목록을 그대로 쓴다 (레이어 순서 Patch).
  const byId = new Map<string, { kind: ObjectKind; object: StudioTextObject }>([
    ...images.map((object) => [object.blockId, { kind: 'image' as const, object }] as const),
    ...texts.map((object) => [object.blockId, { kind: 'text' as const, object }] as const),
  ])
  const objects = layerOrderOf(images, texts)
    .map((id) => byId.get(id))
    .filter((entry): entry is { kind: ObjectKind; object: StudioTextObject } => entry !== undefined)
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

  const startMove = (blockId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    // 이 끌기 하나가 되돌리기 한 칸이다 (결과 되돌리기 Patch). 손가락을 따라
    // 수십 번 고쳐 써도 칸은 여기서 한 번만 만들어진다.
    studio.markStep()
    // Shift·⌘를 누르면 고른 것에 더한다. 그냥 누르면 이것 하나만 고른다.
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    studio.selectObject(blockId, add)
    // 이미 여럿을 골라 둔 채로 그중 하나를 끌면 **함께** 움직인다. 더하기 누름은
    // 고르는 동작이므로 끌지 않는다.
    const group = add
      ? []
      : (studio.selectedObjectBlockIds.includes(blockId) ? studio.selectedObjectBlockIds : [blockId])
          .map((id) => objects.find((o) => o.object.blockId === id))
          .filter((o): o is (typeof objects)[number] => o !== undefined)
          .map((o) => ({ kind: o.kind, blockId: o.object.blockId, from: { ...o.object.rect } }))
    const startX = e.clientX
    const startY = e.clientY
    const k = scale()
    let moved = false
    const onMove = (ev: PointerEvent) => {
      moved = true
      const dx = Math.round((ev.clientX - startX) * k)
      const dy = Math.round((ev.clientY - startY) * k)
      for (const item of group) {
        place(item.kind, item.blockId, { ...item.from, x: item.from.x + dx, y: item.from.y + dy })
      }
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
      studio.markStep()
      studio.selectObject(blockId)
      const startX = e.clientX
      const startY = e.clientY
      const k = scale()
      let moved = false
      // 이 오브젝트는 이미 그려진 **그림**이다. 가로세로를 따로 늘리면 획 굵기가
      // 한쪽만 두꺼워져 글자도 사진도 찌그러진다. 그래서 기본은 비율 고정이고,
      // 기획서의 사진 블록이 쓰는 그 계산(`keepAspect`)을 그대로 쓴다.
      //
      // Shift를 누른 동안에만 가로세로가 풀린다 — 일부러 늘려야 할 때가 있고,
      // 그때는 누르고 있는 손가락이 "지금 비율을 깬다"고 말해 준다.
      // 여럿을 골라 두었으면 **감싸는 상자**를 잡아 늘린다 — 저마다 자기 자리에서
      // 커지면 사이 간격이 그대로 남아 배치가 흐트러진다.
      const group = (studio.selectedObjectBlockIds.includes(blockId) ? studio.selectedObjectBlockIds : [blockId])
        .map((id) => objects.find((o) => o.object.blockId === id))
        .filter((o): o is (typeof objects)[number] => o !== undefined)
        .map((o) => ({ kind: o.kind, blockId: o.object.blockId, from: { ...o.object.rect } }))
      const from = boundsOf(group.map((g) => g.from)) ?? rect
      const aspect = from.height > 0 ? from.width / from.height : 1
      const onMove = (ev: PointerEvent) => {
        moved = true
        const dx = (ev.clientX - startX) * k
        const dy = (ev.clientY - startY) * k
        // 잡은 모서리의 반대쪽이 제자리에 남는다. 지면 밖으로도 걸칠 수 있으므로
        // 가두지 않는다 — 밖으로 나간 부분은 다시 합칠 때 지금까지처럼 잘린다.
        const to = ev.shiftKey
          ? resizeRect(from, handle, dx, dy, page.width, page.height, true)
          : keepAspect(from, handle, dx, dy, aspect)
        for (const item of group) place(item.kind, item.blockId, scaleWithin(item.from, from, to))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (moved) settle()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

  /**
   * 상자 한가운데를 축으로 돌린다 (회전 Patch).
   *
   * 손잡이를 잡은 손가락과 한가운데를 잇는 선의 각도를 그대로 쓴다. Shift를
   * 누르면 15도씩 끊어져 수평·수직을 정확히 맞출 수 있다.
   */
  const startSpin = (blockId: string, rect: LayoutRect) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    studio.markStep()
    studio.selectObject(blockId)
    const box = boxRef.current?.getBoundingClientRect()
    if (box === undefined) return
    const cx = box.left + ((rect.x + rect.width / 2) / page.width) * box.width
    const cy = box.top + ((rect.y + rect.height / 2) / page.height) * box.height
    // 손잡이는 상자 위에 있다 — 그 방향을 0도로 삼아야 잡은 곳이 따라온다.
    let moved = false
    const onMove = (ev: PointerEvent) => {
      moved = true
      const deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
      studio.spinObject(pageId, blockId, ev.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg))
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
        const picked = studio.selectedObjectBlockIds.includes(object.blockId)
        // 조작점은 마지막에 고른 하나에만 붙는다 — 여럿에 붙으면 무엇을 잡은
        // 것인지 화면이 말해 주지 못한다.
        const selected = studio.selectedObjectBlockId === object.blockId
        const url = urls[object.assetId]
        return (
          <div
            key={`${kind}-${object.blockId}`}
            className={`result-object ${kind}-object${picked ? ' is-picked' : ''}${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={picked}
            aria-label={`${kind === 'image' ? '이미지' : '꾸며진 문구'} ${object.blockId}`}
            style={{
              left: percent(object.rect.x, page.width),
              top: percent(object.rect.y, page.height),
              width: percent(object.rect.width, page.width),
              height: percent(object.rect.height, page.height),
              // 화면과 저장한 그림이 같은 축으로 돈다 — CSS도 캔버스도 상자
              // 한가운데가 축이다.
              ...(object.angle === undefined || object.angle === 0
                ? {}
                : { transform: `rotate(${String(object.angle)}deg)` }),
            }}
            onPointerDown={startMove(object.blockId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                studio.selectObject(object.blockId, e.shiftKey)
              }
            }}
          >
            {url !== undefined && (
              <img className="result-object__image" src={url} alt="" draggable={false} />
            )}
            {/* 앞뒤 순서는 고른 오브젝트 옆에서 바꾼다 — 우측 패널까지 갔다 오는
                동안 무엇을 고르고 있었는지 놓치기 때문이다. 끝에 닿은 버튼은
                흐리게 둔다: 눌러도 아무 일이 없는 것보다 미리 말하는 편이 낫다. */}
            {selected && (
              <span
                className="result-object__layers"
                role="group"
                aria-label="앞뒤 순서"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {LAYER_MOVES.map((move) => {
                  const at = studio.layerPositionOf(pageId, object.blockId)
                  const atFront = at !== null && at.index === at.count - 1
                  const atBack = at !== null && at.index === 0
                  const off =
                    move.value === 'front' || move.value === 'forward' ? atFront : atBack
                  return (
                    <button
                      key={move.value}
                      type="button"
                      className="result-object__layer"
                      disabled={off}
                      title={move.label}
                      aria-label={move.label}
                      // 순서를 적고 나서 한 번 다시 합친다. 외부 호출은 없다.
                      onClick={() => {
                        studio.markStep()
                        void studio.reorderObject(pageId, object.blockId, move.value).then(settle)
                      }}
                    >
                      {LAYER_ICONS[move.value]}
                    </button>
                  )
                })}
              </span>
            )}
            {/* 지우기는 두 번 눌러야 한다 (오브젝트 삭제 Patch). 결과 화면에는
                되돌리기가 없어서, 한 번의 잘못 누름이 그대로 남기 때문이다.
                지워지는 것은 이번 결과에 얹힌 그림뿐이고 기획서 블록은 그대로
                남는다 — 다시 생성하면 다시 나온다. */}
            {selected && (
              <span
                className="result-object__remove"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {confirming === object.blockId ? (
                  <>
                    <button
                      type="button"
                      className="result-object__confirm"
                      aria-label={`${labelOf(object.blockId)} 정말 지우기`}
                      title="기획서 블록은 그대로 남습니다"
                      onClick={() => {
                        setConfirming(null)
                        studio.markStep()
                        void studio.removeObject(pageId, object.blockId).then(settle)
                      }}
                    >
                      정말 지울까요?
                    </button>
                    <button
                      type="button"
                      className="result-object__layer"
                      aria-label={`${labelOf(object.blockId)} 지우기 취소`}
                      title="취소"
                      onClick={() => setConfirming(null)}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="result-object__layer"
                    aria-label={`${labelOf(object.blockId)} 지우기`}
                    title="이 결과에서만 지웁니다 — 기획서 블록은 그대로입니다"
                    onClick={() => setConfirming(object.blockId)}
                  >
                    🗑
                  </button>
                )}
              </span>
            )}
            {selected && (
              <span
                className="result-object__spin"
                role="slider"
                tabIndex={0}
                aria-label="기울기"
                aria-valuenow={object.angle ?? 0}
                aria-valuemin={-180}
                aria-valuemax={180}
                title={`기울기 ${String(object.angle ?? 0)}° · Shift로 15° 단위`}
                onPointerDown={startSpin(object.blockId, object.rect)}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
                  if (step === 0) return
                  e.preventDefault()
                  studio.spinObject(pageId, object.blockId, (object.angle ?? 0) + step * (e.shiftKey ? 15 : 1))
                  settle()
                }}
              />
            )}
            {selected &&
              RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`result-object__handle result-object__handle--${handle}`}
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
