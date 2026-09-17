/**
 * 원본 기획서 보기 (원본 기획서 보기 Patch, 2026-09-17).
 *
 * 불러온 기획서는 곧바로 작업 캔버스가 된다. 그래서 외부 팀이 그린 **원래 모습**은
 * 작업 파일에 따로 얼려 둔 원본(`job.source.doc`)에서 다시 그린다 — 고친 작업본이
 * 아니라 받은 그대로다.
 *
 * - 나란히: 작업 캔버스(또는 완성본) 옆에 **같은 배율**로 선다.
 * - 겹쳐: 작업 캔버스·완성본 위에 투명도를 주어 깐다. 누름은 통과한다.
 *
 * 읽기만 한다. 결과 이미지에도, AI 요청에도 들어가지 않는다. 기획서에 붙은 그림은
 * "이 자리에 무엇을 놓아 달라"는 참고라, 원본에서만 보인다.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useAssets } from '../../features/assets/useAssets'
import { setOriginalView, useOriginalView } from '../../features/studio/originalView'
import { getBlockTypeMeta, isShapeBlock } from '../../domain/blockTypes'
import { cardKindLabel, drawsBareText, isPairedLinkUrl, textAlignOf } from '../../domain/simpleBlocks'
import { fitTextSize } from '../../domain/textFit'
import { createLineMeasurer } from '../../features/editor/measureText'
import type { BriefPage } from '../../domain/pageSchema'

const measureLine = createLineMeasurer()

/**
 * 지금 페이지의 원본. 원본이 없으면(빈 작업판에서 시작) `null`.
 * 작업 중에 새로 만든 페이지는 원본에 없다 — 그때는 `missing`.
 */
export function useOriginalPage(): { page: BriefPage } | { missing: true } | null {
  const studio = useStudioJob()
  const { activePageId, getDocument } = useBriefDocument()
  const source = studio?.job.source ?? null
  if (source === null) return null
  const pages = source.doc.pages
  const byId = pages.find((p) => p.id === activePageId)
  if (byId !== undefined) return { page: byId }
  // 페이지 번호가 모두 바뀐 옛 파일이면 순서로 맞춘다.
  const working = getDocument().pages
  if (!working.some((w) => pages.some((p) => p.id === w.id))) {
    const index = working.findIndex((p) => p.id === activePageId)
    const byIndex = pages[index]
    if (byIndex !== undefined) return { page: byIndex }
  }
  return { missing: true }
}

/** 원본 한 페이지. 지면 px 그대로 그린다 — 배율은 감싸는 쪽이 준다. */
export function OriginalSheet({ page, className, style }: { page: BriefPage; className?: string; style?: CSSProperties }) {
  const { getUrl } = useAssets()
  const blocks = page.blocks.filter((b) => !isPairedLinkUrl(page.blocks, b) && !isShapeBlock(b.type))
  return (
    <div
      className={`orig-sheet${className === undefined ? '' : ` ${className}`}`}
      aria-hidden={className !== undefined ? true : undefined}
      style={{ width: page.canvasWidth, height: page.canvasHeight, ...style }}
    >
      {blocks.map((block) => {
        const meta = getBlockTypeMeta(block.type)
        const pos: CSSProperties = {
          left: block.position.x,
          top: block.position.y,
          width: block.position.width,
          height: block.position.height,
        }
        const content = (block.content ?? '').trim()
        if (drawsBareText(block)) {
          const fit = fitTextSize(block.content ?? '', block.position.width, block.position.height, measureLine ? { measure: measureLine } : {})
          return (
            <div
              key={block.id}
              className="orig-card orig-card--text"
              style={{ ...pos, fontSize: fit.fontSize, textAlign: textAlignOf(block) }}
            >
              {block.content}
            </div>
          )
        }
        const url = meta.requiresAsset ? getUrl(block.assetId) : undefined
        return (
          <div key={block.id} className={`orig-card orig-card--${block.aiVisibility}`} style={pos}>
            <span className="orig-card__kind">{cardKindLabel(block)}</span>
            <span className="orig-card__label">{block.label}</span>
            {url !== undefined ? (
              <img className="orig-card__image" src={url} alt="" draggable={false} />
            ) : (
              content.length > 0 && <span className="orig-card__content">{content}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 캔버스·완성본 위에 까는 원본. 지면 px 공간 안에 둔다. */
export function OriginalOverlay({ scale = 1 }: { scale?: number }) {
  const view = useOriginalView()
  const original = useOriginalPage()
  if (!view.overlay || original === null || !('page' in original)) return null
  return (
    <OriginalSheet
      page={original.page}
      className={`orig-overlay${view.front ? ' orig-overlay--front' : ''}`}
      style={{ opacity: view.opacity, ...(scale === 1 ? {} : { transform: `scale(${String(scale)})` }) }}
    />
  )
}

/**
 * 옆 화면과 함께 스크롤한다 — 같은 배율이므로 같은 스크롤 값이 같은 높이다.
 * 옆 화면은 기획서 캔버스(`.canvas`)나 완성본(`.compare__viewport`)이다.
 */
function useScrollTogether(ref: { current: HTMLDivElement | null }, on: boolean): void {
  useEffect(() => {
    const mine = ref.current
    const stage = mine?.closest('.stage')
    if (!on || mine === null || stage === null || stage === undefined) return
    let other: HTMLElement | null = null
    // 옮겨 받은 쪽의 스크롤 알림은 잠깐 되돌려 보내지 않는다. 한쪽이 더 짧아 끝에서
    // 멈추면, 되돌려 보낸 값이 움직이던 쪽을 끌어올리기 때문이다.
    const quiet = new Map<HTMLElement, number>()
    const copy = (from: HTMLElement, to: HTMLElement) => {
      if ((quiet.get(from) ?? 0) > performance.now()) return
      if (Math.abs(to.scrollTop - from.scrollTop) < 1) return
      quiet.set(to, performance.now() + 80)
      to.scrollTop = from.scrollTop
    }
    const onMine = () => {
      if (other !== null) copy(mine, other)
    }
    const onOther = () => {
      if (other !== null) copy(other, mine)
    }
    const find = () => {
      const next = stage.querySelector<HTMLElement>(':scope > .compare .compare__result .compare__viewport, :scope > .canvas')
      if (next === other) return
      other?.removeEventListener('scroll', onOther)
      other = next
      other?.addEventListener('scroll', onOther, { passive: true })
      if (other !== null) copy(other, mine)
    }
    find()
    // 완성본은 그림을 불러온 뒤에 스크롤 칸이 생긴다 — 칸이 바뀌면 다시 찾는다.
    const watch = typeof MutationObserver === 'function' ? new MutationObserver(find) : null
    watch?.observe(stage, { childList: true, subtree: true })
    mine.addEventListener('scroll', onMine, { passive: true })
    return () => {
      watch?.disconnect()
      mine.removeEventListener('scroll', onMine)
      other?.removeEventListener('scroll', onOther)
    }
  }, [ref, on])
}

/** 작업 캔버스 옆에 서는 원본. 배율은 옆 화면과 같다. */
export function OriginalSidePane({ zoom }: { zoom: number }) {
  const view = useOriginalView()
  const original = useOriginalPage()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const open = view.side && original !== null
  useScrollTogether(viewportRef, open)
  if (!open) return null
  return (
    <section className="orig-pane" aria-label="원본 기획서">
      <header className="orig-pane__head">
        <h2 className="orig-pane__title">원본 기획서</h2>
        <span className="orig-pane__note">받은 그대로 · 읽기 전용</span>
      </header>
      <div className="orig-pane__viewport" ref={viewportRef}>
        {original !== null && 'page' in original ? (
          <div
            className="orig-pane__frame"
            style={{
              width: Math.round(original.page.canvasWidth * zoom),
              height: Math.round(original.page.canvasHeight * zoom),
            }}
          >
            <OriginalSheet page={original.page} style={{ transform: `scale(${String(zoom)})` }} />
          </div>
        ) : (
          <p className="orig-pane__empty">이 페이지는 원본 기획서에 없습니다 (작업 중에 새로 만든 페이지).</p>
        )}
      </div>
    </section>
  )
}

/** 세로 칸의 조절 — 원본이 있을 때만 선다. */
export function OriginalControls() {
  const view = useOriginalView()
  const original = useOriginalPage()
  const percent = useMemo(() => Math.round(view.opacity * 100), [view.opacity])
  if (original === null) return null
  return (
    <section className="orig-controls" aria-label="원본 기획서 보기">
      <span className="orig-controls__title">원본 기획서</span>
      <div className="orig-controls__row">
        <button
          type="button"
          className={`btn orig-controls__btn${view.side ? ' is-active' : ''}`}
          aria-pressed={view.side}
          title="받은 기획서를 캔버스 옆에 같은 배율로 세웁니다"
          onClick={() => setOriginalView({ side: !view.side })}
        >
          나란히 보기
        </button>
        <button
          type="button"
          className={`btn orig-controls__btn${view.overlay ? ' is-active' : ''}`}
          aria-pressed={view.overlay}
          title="받은 기획서를 캔버스에 겹쳐 봅니다 (결과에는 남지 않습니다)"
          onClick={() => setOriginalView({ overlay: !view.overlay })}
        >
          겹쳐 보기
        </button>
      </div>
      {view.overlay && (
        <div className="orig-controls__row">
          <label className="orig-controls__range">
            <span>투명도</span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={percent}
              aria-label="원본 겹쳐 보기 불투명도"
              onChange={(e) => setOriginalView({ opacity: Number(e.target.value) / 100 })}
            />
            <span className="orig-controls__value">{percent}%</span>
          </label>
          <label className="orig-controls__check">
            <input type="checkbox" checked={view.front} onChange={(e) => setOriginalView({ front: e.target.checked })} />
            블록 앞에
          </label>
        </div>
      )}
    </section>
  )
}
