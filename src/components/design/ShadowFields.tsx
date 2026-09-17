/**
 * 그림자 칸 (문구·도형 공통, 도구 막대 Patch). 방향은 8칸 단추로 빠르게, 각도 칸으로
 * 정확하게 — 포토샵 레이어 스타일의 드롭 섀도와 같은 다섯 값이다.
 */

import { ColorField, NumField, RangeField, ToggleButton } from './BarMenu'

const DIRS: readonly { angle: number; icon: string; label: string; col: number; row: number }[] = [
  { angle: 225, icon: '↖', label: '왼쪽 위', col: 1, row: 1 },
  { angle: 270, icon: '↑', label: '위', col: 2, row: 1 },
  { angle: 315, icon: '↗', label: '오른쪽 위', col: 3, row: 1 },
  { angle: 180, icon: '←', label: '왼쪽', col: 1, row: 2 },
  { angle: 0, icon: '→', label: '오른쪽', col: 3, row: 2 },
  { angle: 135, icon: '↙', label: '왼쪽 아래', col: 1, row: 3 },
  { angle: 90, icon: '↓', label: '아래', col: 2, row: 3 },
  { angle: 45, icon: '↘', label: '오른쪽 아래', col: 3, row: 3 },
]

export interface ShadowPatch {
  on?: boolean
  color?: string
  angle?: number
  distance?: number
  blur?: number
  opacity?: number
}

export function ShadowFields(props: {
  on: boolean
  color: string
  angle: number
  distance: number
  distanceMax: number
  blur: number
  blurMax: number
  opacity: number
  onStart: () => void
  onChange: (patch: ShadowPatch) => void
}) {
  const { onStart, onChange } = props
  return (
    <div className="shadow-fields">
      <div className="design-menu__row">
        <ToggleButton
          label="그림자 켜기"
          icon="그림자"
          on={props.on}
          onToggle={() => {
            onStart()
            onChange({ on: !props.on })
          }}
        />
        <ColorField label="그림자 색" value={props.color} onStart={onStart} onChange={(hex) => onChange({ color: hex })} />
      </div>
      <div className="shadow-fields__dirs" role="group" aria-label="그림자 방향">
        {DIRS.map((d) => (
          <button
            key={d.label}
            type="button"
            className={`design-bar__btn shadow-fields__dir${props.angle === d.angle ? ' is-on' : ''}`}
            style={{ gridColumn: String(d.col), gridRow: String(d.row) }}
            aria-label={`그림자 ${d.label}`}
            aria-pressed={props.angle === d.angle}
            disabled={!props.on}
            onClick={() => {
              onStart()
              onChange({ angle: d.angle })
            }}
          >
            {d.icon}
          </button>
        ))}
      </div>
      <NumField
        label="각도"
        suffix="°"
        value={props.angle}
        min={0}
        max={359}
        disabled={!props.on}
        onStart={onStart}
        onChange={(v) => onChange({ angle: v })}
      />
      <RangeField
        label="거리"
        shown={String(props.distance)}
        value={props.distance}
        min={0}
        max={props.distanceMax}
        disabled={!props.on}
        onStart={onStart}
        onChange={(v) => onChange({ distance: v })}
      />
      <RangeField
        label="흐림"
        shown={String(props.blur)}
        value={props.blur}
        min={0}
        max={props.blurMax}
        disabled={!props.on}
        onStart={onStart}
        onChange={(v) => onChange({ blur: v })}
      />
      <RangeField
        label="불투명도"
        shown={`${String(props.opacity)}%`}
        value={props.opacity}
        min={0}
        max={100}
        disabled={!props.on}
        onStart={onStart}
        onChange={(v) => onChange({ opacity: v })}
      />
    </div>
  )
}
