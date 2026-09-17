/**
 * 문구 하나의 모양 — 글꼴 · 꾸밈 (문구 디자인 창, 2026-09-17).
 *
 * 두 곳에서 같은 창을 쓴다.
 *
 *  - **기획서 캔버스**: 문구 블록 위 막대의 "글꼴 ▾" (생성 전)
 *  - **완성본**: 문구 조각의 "후보정 → 글자" (생성 후, 살아 있는 문구)
 *
 * 꾸밈은 색 · 테두리 · 그림자다. 주문 글을 읽어 짐작하지 않고, 작업자가 고른 값이
 * 곧 결과다 (살아 있는 문구 Patch). 아무것도 고르지 않았으면 꾸밈 없는 검정 글자다.
 *
 * AI 주문·참고 그림 탭은 지금 내려 두었다 — 사용자: "AI가 꾸미는 쪽은 다른 방식을
 * 고려해 볼 거야. 지금은 염두에 두지 말고." 저장된 주문 값은 지우지 않는다.
 */

import { useState } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import {
  DEFAULT_TEXT_LOOK,
  OUTLINE_WIDTH_RANGE,
  SHADOW_DISTANCE_RANGE,
  lookIsPlain,
  normalizeTextLook,
  type TextLook,
} from '../../domain/textLook'
import { FontPicker } from './FontPicker'

export type TextDesignTab = 'font' | 'look'

export function TextDesignEditor({
  blockId,
  label,
  content,
  onPreview,
  where = 'brief',
  onChanged,
}: {
  blockId: string
  /** 블록 이름 — 입력칸의 이름에 쓴다. */
  label: string
  /** 글꼴 견본에 쓸 그 문구. */
  content: string
  onPreview: (point: { family: string; weight?: number | undefined } | null) => void
  /**
   * 어디서 열었나. 완성본에서는 바꿀 때마다 되돌리기 칸을 남기고, 문구 자체도
   * 여기서 고칠 수 있다 (캔버스에서는 블록을 두 번 눌러 고친다).
   */
  where?: 'brief' | 'result'
  /** 값이 바뀐 뒤 — 완성본이 다시 그릴 때를 알린다. */
  onChanged?: () => void
}) {
  const studio = useStudioJob()
  const editor = useBriefEditor()
  const [tab, setTab] = useState<TextDesignTab>('font')
  const [draft, setDraft] = useState<string | null>(null)
  if (studio === null) return null

  const order = studio.blockOrderOf(blockId)
  const look = normalizeTextLook(order.look ?? DEFAULT_TEXT_LOOK)
  const block = editor.state.brief.blocks.find((b) => b.id === blockId)
  const inResult = where === 'result'

  const mark = () => {
    if (inResult) studio.markStep()
  }
  const setLook = (patch: Partial<TextLook>) => {
    void studio.setBlockOrder(blockId, { look: { ...look, ...patch } }).then(() => onChanged?.())
  }

  const TABS: readonly { key: TextDesignTab; label: string; marked: boolean; missing?: boolean }[] = [
    { key: 'font', label: '글꼴', marked: false, missing: order.fontFamily === undefined },
    { key: 'look', label: '꾸밈', marked: !lookIsPlain(look) },
  ]

  const colorInput = (value: string, aria: string, apply: (hex: string) => void) => (
    <input
      type="color"
      className="text-design__color"
      value={value}
      aria-label={aria}
      onFocus={mark}
      onChange={(e) => apply(e.target.value)}
    />
  )

  const rangeInput = (props: { value: number; range: readonly [number, number]; aria: string; apply: (v: number) => void }) => (
    <input
      type="range"
      min={Math.round(props.range[0] * 100)}
      max={Math.round(props.range[1] * 100)}
      value={Math.round(props.value * 100)}
      aria-label={props.aria}
      onPointerDown={mark}
      onKeyDown={mark}
      onChange={(e) => props.apply(Number(e.target.value) / 100)}
    />
  )

  return (
    <section className="text-design" aria-label="이 블록의 디자인 주문">
      <div className="text-design__tabs" role="tablist" aria-label="문구 디자인">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`btn text-design__tab${tab === t.key ? ' is-on' : ''}${t.missing === true ? ' is-missing' : ''}`}
            onClick={() => {
              setTab(t.key)
              if (t.key !== 'font') onPreview(null)
            }}
          >
            {t.label}
            {t.marked && <span className="text-design__dot" aria-label="적힌 것 있음" />}
          </button>
        ))}
      </div>

      {/* 완성본에서는 문구도 여기서 고친다 — 고치면 그 조각만 다시 그려진다. */}
      {inResult && block !== undefined && (
        <label className="text-design__field">
          <span className="text-design__label">문구</span>
          <textarea
            className="field__input text-design__content"
            aria-label={`${label} 문구`}
            rows={2}
            value={draft ?? block.content ?? ''}
            onFocus={() => setDraft(block.content ?? '')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== (block.content ?? '') && draft.trim().length > 0) {
                // 문구만 바꾼다. 기획서 상자는 건드리지 않는다 — 완성본의 조각은 제 틀 안에서
                // 다시 그려지고, 상자가 바뀌면 결과가 기획서와 어긋났다고 읽힌다.
                editor.updateBlock(blockId, { content: draft })
                onChanged?.()
              }
              setDraft(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur()
            }}
          />
        </label>
      )}

      {tab === 'font' && (
        <FontPicker
          sample={content}
          family={order.fontFamily}
          weight={order.fontWeight}
          autoFocus={!inResult}
          onPick={(patch) => {
            mark()
            void studio.setBlockOrder(blockId, patch).then(() => onChanged?.())
          }}
          onPreview={onPreview}
        />
      )}

      {tab === 'look' && (
        <div className="text-design__pane">
          <div className="text-design__group" role="group" aria-label="글자색 설정">
            <span className="text-design__label">글자색</span>
            <div className="text-design__row">
              {(
                [
                  { fill: 'solid', label: '단색' },
                  { fill: 'gradient', label: '그라데이션' },
                ] as const
              ).map((f) => (
                <button
                  key={f.fill}
                  type="button"
                  className={`btn text-design__chip${look.fill === f.fill ? ' is-on' : ''}`}
                  aria-pressed={look.fill === f.fill}
                  onClick={() => {
                    mark()
                    setLook({ fill: f.fill })
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="text-design__row">
              {colorInput(look.color, look.fill === 'gradient' ? '글자 위쪽 색' : '글자색', (hex) => setLook({ color: hex }))}
              {look.fill === 'gradient' && colorInput(look.color2, '글자 아래쪽 색', (hex) => setLook({ color2: hex }))}
            </div>
          </div>

          <div className="text-design__group" role="group" aria-label="테두리 설정">
            <label className="text-design__switch">
              <input
                type="checkbox"
                checked={look.outline}
                aria-label="테두리"
                onChange={() => {
                  mark()
                  setLook({ outline: !look.outline })
                }}
              />
              테두리
            </label>
            {look.outline && (
              <div className="text-design__row">
                {colorInput(look.outlineColor, '테두리 색', (hex) => setLook({ outlineColor: hex }))}
                <span className="text-design__label">두께 {Math.round(look.outlineWidth * 100)}</span>
                {rangeInput({
                  value: look.outlineWidth,
                  range: OUTLINE_WIDTH_RANGE,
                  aria: '테두리 두께',
                  apply: (v) => setLook({ outlineWidth: v }),
                })}
              </div>
            )}
          </div>

          <div className="text-design__group" role="group" aria-label="그림자 설정">
            <label className="text-design__switch">
              <input
                type="checkbox"
                checked={look.shadow}
                aria-label="글자 그림자"
                onChange={() => {
                  mark()
                  setLook({ shadow: !look.shadow })
                }}
              />
              그림자
            </label>
            {look.shadow && (
              <div className="text-design__row">
                {colorInput(look.shadowColor, '그림자 색', (hex) => setLook({ shadowColor: hex }))}
                <span className="text-design__label">거리 {Math.round(look.shadowDistance * 100)}</span>
                {rangeInput({
                  value: look.shadowDistance,
                  range: SHADOW_DISTANCE_RANGE,
                  aria: '그림자 거리',
                  apply: (v) => setLook({ shadowDistance: v }),
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn text-design__reset"
            disabled={lookIsPlain(look) && look.color === DEFAULT_TEXT_LOOK.color}
            onClick={() => {
              mark()
              void studio.setBlockOrder(blockId, { look: undefined }).then(() => onChanged?.())
            }}
          >
            꾸밈 없애기
          </button>
        </div>
      )}
    </section>
  )
}
