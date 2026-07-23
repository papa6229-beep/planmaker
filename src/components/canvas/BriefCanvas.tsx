/**
 * Center column: the planning canvas (WORK_PLAN §6, §10). This is a *layout of
 * intent*, not a design surface — it shows meaning cards at their soft
 * positions. Phase 3 enables move (drag) and resize on the cards themselves.
 *
 * The 840px sheet is scaled down to fit the screen; block coordinates stay in
 * true canvas space, so clicks, drags, and future exports remain accurate.
 */

import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { BriefBlockCard } from './BriefBlockCard'

const CANVAS_SCALE = 0.6

export function BriefCanvas() {
  const { state, selectBlock } = useBriefEditor()
  const { project, blocks } = state.brief
  const { canvasWidth, canvasHeight } = project
  const selected = new Set(state.selectedIds)

  return (
    <section className="canvas" aria-label="기획 캔버스">
      <div
        className="canvas__viewport"
        style={{ width: canvasWidth * CANVAS_SCALE, height: canvasHeight * CANVAS_SCALE }}
      >
        <div
          className="canvas__sheet"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `scale(${CANVAS_SCALE})`,
          }}
          role="presentation"
          onPointerDown={(e) => {
            // Clicking the empty sheet clears the selection.
            if (e.target === e.currentTarget) selectBlock(null)
          }}
        >
          {blocks.length === 0 && (
            <p className="canvas__empty">
              왼쪽 팔레트에서 블록을 클릭해 기획을 시작하세요.
            </p>
          )}
          {blocks.map((block) => (
            <BriefBlockCard
              key={block.id}
              block={block}
              selected={selected.has(block.id)}
              scale={CANVAS_SCALE}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
