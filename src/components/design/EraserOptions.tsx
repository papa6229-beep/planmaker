/**
 * 도구 막대 — 지우개를 들었을 때 (지우개 Patch, 2026-09-17).
 *
 * 크기·경도·세기와 되살리기. `[` `]`로 크기를 바꾼다. 고른 조각이 없으면 먼저 고르라고
 * 말한다 — 지우개는 고른 조각만 지운다.
 */

import { useStudioJob } from '../../features/studio/useStudioJob'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { setEraser, useDesignTools } from '../../features/studio/designTools'
import { useEraser } from '../../features/studio/useEraser'
import { NumField, ToggleButton } from './BarMenu'

/** 붓 값은 되돌리기 칸을 만들지 않는다 — 작업이 아니라 손버릇이다. */
const noop = () => {}

export function EraserOptions({ onResult, label }: { onResult: boolean; label: string | null }) {
  const studio = useStudioJob()
  const eraser = useEraser()
  const { activePageId } = useBriefDocument()
  const { eraser: brush } = useDesignTools()
  if (studio === null) return null
  if (!onResult) {
    return <span className="design-bar__note">지우개는 완성본에서 씁니다 — 완성본 화면으로 가세요 · Esc 끝</span>
  }
  const blockId = studio.selectedObjectBlockId
  const erased = blockId !== null && studio.eraseMaskOf(blockId) !== undefined
  return (
    <>
      <NumField
        label="붓 크기"
        suffix="px"
        value={brush.size}
        min={2}
        max={400}
        onStart={noop}
        onChange={(v) => setEraser({ size: v })}
      />
      <NumField
        label="경도"
        suffix="%"
        value={Math.round(brush.hardness * 100)}
        min={0}
        max={100}
        step={5}
        onStart={noop}
        onChange={(v) => setEraser({ hardness: v / 100 })}
      />
      <NumField
        label="세기"
        suffix="%"
        value={Math.round(brush.strength * 100)}
        min={5}
        max={100}
        step={5}
        onStart={noop}
        onChange={(v) => setEraser({ strength: v / 100 })}
      />
      <ToggleButton
        label="되살리기"
        icon="되살리기"
        on={brush.restore}
        onToggle={() => setEraser({ restore: !brush.restore })}
      />
      <button
        type="button"
        className="design-bar__btn"
        disabled={!erased}
        title="이 조각에서 지운 자리를 모두 되돌립니다"
        onClick={() => {
          if (blockId !== null && eraser !== null) void eraser.clear(activePageId, blockId)
        }}
      >
        지운 것 모두 되돌리기
      </button>
      <span className="design-bar__note">
        {blockId === null
          ? '지울 조각을 누르세요 · [ ] 크기 · Esc 끝'
          : `${label ?? '조각'}을(를) 문질러 지웁니다 · [ ] 크기 · Esc 끝`}
      </span>
    </>
  )
}
