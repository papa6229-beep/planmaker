/**
 * 도구 막대 — 도형·선을 골랐을 때 (도형 도구 Patch, 2026-09-17).
 *
 * 일러스트레이터 컨트롤 패널의 채우기·획과 같은 자리다. 모양을 바꾸면 같은 상자에서
 * 바로 다른 도형이 된다. 값은 작업판에 적히고 캔버스와 완성본이 같은 붓으로 다시
 * 그려진다. AI 호출은 없다.
 */

import { useStudioJob } from '../../features/studio/useStudioJob'
import type { DesignTarget } from '../../features/studio/designTarget'
import { SHAPE_KINDS, normalizeShapeLook, type ShapeKind, type ShapeLook, type StrokeDash } from '../../domain/shapeLook'
import { BarMenu, ColorField, NumField, ToggleButton } from './BarMenu'
import { ShadowFields } from './ShadowFields'
import { ToneMenus } from './TextOptions'

export function ShapeOptions({ target, label }: { target: DesignTarget; label: string }) {
  const studio = useStudioJob()
  if (studio === null) return null
  const id = target.blockId
  const look = normalizeShapeLook(studio.blockOrderOf(id).shape)
  const isLine = look.kind === 'line'
  /** 그림자만 남긴 도형 — 채우기·테두리는 보이지 않으므로 묻지 않는다 (그림자 레이어 Patch). */
  const shadowOnly = look.shadowOnly
  const mark = () => studio.markStep()
  const setShape = (patch: Partial<ShapeLook>) =>
    void studio.setBlockOrder(id, { shape: normalizeShapeLook({ ...look, ...patch }) })

  return (
    <>
      <label className="design-bar__select" title="모양">
        <select
          aria-label="도형 모양"
          value={look.kind}
          onFocus={mark}
          onChange={(e) => {
            const kind = e.target.value as ShapeKind
            // 선에서 면으로 바꾸면 채우기를 켠다 — 아무것도 안 보이는 도형이 되지 않게.
            setShape(kind === 'line' ? { kind } : { kind, ...(isLine ? { fill: true, stroke: false } : {}) })
          }}
        >
          {SHAPE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.icon} {k.label}
            </option>
          ))}
        </select>
      </label>

      {!isLine && (
        <ToggleButton
          label="그림자만"
          icon="그림자만"
          on={shadowOnly}
          onToggle={() => {
            mark()
            setShape(shadowOnly ? { shadowOnly: false } : { shadowOnly: true, fill: true })
          }}
        />
      )}

      {!isLine && !shadowOnly && (
        <>
          <ToggleButton
            label="채우기"
            icon="채우기"
            on={look.fill}
            onToggle={() => {
              mark()
              setShape({ fill: !look.fill })
            }}
          />
          <ColorField label="채우기 색" value={look.fillColor} disabled={!look.fill} onStart={mark} onChange={(hex) => setShape({ fillColor: hex })} />
          <ToggleButton
            label="채우기 그라데이션"
            icon="그라데이션"
            on={look.fillMode === 'gradient'}
            disabled={!look.fill}
            onToggle={() => {
              mark()
              setShape({ fillMode: look.fillMode === 'gradient' ? 'solid' : 'gradient' })
            }}
          />
          {look.fillMode === 'gradient' && look.fill && (
            <ColorField label="채우기 아래 색" value={look.fillColor2} onStart={mark} onChange={(hex) => setShape({ fillColor2: hex })} />
          )}
          <ToggleButton
            label="테두리"
            icon="테두리"
            on={look.stroke}
            onToggle={() => {
              mark()
              setShape({ stroke: !look.stroke })
            }}
          />
        </>
      )}

      {!shadowOnly && (
        <>
          <ColorField
            label={isLine ? '선 색' : '테두리 색'}
            value={look.strokeColor}
            disabled={!look.stroke}
            onStart={mark}
            onChange={(hex) => setShape({ strokeColor: hex })}
          />
          <NumField
            label={isLine ? '선 두께' : '테두리 두께'}
            suffix="px"
            value={look.strokeWidth}
            min={0.5}
            max={60}
            step={0.5}
            disabled={!look.stroke}
            onStart={mark}
            onChange={(v) => setShape({ strokeWidth: v })}
          />
          <label className="design-bar__select" title="선 모양">
            <select
              aria-label="선 모양"
              value={look.dash}
              disabled={!look.stroke}
              onFocus={mark}
              onChange={(e) => setShape({ dash: e.target.value as StrokeDash })}
            >
              <option value="solid">━ 실선</option>
              <option value="dashed">┅ 점선(긴)</option>
              <option value="dotted">┈ 점선(점)</option>
            </select>
          </label>
        </>
      )}

      {(look.kind === 'roundRect' || look.kind === 'bubble') && (
        <NumField
          label="모서리"
          suffix="%"
          value={Math.round(look.radius * 100)}
          min={0}
          max={50}
          onStart={mark}
          onChange={(v) => setShape({ radius: v / 100 })}
        />
      )}
      {(look.kind === 'polygon' || look.kind === 'star') && (
        <NumField
          label={look.kind === 'star' ? '꼭짓점' : '변'}
          value={look.sides}
          min={3}
          max={12}
          onStart={mark}
          onChange={(v) => setShape({ sides: v })}
        />
      )}
      {look.kind === 'star' && (
        <NumField
          label="안쪽"
          suffix="%"
          value={Math.round(look.inner * 100)}
          min={15}
          max={95}
          onStart={mark}
          onChange={(v) => setShape({ inner: v / 100 })}
        />
      )}
      {isLine && (
        <>
          <ToggleButton
            label="시작 화살표"
            icon="◀ 시작"
            on={look.arrowStart}
            onToggle={() => {
              mark()
              setShape({ arrowStart: !look.arrowStart })
            }}
          />
          <ToggleButton
            label="끝 화살표"
            icon="끝 ▶"
            on={look.arrowEnd}
            onToggle={() => {
              mark()
              setShape({ arrowEnd: !look.arrowEnd })
            }}
          />
        </>
      )}

      <BarMenu label="그림자" icon="그림자" marked={look.shadow} width={280}>
        <ShadowFields
          on={look.shadow}
          color={look.shadowColor}
          angle={look.shadowAngle}
          distance={Math.round(look.shadowDistance)}
          distanceMax={200}
          blur={Math.round(look.shadowBlur)}
          blurMax={100}
          opacity={Math.round(look.shadowOpacity * 100)}
          onStart={mark}
          onChange={(patch) =>
            setShape({
              ...(patch.on === undefined ? {} : { shadow: patch.on }),
              ...(patch.color === undefined ? {} : { shadowColor: patch.color }),
              ...(patch.angle === undefined ? {} : { shadowAngle: patch.angle }),
              ...(patch.distance === undefined ? {} : { shadowDistance: patch.distance }),
              ...(patch.blur === undefined ? {} : { shadowBlur: patch.blur }),
              ...(patch.opacity === undefined ? {} : { shadowOpacity: patch.opacity / 100 }),
            })
          }
        />
      </BarMenu>
      <NumField
        label="불투명도"
        suffix="%"
        value={Math.round(look.opacity * 100)}
        min={0}
        max={100}
        onStart={mark}
        onChange={(v) => setShape({ opacity: v / 100 })}
      />
      <ToneMenus target={target} label={label} />
    </>
  )
}
