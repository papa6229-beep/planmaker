/**
 * 완성본 조각 하나의 후보정 창 (후보정 창 Patch, 2026-09-17).
 *
 * 전에는 오른쪽 "결과 톤 조절" 칸 안, 페이지 전체 슬라이더 **아래**의 "고른 것만"에
 * 밝기·레벨·커브·기울기·그림자·테두리가 한 줄로 쌓여 있었다. 멀고 길고, 전체와
 * 조각의 슬라이더가 헷갈렸다. 그래서 문구 디자인 창과 같이 **그 조각 옆에** 창을
 * 띄우고 탭으로 나눈다.
 *
 *   색 | 레벨·커브 | 그림자 | 테두리 | 모양      (이미지)
 *   글자 | 색 | 레벨·커브 | 모양                 (문구)
 *
 * 문구의 "글자" 탭은 글꼴·꾸밈·문구를 바꾼다 (살아 있는 문구 Patch). 바꾸면 그 조각만
 * 브라우저가 다시 그린다 — `LiveTextSync`.
 *
 * 그림자·테두리·종이·가장자리는 이미지를 합칠 때만 그려지므로 문구에는 없다.
 *
 * **끄는 동안 바로 보인다.** 값이 바뀔 때마다 저장하지 않는 그림을 한 장씩 그려
 * 완성본 자리에 걸고(`previewPage`), 손을 떼면 지금까지처럼 한 번 합쳐 저장한다.
 * 모든 조작은 외부 호출 0건이다.
 */

import { useState } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { RESET_TONE, TONE_FIELDS, toneIsFlat, type ToneAdjust } from '../../domain/toneAdjust'
import { imageObjectsOf } from '../../domain/studioJob'
import { DEFAULT_COMPOSITE_EFFECTS, type CompositeEffects } from '../../domain/compositeEffects'
import { PAPER_WEIGHT_MAX, PAPER_WEIGHT_MIN } from '../../domain/paperCutout'
import { ToneCurvePanel } from './ToneCurvePanel'
import { TextDesignEditor } from './TextDesignEditor'
import { useBriefEditor } from '../../features/editor/useBriefEditor'

export type PostEditTab = 'text' | 'color' | 'levels' | 'shadow' | 'outline' | 'shape'

const TAB_LABEL: Record<PostEditTab, string> = {
  text: '글자',
  color: '색',
  levels: '레벨·커브',
  shadow: '그림자',
  outline: '테두리',
  shape: '모양',
}

/** 그림자 방향 9칸 — 짧은 변의 몇 배를 미는가. 가운데는 제품 바로 뒤. */
export const SHADOW_PRESET_STEP = 0.1
const DIRECTIONS: readonly { dx: number; dy: number; label: string; icon: string }[] = [
  { dx: -1, dy: -1, label: '왼쪽 위', icon: '↖' },
  { dx: 0, dy: -1, label: '위', icon: '↑' },
  { dx: 1, dy: -1, label: '오른쪽 위', icon: '↗' },
  { dx: -1, dy: 0, label: '왼쪽', icon: '←' },
  { dx: 0, dy: 0, label: '가운데', icon: '·' },
  { dx: 1, dy: 0, label: '오른쪽', icon: '→' },
  { dx: -1, dy: 1, label: '왼쪽 아래', icon: '↙' },
  { dx: 0, dy: 1, label: '아래', icon: '↓' },
  { dx: 1, dy: 1, label: '오른쪽 아래', icon: '↘' },
]

type ShadowKey = 'wallShadow' | 'shadowBlur' | 'shadowX' | 'shadowY' | 'contactShadow'

function shadowIsDefault(effects: CompositeEffects): boolean {
  const d = DEFAULT_COMPOSITE_EFFECTS
  return (['contactShadow', 'wallShadow', 'shadowX', 'shadowY', 'shadowBlur'] as const).every(
    (k) => effects[k] === d[k],
  )
}

/** 무엇을 손댔는가 — 막대 버튼과 탭이 이것으로 표시를 단다. */
export function postEditMarks(
  tone: ToneAdjust,
  effects: CompositeEffects | null,
): { color: boolean; levels: boolean; shadow: boolean; outline: boolean } {
  const levels =
    (tone.curves !== undefined && Object.keys(tone.curves).length > 0) ||
    (tone.levels !== undefined && Object.keys(tone.levels).length > 0)
  const color = TONE_FIELDS.some((f) => tone[f.key] !== 0)
  return {
    color,
    levels,
    shadow: effects !== null && effects.shadow && (effects.wallShadow > 0 || effects.contactShadow > 0),
    outline: effects !== null && effects.outline,
  }
}

export function ObjectPostEditor({
  pageId,
  blockId,
  kind,
  label,
}: {
  pageId: string
  blockId: string
  kind: 'image' | 'text'
  label: string
}) {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const editor = useBriefEditor()
  const [tab, setTab] = useState<PostEditTab>(kind === 'text' ? 'text' : 'color')
  const [matching, setMatching] = useState<'idle' | 'running' | 'failed'>('idle')
  if (studio === null || generation === null) return null

  const busy = generation.state.kind === 'running'
  const tone = studio.objectToneOf(blockId)
  const effects = kind === 'image' ? studio.effectsOf(blockId) : null
  const marks = postEditMarks(tone, effects)
  const object = [...imageObjectsOf(studio.job, pageId), ...(studio.job.textObjects?.[pageId] ?? [])].find(
    (o) => o.blockId === blockId,
  )
  const tabs: PostEditTab[] =
    kind === 'image' ? ['color', 'levels', 'shadow', 'outline', 'shape'] : ['text', 'color', 'levels', 'shape']
  const shown = tabs.includes(tab) ? tab : tabs[0]!
  const textObject = kind === 'text' ? (studio.job.textObjects?.[pageId] ?? []).find((o) => o.blockId === blockId) : undefined
  /** 기획서의 지금 문구 — 글꼴 견본과 되돌리기에 쓴다. */
  const liveText = editor.state.brief.blocks.find((b) => b.id === blockId)?.content

  const preview = () => generation.previewPage(pageId)
  const settle = () => void generation.recomposePage(pageId)
  /** 슬라이더 하나가 쓰는 손잡이 — 누르면 되돌리기 한 칸, 끄는 동안 미리보기, 놓으면 합치기. */
  const drive = <T,>(apply: (value: number) => T) => ({
    disabled: busy,
    onPointerDown: () => studio.markStep(),
    onKeyDown: () => studio.markStep(),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      void Promise.resolve(apply(Number(e.target.value))).then(preview)
    },
    onPointerUp: settle,
    onKeyUp: settle,
  })
  const setFx = (patch: Partial<CompositeEffects>) => studio.setEffects(blockId, patch)

  const matchButton = (
    <div className="post-edit__match">
      <button
        type="button"
        className="btn"
        disabled={busy || matching === 'running'}
        title="주변 배경의 밝기·색을 재서 레벨 값을 채웁니다. 채운 뒤 레벨·커브에서 다듬으세요."
        onClick={() => {
          setMatching('running')
          void generation.matchToBackground(pageId, blockId).then((ok) => setMatching(ok ? 'idle' : 'failed'))
        }}
      >
        {matching === 'running' ? '재는 중…' : '배경에 맞추기'}
      </button>
      {matching === 'failed' && <span className="post-edit__warn">주변을 재지 못했습니다.</span>}
    </div>
  )

  const slider = (props: {
    key: string
    label: string
    value: number
    min: number
    max: number
    step?: number
    shown: string
    aria: string
    title?: string
    apply: (value: number) => unknown
  }) => (
    <label key={props.key} className="tone__slider">
      <span className="tone__slider-label">
        {props.label} · {props.shown}
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        aria-label={props.aria}
        {...(props.title === undefined ? {} : { title: props.title })}
        {...drive(props.apply)}
      />
    </label>
  )

  const SHADOW_FIELDS: readonly { key: ShadowKey; label: string; hint: string; min: number; max: number }[] = [
    { key: 'wallShadow', label: '드롭 진하기', hint: '제품 모양 그대로 밀어 까는 그림자', min: 0, max: 100 },
    { key: 'shadowBlur', label: '드롭 흐림', hint: '그림자 가장자리의 번짐', min: 0, max: 100 },
    { key: 'shadowX', label: '드롭 가로 위치', hint: '− 왼쪽 · + 오른쪽 (캔버스에서 끌어도 됩니다)', min: -150, max: 150 },
    { key: 'shadowY', label: '드롭 세로 위치', hint: '− 위 · + 아래 (캔버스에서 끌어도 됩니다)', min: -150, max: 150 },
    { key: 'contactShadow', label: '바닥', hint: '바닥에 닿은 자리의 납작한 그림자', min: 0, max: 100 },
  ]

  return (
    <section className="post-edit" aria-label={`${label} 후보정`}>
      <div className="post-edit__tabs" role="tablist" aria-label="후보정 종류">
        {tabs.map((t) => {
          const marked =
            (t === 'color' && marks.color) ||
            (t === 'levels' && marks.levels) ||
            (t === 'shadow' && marks.shadow) ||
            (t === 'outline' && marks.outline)
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={shown === t}
              className={`btn post-edit__tab${shown === t ? ' is-on' : ''}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
              {marked && <span className="text-design__dot" aria-label="손댄 값 있음" />}
            </button>
          )
        })}
      </div>

      {shown === 'text' && textObject !== undefined && (
        <div className="post-edit__pane">
          {textObject.live === true ? (
            <TextDesignEditor
              blockId={blockId}
              label={label}
              content={liveText ?? textObject.text ?? ''}
              where="result"
              // 완성본에서는 가리키기만으로 다시 그리지 않는다 — 누르면 바뀐다.
              onPreview={() => undefined}
            />
          ) : (
            <>
              <p className="post-edit__note">
                AI가 그림으로 만든 문구입니다. 텍스트로 되돌리면 글꼴·색·테두리·그림자를 여기서 바꿀 수 있습니다.
              </p>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  studio.markStep()
                  // 지문을 비워 두면 `LiveTextSync`가 지금 글꼴·꾸밈으로 다시 그린다.
                  void studio.setLiveText(pageId, blockId, {
                    live: true,
                    frame: { ...textObject.rect },
                    liveKey: '',
                    // 지금의 문구를 "만들 때의 문구"로 적어 둔다 — 이후 문구를 고쳐도 결과가
                    // 기획서와 어긋났다고 하지 않는다.
                    ...(liveText === undefined ? {} : { text: liveText }),
                  })
                }}
              >
                텍스트로 되돌리기
              </button>
            </>
          )}
        </div>
      )}

      {shown === 'color' && (
        <div className="post-edit__pane">
          {matchButton}
          <div className="tone__sliders">
            {TONE_FIELDS.map((field) =>
              slider({
                key: field.key,
                label: field.label,
                value: Math.round(tone[field.key] * 100),
                min: -100,
                max: 100,
                shown: `${tone[field.key] > 0 ? '+' : ''}${String(Math.round(tone[field.key] * 100))}`,
                aria: `${label} ${field.label} 조절`,
                apply: (v) => studio.setObjectTone(blockId, { [field.key]: v / 100 }),
              }),
            )}
            {effects !== null &&
              (
                [
                  { key: 'grading', label: '색 통일', hint: '배경 평균색을 조금 입힙니다' },
                  { key: 'rimLight', label: '림라이트', hint: '외곽에만 얹는 약한 빛' },
                ] as const
              ).map((field) =>
                slider({
                  key: field.key,
                  label: field.label,
                  value: Math.round(effects[field.key] * 100),
                  min: 0,
                  max: 100,
                  shown: `${String(Math.round(effects[field.key] * 100))}%`,
                  aria: `${label} ${field.label}`,
                  title: field.hint,
                  apply: (v) => setFx({ [field.key]: v / 100 }),
                }),
              )}
          </div>
        </div>
      )}

      {shown === 'levels' && (
        <div className="post-edit__pane">
          {matchButton}
          <ToneCurvePanel
            label={label}
            curves={tone.curves}
            levels={tone.levels}
            assetId={object?.assetId}
            busy={busy}
            onChange={(patch) => void studio.setObjectTone(blockId, patch).then(preview)}
            onStart={() => studio.markStep()}
            onCommit={settle}
          />
        </div>
      )}

      {shown === 'shadow' && effects !== null && (
        <div className="post-edit__pane">
          <label className="tone__shadow-switch">
            <input
              type="checkbox"
              checked={effects.shadow}
              disabled={busy}
              aria-label={`${label} 그림자`}
              onChange={() => {
                studio.markStep()
                setFx({ shadow: !effects.shadow })
                settle()
              }}
            />
            그림자
          </label>
          {effects.shadow && (
            <>
              <div className="post-edit__dirs" role="group" aria-label="그림자 방향">
                {DIRECTIONS.map((d) => {
                  const x = d.dx * SHADOW_PRESET_STEP
                  const y = d.dy * SHADOW_PRESET_STEP
                  const on = Math.abs(effects.shadowX - x) < 0.005 && Math.abs(effects.shadowY - y) < 0.005
                  return (
                    <button
                      key={d.label}
                      type="button"
                      className={`btn post-edit__dir${on ? ' is-on' : ''}`}
                      aria-label={`그림자 ${d.label}`}
                      aria-pressed={on}
                      title={`그림자 ${d.label}`}
                      disabled={busy}
                      onClick={() => {
                        studio.markStep()
                        setFx({
                          shadowX: x,
                          shadowY: y,
                          // 진하기가 0이면 방향을 눌러도 보이지 않는다 — 기본 진하기로 켠다.
                          ...(effects.wallShadow > 0 ? {} : { wallShadow: DEFAULT_COMPOSITE_EFFECTS.wallShadow }),
                        })
                        settle()
                      }}
                    >
                      {d.icon}
                    </button>
                  )
                })}
              </div>
              <div className="tone__sliders">
                {SHADOW_FIELDS.map((field) =>
                  slider({
                    key: field.key,
                    label: field.label,
                    value: Math.round(effects[field.key] * 100),
                    min: field.min,
                    max: field.max,
                    shown: `${String(Math.round(effects[field.key] * 100))}%`,
                    aria: `${label} ${field.label} 그림자 세기`,
                    title: field.hint,
                    apply: (v) => setFx({ [field.key]: v / 100 }),
                  }),
                )}
              </div>
            </>
          )}
        </div>
      )}

      {shown === 'outline' && effects !== null && (
        <div className="post-edit__pane">
          <label className="tone__shadow-switch">
            <input
              type="checkbox"
              checked={effects.outline}
              disabled={busy}
              aria-label={`${label} 테두리`}
              onChange={() => {
                studio.markStep()
                setFx({ outline: !effects.outline })
                settle()
              }}
            />
            테두리
          </label>
          {effects.outline && (
            <div className="tone__sliders">
              {(
                [
                  { key: 'outlineWidth', label: '두께' },
                  { key: 'outlineOpacity', label: '진하기' },
                ] as const
              ).map((field) =>
                slider({
                  key: field.key,
                  label: field.label,
                  value: Math.round(effects[field.key] * 100),
                  min: 0,
                  max: 100,
                  shown: `${String(Math.round(effects[field.key] * 100))}%`,
                  aria: `${label} 테두리 ${field.label}`,
                  apply: (v) => setFx({ [field.key]: v / 100 }),
                }),
              )}
              <label className="tone__slider">
                <span className="tone__slider-label">색</span>
                <input
                  type="color"
                  value={effects.outlineColor}
                  aria-label={`${label} 테두리 색`}
                  disabled={busy}
                  onFocus={() => studio.markStep()}
                  onChange={(e) => {
                    setFx({ outlineColor: e.target.value })
                    preview()
                  }}
                  onBlur={settle}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {shown === 'shape' && (
        <div className="post-edit__pane">
          <div className="tone__sliders">
            {object !== undefined &&
              slider({
                key: 'angle',
                label: '기울기',
                value: object.angle ?? 0,
                min: -180,
                max: 180,
                shown: `${String(object.angle ?? 0)}°`,
                aria: `${label} 기울기`,
                apply: (v) => studio.spinObject(pageId, blockId, v),
              })}
            {effects !== null &&
              slider({
                key: 'edge',
                label: '가장자리 정리',
                value: Math.round(effects.edge * 100),
                min: 0,
                max: 100,
                shown: `${String(Math.round(effects.edge * 100))}%`,
                aria: `${label} 가장자리 정리`,
                title: '누끼 가장자리에 남은 흰 테를 걷습니다',
                apply: (v) => setFx({ edge: v / 100 }),
              })}
            {effects?.paperCutout === true && (
              <>
                {slider({
                  key: 'paperWeight',
                  label: '종이 테두리 두께',
                  value: Math.round(effects.paperWeight * 100),
                  min: Math.round(PAPER_WEIGHT_MIN * 100),
                  max: Math.round(PAPER_WEIGHT_MAX * 100),
                  shown: `${effects.paperWeight.toFixed(2)}배`,
                  aria: `${label} 종이 테두리 두께`,
                  apply: (v) => setFx({ paperWeight: v / 100 }),
                })}
                {slider({
                  key: 'paperOpacity',
                  label: '종이 테두리 진하기',
                  value: Math.round(effects.paperOpacity * 100),
                  min: 0,
                  max: 100,
                  shown: `${String(Math.round(effects.paperOpacity * 100))}%`,
                  aria: `${label} 종이 테두리 진하기`,
                  apply: (v) => setFx({ paperOpacity: v / 100 }),
                })}
              </>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn tone__reset"
        disabled={busy || (toneIsFlat(tone) && (effects === null || shadowIsDefault(effects)))}
        onClick={() => {
          studio.markStep()
          // 그림자 **세기**도 함께 되돌린다. 켜고 끄기와 테두리·종이는 그대로 둔다.
          if (effects !== null) {
            setFx({
              contactShadow: DEFAULT_COMPOSITE_EFFECTS.contactShadow,
              wallShadow: DEFAULT_COMPOSITE_EFFECTS.wallShadow,
              shadowX: DEFAULT_COMPOSITE_EFFECTS.shadowX,
              shadowY: DEFAULT_COMPOSITE_EFFECTS.shadowY,
              shadowBlur: DEFAULT_COMPOSITE_EFFECTS.shadowBlur,
            })
          }
          void studio.setObjectTone(blockId, RESET_TONE).then(settle)
        }}
      >
        이것만 손대기 전으로
      </button>
    </section>
  )
}
