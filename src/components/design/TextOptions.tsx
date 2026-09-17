/**
 * 도구 막대 — 문구를 골랐을 때 (문자 도구 Patch, 2026-09-17).
 *
 * 포토샵 문자 도구의 옵션 막대와 같은 자리다. 글꼴·굵기·색·크기는 **고른 글자**가
 * 있으면 그 글자에만, 없으면 문구 전체에 걸린다. 글자는 캔버스의 글상자에서 끌어
 * 고르거나 "글자 선택" 창에서 고른다. 테두리·그림자·자간·행간·세로쓰기·휘기는
 * 문구 전체의 값이다. 레벨·커브는 이미지와 같은 창을 쓴다.
 *
 * 값은 전부 작업판에 적히고, 캔버스 미리보기와 완성본 조각이 같은 붓으로 다시
 * 그려진다. AI 호출은 없다.
 */

import { useRef, useState } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useDesignTools, rememberFamily, setTextSelection } from '../../features/studio/designTools'
import { clearFontPreview, setFontPreview } from '../../features/studio/blockFont'
import type { DesignTarget } from '../../features/studio/designTarget'
import { applyCharStyle, charsOf, type CharStyle } from '../../domain/textArt'
import { lookIsPlain, normalizeTextLook, type TextLook } from '../../domain/textLook'
import { TEXT_ALIGNS, textAlignOf } from '../../domain/simpleBlocks'
import type { BlockOrder } from '../../domain/studioJob'
import { FontPicker } from '../studio/FontPicker'
import { ObjectPostEditor } from '../studio/ObjectPostEditor'
import { BarMenu, ColorField, NumField, RangeField, ToggleButton } from './BarMenu'
import { ShadowFields } from './ShadowFields'

/** 정렬 모양 — 세 줄, 가운데 줄이 짧다. 캔버스 블록 막대와 같은 그림. */
function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  const short = { left: 'M2 8h8', center: 'M4 8h8', right: 'M6 8h8' }[align]
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M2 4h12" />
      <path d={short} />
      <path d="M2 12h12" />
    </svg>
  )
}

export function TextOptions({ target, label }: { target: DesignTarget; label: string }) {
  const studio = useStudioJob()
  const editor = useBriefEditor()
  const { selection } = useDesignTools()
  const [draft, setDraft] = useState<string | null>(null)
  const dragFrom = useRef<number | null>(null)
  if (studio === null) return null

  const id = target.blockId
  const order = studio.blockOrderOf(id)
  const look = normalizeTextLook(order.look)
  const block = target.block
  const content = block?.content ?? target.object?.text ?? ''
  const chars = charsOf(content)
  const len = chars.length
  const sel =
    selection !== null && selection.blockId === id && Math.min(selection.end, len) > Math.min(selection.start, len)
      ? { start: Math.min(selection.start, len), end: Math.min(selection.end, len) }
      : null
  const first: CharStyle | null = sel === null ? null : (order.chars?.[sel.start] ?? null)
  const picture = target.object !== undefined && target.object.live !== true
  const inResult = target.source === 'result'

  const mark = () => studio.markStep()
  const save = (patch: BlockOrder) => void studio.setBlockOrder(id, patch)
  const setLook = (patch: Partial<TextLook>) => save({ look: { ...look, ...patch } })
  const setChars = (patch: { [K in keyof CharStyle]?: CharStyle[K] | null }) => {
    if (sel === null) return
    save({ chars: applyCharStyle(order.chars, len, sel.start, sel.end, patch), charsFor: content })
  }
  /** 문구 전체에 줄 때는 글자별로 준 같은 값을 걷는다 — 포토샵에서 전체를 칠하면 전부 그 색이다. */
  const clearChars = (keys: (keyof CharStyle)[]) =>
    applyCharStyle(order.chars, len, 0, len, Object.fromEntries(keys.map((k) => [k, null])))

  if (picture) {
    return (
      <>
        <span className="design-bar__note">AI가 그림으로 만든 문구</span>
        <button
          type="button"
          className="design-bar__btn"
          onClick={() => {
            mark()
            const object = target.object!
            void studio.setLiveText(target.pageId, id, {
              live: true,
              frame: { ...object.rect },
              liveKey: '',
              ...(block?.content === undefined ? {} : { text: block.content }),
            })
          }}
        >
          텍스트로 되돌리기
        </button>
        <ToneMenus target={target} label={label} />
      </>
    )
  }

  return (
    <>
      {/* 글꼴 — 고른 글자가 있으면 그 글자만 */}
      <BarMenu
        label="글꼴"
        icon={<span className="design-bar__font">{first?.family ?? order.fontFamily ?? '기본 글꼴'}</span>}
        title={sel === null ? '글꼴 (문구 전체)' : '글꼴 (고른 글자)'}
        width={300}
      >
        <FontPicker
          sample={content}
          family={first?.family ?? order.fontFamily}
          weight={first?.weight ?? order.fontWeight}
          autoFocus
          onPick={(patch) => {
            mark()
            if (patch.fontFamily !== undefined) {
              rememberFamily(patch.fontFamily)
              if (sel !== null) setChars({ family: patch.fontFamily })
              else save({ fontFamily: patch.fontFamily, chars: clearChars(['family']), charsFor: content })
            }
            if (patch.fontWeight !== undefined) {
              if (sel !== null) setChars({ weight: patch.fontWeight })
              else save({ fontWeight: patch.fontWeight, chars: clearChars(['weight']), charsFor: content })
            }
          }}
          onPreview={(point) =>
            point === null ? clearFontPreview(id) : setFontPreview({ blockId: id, ...point })
          }
        />
      </BarMenu>

      {/* 글자 고르기 */}
      <BarMenu
        label="글자 선택"
        icon={<span>{sel === null ? '전체' : `${String(sel.end - sel.start)}자`}</span>}
        title="색·크기·글꼴을 줄 글자를 고릅니다 (캔버스 글상자에서 끌어 골라도 됩니다)"
        marked={sel !== null}
        width={320}
      >
        <p className="design-menu__hint">끌어서 고르세요. 고른 글자에만 색·크기·글꼴이 들어갑니다.</p>
        <div
          className="char-pick"
          role="listbox"
          aria-label="글자"
          aria-multiselectable="true"
          onPointerUp={() => {
            dragFrom.current = null
          }}
          onPointerLeave={() => {
            dragFrom.current = null
          }}
        >
          {chars.map((ch, i) => {
            const on = sel !== null && i >= sel.start && i < sel.end
            const style = order.chars?.[i]
            return (
              <button
                // 같은 글자가 여러 번 나오므로 차례로 구별한다.
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                type="button"
                role="option"
                aria-selected={on}
                className={`char-pick__ch${on ? ' is-on' : ''}${ch === '\n' ? ' is-break' : ''}`}
                style={style?.color === undefined ? undefined : { color: style.color }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  dragFrom.current = i
                  setTextSelection({ blockId: id, start: i, end: i + 1 })
                }}
                onPointerEnter={() => {
                  const from = dragFrom.current
                  if (from === null) return
                  setTextSelection({ blockId: id, start: Math.min(from, i), end: Math.max(from, i) + 1 })
                }}
              >
                {ch === ' ' ? '␣' : ch === '\n' ? '↵' : ch}
              </button>
            )
          })}
        </div>
        <div className="design-menu__row">
          <button type="button" className="btn" onClick={() => setTextSelection({ blockId: id, start: 0, end: len })}>
            전부 고르기
          </button>
          <button type="button" className="btn" onClick={() => setTextSelection(null)}>
            고르기 해제
          </button>
          <button
            type="button"
            className="btn"
            disabled={order.chars === undefined}
            onClick={() => {
              mark()
              save({ chars: undefined })
            }}
          >
            글자별 모양 지우기
          </button>
        </div>
      </BarMenu>

      <ColorField
        label={sel === null ? '글자색' : '고른 글자 색'}
        value={first?.color ?? look.color}
        onStart={mark}
        onChange={(hex) => {
          if (sel !== null) setChars({ color: hex })
          else save({ look: { ...look, color: hex }, chars: clearChars(['color']), charsFor: content })
        }}
      />
      <ToggleButton
        label="그라데이션"
        icon="그라데이션"
        on={look.fill === 'gradient'}
        onToggle={() => {
          mark()
          setLook({ fill: look.fill === 'gradient' ? 'solid' : 'gradient' })
        }}
      />
      {look.fill === 'gradient' && (
        <ColorField label="그라데이션 아래 색" value={look.color2} onStart={mark} onChange={(hex) => setLook({ color2: hex })} />
      )}
      <NumField
        label="크기"
        suffix="%"
        value={Math.round((first?.scale ?? 1) * 100)}
        min={20}
        max={400}
        step={5}
        disabled={sel === null}
        onStart={mark}
        onChange={(v) => setChars({ scale: v === 100 ? null : v / 100 })}
      />
      <NumField
        label="자간"
        value={Math.round(look.letterSpacing * 100)}
        min={-30}
        max={100}
        onStart={mark}
        onChange={(v) => setLook({ letterSpacing: v / 100 })}
      />
      <NumField
        label="행간"
        suffix="%"
        value={Math.round(look.lineHeight * 100)}
        min={70}
        max={300}
        step={5}
        onStart={mark}
        onChange={(v) => setLook({ lineHeight: v / 100 })}
      />

      {block !== undefined && (
        <span className="design-bar__group" role="group" aria-label="문구 정렬">
          {TEXT_ALIGNS.map(({ value, label: name }) => (
            <ToggleButton
              key={value}
              label={name}
              icon={<AlignIcon align={value} />}
              on={textAlignOf(block) === value}
              onToggle={() => editor.setTextAlign(id, value)}
            />
          ))}
        </span>
      )}
      <ToggleButton
        label="세로쓰기"
        icon="세로쓰기"
        on={look.vertical}
        onToggle={() => {
          mark()
          setLook({ vertical: !look.vertical })
          // 가로로 긴 상자에 세로로 쓰면 글자가 아주 작아진다 — 상자를 세운다(눕힌다).
          const box = block?.position
          if (box !== undefined && (look.vertical ? box.height > box.width : box.width > box.height)) {
            editor.resizeBlock(id, { x: box.x, y: box.y, width: box.height, height: box.width })
          }
          const frame = target.object?.frame
          if (target.object !== undefined && frame !== undefined) {
            void studio.setLiveText(target.pageId, id, {
              frame: { x: frame.x, y: frame.y, width: frame.height, height: frame.width },
            })
          }
        }}
      />
      {look.vertical && (
        <ToggleButton
          label="영문·숫자 세우기"
          icon="영문 세움"
          on={look.latinUpright}
          onToggle={() => {
            mark()
            setLook({ latinUpright: !look.latinUpright })
          }}
        />
      )}

      <BarMenu label="휘기" icon="휘기" marked={look.arc !== 0} width={240}>
        <RangeField
          label="원호로 휘기"
          shown={`${String(Math.round(look.arc * 100))}`}
          value={Math.round(look.arc * 100)}
          min={-100}
          max={100}
          disabled={look.vertical}
          onStart={mark}
          onChange={(v) => setLook({ arc: v / 100 })}
        />
        <p className="design-menu__hint">+ 위로 볼록 · − 아래로 볼록{look.vertical ? ' · 세로쓰기에서는 휘지 않습니다' : ''}</p>
      </BarMenu>

      <BarMenu label="테두리" icon="테두리" marked={look.outline || look.outline2} width={260}>
        <div className="design-menu__row">
          <ToggleButton label="안쪽 테두리" on={look.outline} onToggle={() => { mark(); setLook({ outline: !look.outline }) }} />
          <ColorField label="안쪽 테두리 색" value={look.outlineColor} onStart={mark} onChange={(hex) => setLook({ outlineColor: hex })} />
        </div>
        <RangeField
          label="안쪽 두께"
          shown={String(Math.round(look.outlineWidth * 100))}
          value={Math.round(look.outlineWidth * 100)}
          min={1}
          max={30}
          disabled={!look.outline}
          onStart={mark}
          onChange={(v) => setLook({ outlineWidth: v / 100 })}
        />
        <div className="design-menu__row">
          <ToggleButton label="바깥 테두리" on={look.outline2} onToggle={() => { mark(); setLook({ outline2: !look.outline2 }) }} />
          <ColorField label="바깥 테두리 색" value={look.outline2Color} onStart={mark} onChange={(hex) => setLook({ outline2Color: hex })} />
        </div>
        <RangeField
          label="바깥 두께"
          shown={String(Math.round(look.outline2Width * 100))}
          value={Math.round(look.outline2Width * 100)}
          min={1}
          max={30}
          disabled={!look.outline2}
          onStart={mark}
          onChange={(v) => setLook({ outline2Width: v / 100 })}
        />
      </BarMenu>

      <BarMenu label="그림자" icon="그림자" marked={look.shadow} width={280}>
        <ShadowFields
          on={look.shadow}
          color={look.shadowColor}
          angle={look.shadowAngle}
          distance={Math.round(look.shadowDistance * 100)}
          distanceMax={40}
          blur={Math.round(look.shadowBlur * 100)}
          blurMax={50}
          opacity={Math.round(look.shadowOpacity * 100)}
          onStart={mark}
          onChange={(patch) =>
            setLook({
              ...(patch.on === undefined ? {} : { shadow: patch.on }),
              ...(patch.color === undefined ? {} : { shadowColor: patch.color }),
              ...(patch.angle === undefined ? {} : { shadowAngle: patch.angle }),
              ...(patch.distance === undefined ? {} : { shadowDistance: patch.distance / 100 }),
              ...(patch.blur === undefined ? {} : { shadowBlur: patch.blur / 100 }),
              ...(patch.opacity === undefined ? {} : { shadowOpacity: patch.opacity / 100 }),
            })
          }
        />
      </BarMenu>

      <ToneMenus target={target} label={label} />

      {inResult && block !== undefined && (
        <BarMenu label="문구 고치기" icon="문구" width={300}>
          <textarea
            className="field__input design-menu__text"
            aria-label={`${label} 문구`}
            rows={3}
            value={draft ?? block.content ?? ''}
            onFocus={() => setDraft(block.content ?? '')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== (block.content ?? '') && draft.trim().length > 0) {
                // 문구만 바꾼다 — 기획서 상자는 두고, 조각은 제 틀 안에서 다시 그려진다.
                editor.updateBlock(id, { content: draft })
              }
              setDraft(null)
            }}
          />
          <p className="design-menu__hint">칸을 벗어나면 반영됩니다.</p>
        </BarMenu>
      )}

      <button
        type="button"
        className="design-bar__btn"
        title="색·테두리·그림자·자간·행간·세로쓰기·휘기와 글자별 모양을 모두 걷습니다"
        disabled={lookIsPlain(look) && look.color === '#111111' && order.chars === undefined}
        onClick={() => {
          mark()
          save({ look: undefined, chars: undefined })
        }}
      >
        꾸밈 없애기
      </button>
    </>
  )
}

/** 색 · 레벨·커브 (문구·도형 공통). 완성본에서 고른 조각이면 기울기도. */
export function ToneMenus({ target, label }: { target: DesignTarget; label: string }) {
  return (
    <>
      <BarMenu label="색 조절" icon="색" width={280}>
        <ObjectPostEditor pageId={target.pageId} blockId={target.blockId} kind="text" label={label} only="color" />
      </BarMenu>
      <BarMenu label="레벨·커브" icon="레벨·커브" width={300}>
        <ObjectPostEditor pageId={target.pageId} blockId={target.blockId} kind="text" label={label} only="levels" />
      </BarMenu>
      {target.object !== undefined && (
        <BarMenu label="기울기" icon="기울기" width={260}>
          <ObjectPostEditor pageId={target.pageId} blockId={target.blockId} kind="text" label={label} only="shape" />
        </BarMenu>
      )}
    </>
  )
}
