/**
 * 완성 결과 전체의 톤 조절 (톤 조절 Patch).
 *
 * 포토샵의 곡선을 옮기지 않는다. 곡선은 그래프를 손으로 끌어야 쓸모가 있고, 그
 * 화면은 여기 있는 어떤 패널보다 크다. 먼저 슬라이더 넷을 둔다 — 실무에서 손대는
 * 것의 대부분이 여기서 끝난다.
 *
 * **원본은 바뀌지 않는다.** 여기 적히는 값은 다시 그릴 때 곱하는 것이라, 전부
 * 0으로 내리면 손대기 전 그림이 그대로 돌아온다. AI 호출도 없다 — 그림은 전부
 * 손에 있고 다시 합치기만 하면 된다.
 *
 * 결과가 있을 때만 나온다. 없는 결과의 톤을 미리 조절할 수는 없다.
 */

import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { RESET_TONE, TONE_FIELDS, toneIsFlat } from '../../domain/toneAdjust'
import { imageObjectsOf, pageResultOf } from '../../domain/studioJob'
import { ToneCurvePanel } from './ToneCurvePanel'
import { lightKeyOf } from '../../domain/lightLayer'
import { useState } from 'react'
import { DEFAULT_COMPOSITE_EFFECTS, type CompositeEffects } from '../../domain/compositeEffects'
import { PanelFold } from './PanelFold'

export function ToneAdjustPanel() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { activePageId } = useBriefDocument()
  if (studio === null || generation === null || !generation.hasResult) return null

  const tone = studio.toneOf(activePageId)
  const busy = generation.state.kind === 'running'
  /** 손을 뗀 뒤 한 번 다시 합친다. 끄는 동안 매번 합치면 화면이 버벅인다. */
  const settle = () => void generation.recomposePage(activePageId)

  return (
    <PanelFold id="tone" title="결과 톤 조절" note="빛 맞추기 · 밝기 · 대비 · 채도 · 색온도 · 레벨 · 커브 · 그림자 · 테두리" marked={!toneIsFlat(tone)}>
    <section className="tone" aria-label="결과 톤 조절">
      <LightMatch pageId={activePageId} busy={busy} />

      <p className="tone__note">
        완성 결과 전체에 겁니다. 원본은 그대로 두고 그릴 때마다 이 값으로 다시 계산합니다.
      </p>

      <div className="tone__sliders">
        {TONE_FIELDS.map((field) => (
          <label key={field.key} className="tone__slider">
            <span className="tone__slider-label">
              {field.label} · {tone[field.key] > 0 ? '+' : ''}
              {Math.round(tone[field.key] * 100)}
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(tone[field.key] * 100)}
              aria-label={`${field.label} 조절`}
              disabled={busy}
              // 슬라이더 한 번 끄는 것이 되돌리기 한 칸이다 (결과 되돌리기 Patch).
              onPointerDown={() => studio.markStep()}
              onKeyDown={() => studio.markStep()}
              onChange={(e) => void studio.setTone(activePageId, { [field.key]: Number(e.target.value) / 100 })}
              onPointerUp={settle}
              onKeyUp={settle}
            />
          </label>
        ))}
      </div>

      <details className="tone__fold">
        <summary>레벨 · 커브</summary>
        <ToneCurvePanel
          label="결과 전체"
          curves={tone.curves}
          levels={tone.levels}
          assetId={pageResultOf(studio.job, activePageId)?.assetId}
          busy={busy}
          onChange={(patch) => void studio.setTone(activePageId, patch)}
          onStart={() => studio.markStep()}
          onCommit={settle}
        />
      </details>

      <button
        type="button"
        className="btn tone__reset"
        disabled={busy || toneIsFlat(tone)}
        onClick={() => {
          studio.markStep()
          void studio.setTone(activePageId, RESET_TONE).then(settle)
        }}
      >
        손대기 전으로
      </button>

      <ObjectTone settle={settle} busy={busy} />
    </section>
    </PanelFold>
  )
}

/**
 * 빛 맞추기 버튼 (빛 층 Patch, 2026-09-17).
 *
 * 제품 자리를 정한 **뒤에** 누른다. 이미지 오브젝트 모양의 회색 덩어리에 엔진이
 * 장면의 빛을 입히고, 그 빛만 원본 제품에 얹는다 — 제품 그림은 엔진에 가지 않는다.
 * 제품 둘레 배경에는 그림자가 생긴다. 외부 호출 1회.
 *
 * 오브젝트를 골랐으면 그것만, 아니면 페이지의 이미지 오브젝트 전부.
 */
function LightMatch({ pageId, busy }: { pageId: string; busy: boolean }) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const [concept, setConcept] = useState('')
  if (studio === null || generation === null) return null
  const selected = studio.selectedObjectBlockId
  const isImage = selected !== null && imageObjectsOf(studio.job, pageId).some((o) => o.blockId === selected)
  const run = () =>
    void generation.matchLight(pageId, {
      ...(isImage && selected !== null ? { blockIds: [selected] } : {}),
      concept,
    })
  return (
    <div className="light-match">
      <p className="tone__object-title">빛 맞추기</p>
      <p className="tone__note">
        제품 위치를 정한 뒤 누르세요. 배경의 조명을 제품에 입힙니다 — 옮기면 함께 움직입니다. 그림자는 아래
        오브젝트 칸의 그림자로 맞추세요. 제품 그림은 AI에 보내지 않습니다.
      </p>
      <input
        type="text"
        className="field__input light-match__concept"
        placeholder="조명 컨셉 (선택) 예: 왼쪽 위에서 들어오는 따뜻한 햇살"
        aria-label="빛 맞추기 조명 컨셉"
        value={concept}
        disabled={busy}
        onChange={(e) => setConcept(e.target.value)}
      />
      <button type="button" className="btn btn--primary light-match__run" disabled={busy} onClick={run}>
        {isImage ? '고른 이미지만 빛 맞추기' : '이미지 전부 빛 맞추기'}
      </button>
    </div>
  )
}

/**
 * 고른 오브젝트의 기울기 (2026-09-17). 캔버스의 회전 손잡이와 같은 값이다 — 손잡이를
 * 찾기 어렵다는 말에 숫자로도 맞출 수 있게 둔다.
 */
function ObjectAngle({
  blockId,
  pageId,
  label,
  settle,
  busy,
}: {
  blockId: string
  pageId: string
  label: string
  settle: () => void
  busy: boolean
}) {
  const studio = useStudioJob()
  if (studio === null) return null
  const object = [...imageObjectsOf(studio.job, pageId), ...(studio.job.textObjects?.[pageId] ?? [])].find(
    (o) => o.blockId === blockId,
  )
  if (object === undefined) return null
  const angle = object.angle ?? 0
  return (
    <label className="tone__slider">
      <span className="tone__slider-label">기울기 · {angle}°</span>
      <input
        type="range"
        min={-180}
        max={180}
        value={angle}
        aria-label={`${label} 기울기`}
        disabled={busy}
        onPointerDown={() => studio.markStep()}
        onKeyDown={() => studio.markStep()}
        onChange={(e) => studio.spinObject(pageId, blockId, Number(e.target.value))}
        onPointerUp={settle}
        onKeyUp={settle}
      />
    </label>
  )
}

/**
 * 고른 오브젝트의 빛 층 세기 (빛 층 Patch). 빛 맞추기를 한 오브젝트에만 나온다.
 */
function ObjectLight({
  blockId,
  pageId,
  label,
  settle,
  busy,
}: {
  blockId: string
  pageId: string
  label: string
  settle: () => void
  busy: boolean
}) {
  const studio = useStudioJob()
  if (studio === null) return null
  const effects = studio.effectsOf(blockId)
  if (effects.lightAssetId === undefined) return null
  const object = imageObjectsOf(studio.job, pageId).find((o) => o.blockId === blockId)
  const moved = object !== undefined && effects.lightKey !== undefined && effects.lightKey !== lightKeyOf(object.rect, object.angle)
  return (
    <div className="tone__shadow">
      <label className="tone__shadow-switch">
        <input
          type="checkbox"
          checked={effects.light}
          disabled={busy}
          aria-label={`${label} 빛 층`}
          onChange={() => {
            studio.markStep()
            studio.setEffects(blockId, { light: !effects.light })
            settle()
          }}
        />
        빛 층
      </label>
      {moved && (
        <p className="light-match__stale">
          자리나 기울기가 바뀌었습니다. 빛 층은 따라왔지만, 새 자리의 조명에 맞추려면 빛 맞추기를 다시 누르세요.
        </p>
      )}
      {effects.light && (
        <label className="tone__slider">
          <span className="tone__slider-label">세기 · {Math.round(effects.lightStrength * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(effects.lightStrength * 100)}
            aria-label={`${label} 빛 층 세기`}
            disabled={busy}
            onPointerDown={() => studio.markStep()}
            onKeyDown={() => studio.markStep()}
            onChange={(e) => studio.setEffects(blockId, { lightStrength: Number(e.target.value) / 100 })}
            onPointerUp={settle}
            onKeyUp={settle}
          />
        </label>
      )}
    </div>
  )
}

/**
 * 고른 오브젝트 하나에만 거는 톤 (블록별 톤 Patch).
 *
 * 위의 전체 톤과 **따로** 산다. 사진 하나만 어둡게 깔고 페이지 전체를 밝히는 일은
 * 한 벌의 값으로는 되지 않는다. 그리는 차례도 그대로다 — 이 값이 먼저 걸리고,
 * 다 그린 뒤에 전체 톤이 한 번 더 걸린다.
 *
 * 오브젝트를 고르지 않았으면 나오지 않는다. 무엇에 걸리는지 화면이 말하지 못하는
 * 슬라이더는 두지 않는다.
 */
/** 세기 둘이 기본값 그대로인가 — 되돌릴 것이 있는지 판정할 때 쓴다. */
function shadowIsDefault(effects: CompositeEffects): boolean {
  return (
    effects.contactShadow === DEFAULT_COMPOSITE_EFFECTS.contactShadow &&
    effects.wallShadow === DEFAULT_COMPOSITE_EFFECTS.wallShadow
  )
}

/**
 * 고른 오브젝트의 그림자 (완성 후 그림자 Patch).
 *
 * 그림자는 AI가 그린 것이 아니라 합칠 때마다 브라우저가 그리는 것이다. 종이
 * 테두리와 같다 — 값만 바꾸고 다시 합치면 그만이고, **외부 호출은 0건이다.**
 *
 * 그런데 조절 자리는 생성 **전** 화면에만 있었다. 알맞은 그림자는 완성된 배경
 * 위에서라야 보이는데(어두운 배경에서는 진한 그림자가 묻히고 밝은 배경에서는
 * 도드라진다) 정작 그때는 만질 수가 없었다. 톤 슬라이더와 같은 대상, 같은 성격,
 * 같은 조작이므로 같은 칸에 둔다 — 제품 하나를 고르고 밝기와 그림자를 한자리에서
 * 맞춘다.
 *
 * 세기 둘은 **켠 자리에만** 나온다. 꺼 둔 블록에 보여 주면 무엇의 세기인지
 * 화면이 말해 주지 못한다 (종이 테두리와 같은 규칙이다).
 */
function ObjectShadow({
  blockId,
  label,
  settle,
  busy,
}: {
  blockId: string
  label: string
  settle: () => void
  busy: boolean
}) {
  const studio = useStudioJob()
  if (studio === null) return null

  const effects = studio.effectsOf(blockId)
  const fields = [
    { key: 'contactShadow' as const, label: '바닥', hint: '바닥에 닿은 자리의 그림자' },
    { key: 'wallShadow' as const, label: '뒤', hint: '빛 반대쪽(없으면 오른쪽 아래)으로 밀린 그림자 — 세게 할수록 멀고 진하다' },
  ]

  return (
    <div className="tone__shadow">
      <label className="tone__shadow-switch">
        <input
          type="checkbox"
          checked={effects.shadow}
          disabled={busy}
          aria-label={`${label} 그림자`}
          onChange={() => {
            studio.markStep()
            studio.setEffects(blockId, { shadow: !effects.shadow })
            settle()
          }}
        />
        그림자
      </label>
      {effects.shadow && (
        <div className="tone__sliders">
          {fields.map((field) => (
            <label key={field.key} className="tone__slider">
              <span className="tone__slider-label">
                {field.label} · {Math.round(effects[field.key] * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effects[field.key] * 100)}
                aria-label={`${label} ${field.label} 그림자 세기`}
                title={field.hint}
                disabled={busy}
                onPointerDown={() => studio.markStep()}
                onKeyDown={() => studio.markStep()}
                onChange={(e) => studio.setEffects(blockId, { [field.key]: Number(e.target.value) / 100 })}
                onPointerUp={settle}
                onKeyUp={settle}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 고른 오브젝트의 테두리 (후보정 테두리 Patch, 2026-09-17).
 *
 * 스티커처럼 사진 윤곽을 따라가는 선이다. 그림자와 같은 까닭으로 여기 둔다 —
 * 어울리는 두께와 색은 완성된 배경 위에서라야 보인다. 합칠 때 그리기만 하므로
 * AI 호출도 생성 방식도 건드리지 않는다 (종이 컷아웃과 다른 점).
 */
let colorTimer: ReturnType<typeof setTimeout> | undefined

function ObjectOutline({
  blockId,
  label,
  settle,
  busy,
}: {
  blockId: string
  label: string
  settle: () => void
  busy: boolean
}) {
  const studio = useStudioJob()
  if (studio === null) return null
  const effects = studio.effectsOf(blockId)
  const sliders = [
    { key: 'outlineWidth' as const, label: '두께' },
    { key: 'outlineOpacity' as const, label: '진하기' },
  ]

  return (
    <div className="tone__shadow">
      <label className="tone__shadow-switch">
        <input
          type="checkbox"
          checked={effects.outline}
          disabled={busy}
          aria-label={`${label} 테두리`}
          onChange={() => {
            studio.markStep()
            studio.setEffects(blockId, { outline: !effects.outline })
            settle()
          }}
        />
        테두리
      </label>
      {effects.outline && (
        <div className="tone__sliders">
          {sliders.map((field) => (
            <label key={field.key} className="tone__slider">
              <span className="tone__slider-label">
                {field.label} · {Math.round(effects[field.key] * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(effects[field.key] * 100)}
                aria-label={`${label} 테두리 ${field.label}`}
                disabled={busy}
                onPointerDown={() => studio.markStep()}
                onKeyDown={() => studio.markStep()}
                onChange={(e) => studio.setEffects(blockId, { [field.key]: Number(e.target.value) / 100 })}
                onPointerUp={settle}
                onKeyUp={settle}
              />
            </label>
          ))}
          <label className="tone__slider">
            <span className="tone__slider-label">색</span>
            <input
              type="color"
              value={effects.outlineColor}
              aria-label={`${label} 테두리 색`}
              disabled={busy}
              onFocus={() => studio.markStep()}
              onChange={(e) => {
                studio.setEffects(blockId, { outlineColor: e.target.value })
                // 색 고르개는 끄는 동안 값을 계속 보낸다. 멈춘 뒤 한 번만 다시 합친다.
                if (colorTimer !== undefined) clearTimeout(colorTimer)
                colorTimer = setTimeout(settle, 250)
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function ObjectTone({ settle, busy }: { settle: () => void; busy: boolean }) {
  const studio = useStudioJob()
  const { pages, activePageId } = useBriefDocument()
  const blockId = studio?.selectedObjectBlockId ?? null
  if (studio === null || blockId === null) return null

  const label =
    pages.find((p) => p.id === activePageId)?.blocks.find((b) => b.id === blockId)?.label ?? '고른 오브젝트'
  const tone = studio.objectToneOf(blockId)

  return (
    <div className="tone__object">
      <p className="tone__object-title">고른 것만 · {label}</p>
      <div className="tone__sliders">
        {TONE_FIELDS.map((field) => (
          <label key={field.key} className="tone__slider">
            <span className="tone__slider-label">
              {field.label} · {tone[field.key] > 0 ? '+' : ''}
              {Math.round(tone[field.key] * 100)}
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(tone[field.key] * 100)}
              aria-label={`${label} ${field.label} 조절`}
              disabled={busy}
              onPointerDown={() => studio.markStep()}
              onKeyDown={() => studio.markStep()}
              onChange={(e) =>
                void studio.setObjectTone(blockId, { [field.key]: Number(e.target.value) / 100 })
              }
              onPointerUp={settle}
              onKeyUp={settle}
            />
          </label>
        ))}
      </div>
      <details className="tone__fold">
        <summary>레벨 · 커브</summary>
        <ToneCurvePanel
          label={label}
          curves={tone.curves}
          levels={tone.levels}
          assetId={imageObjectsOf(studio.job, activePageId).find((o) => o.blockId === blockId)?.assetId}
          busy={busy}
          onChange={(patch) => void studio.setObjectTone(blockId, patch)}
          onStart={() => studio.markStep()}
          onCommit={settle}
        />
      </details>
      <ObjectAngle blockId={blockId} pageId={activePageId} label={label} settle={settle} busy={busy} />
      <ObjectLight blockId={blockId} pageId={activePageId} label={label} settle={settle} busy={busy} />
      <ObjectShadow blockId={blockId} label={label} settle={settle} busy={busy} />
      <ObjectOutline blockId={blockId} label={label} settle={settle} busy={busy} />
      <button
        type="button"
        className="btn tone__reset"
        disabled={busy || (toneIsFlat(tone) && shadowIsDefault(studio.effectsOf(blockId)))}
        onClick={() => {
          studio.markStep()
          // 그림자 **세기**도 함께 되돌린다. 켜고 끄기는 건드리지 않는다 — 그 값은
          // 작업자가 정했거나, 실루엣을 보고 처음에 정해진 것이라 "손댄 값"이 아니다.
          studio.setEffects(blockId, {
            contactShadow: DEFAULT_COMPOSITE_EFFECTS.contactShadow,
            wallShadow: DEFAULT_COMPOSITE_EFFECTS.wallShadow,
          })
          void studio.setObjectTone(blockId, RESET_TONE).then(settle)
        }}
      >
        이것만 손대기 전으로
      </button>
    </div>
  )
}
