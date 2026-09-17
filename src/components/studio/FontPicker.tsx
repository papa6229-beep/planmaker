/**
 * 이 문구를 어느 글꼴로 그릴 것인가 (문구 판 Patch).
 *
 * ## 왜 이 칸이 생겼나
 *
 * 로컬 엔진은 한글을 쓰지 못한다 (2026-09-16 확인: `여름 시즌오프` → `메롱 시셩므무`).
 * 그래서 글자는 브라우저가 그리고 모델은 재질만 입힌다. 그 구조에서 **디자인의
 * 폭은 글꼴이 정한다** — 모델은 글자꼴을 바꾸지 못하고, 바꾸게 두면 한글이 틀린다.
 * 그래서 글꼴은 **반드시 고른다** (2026-09-17 사용자 결정). "고르지 않기"는 없다.
 *
 * ## 왜 이름만 늘어놓지 않는가
 *
 * 글꼴은 이름으로 고르는 것이 아니다. 그래서 **고른 글꼴로 그 문구를 실제로 써서**
 * 보여 준다.
 *
 * ## 백 가지가 넘는다 (글꼴 전체 Patch, 2026-09-17)
 *
 * 한글 한 벌이 수백 KB다. 목록 전부를 미리 받으면 화면이 열리지 않는다. 그래서
 * 한글/외국어로 먼저 나누고, 이름으로 좁히고, **목록에서 실제로 보이는 줄만**
 * 내려받는다. 스크롤해서 보이기 시작하면 그때 받는다.
 *
 * 글꼴 목록을 읽지 못해도 화면은 열린다. 그때는 이 칸이 나오지 않고, 그리는 쪽이
 * 기본 글꼴로 그린다.
 */

import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_WEIGHT,
  FONT_SCRIPTS,
  filterFamilies,
  groupFamilies,
  parseFontCatalog,
  pickWeight,
  type FontFamily,
  type FontScript,
} from '../../domain/fontCatalog'
import { faceName, fetchFontCatalog, loadFont } from '../../services/fontLoader'

/** 굵기 이름 — 숫자만 보여 주면 무엇이 굵은 쪽인지 화면이 말하지 못한다. */
const WEIGHT_LABEL: readonly { weight: number; label: string }[] = [
  { weight: 100, label: '가장 가늘게' },
  { weight: 300, label: '가늘게' },
  { weight: 400, label: '보통' },
  { weight: 500, label: '조금 굵게' },
  { weight: 700, label: '굵게' },
  { weight: 900, label: '가장 굵게' },
]

let cached: FontFamily[] | null = null

/**
 * 목록의 한 줄. **보이기 시작할 때** 글꼴을 받는다.
 *
 * `IntersectionObserver`가 없는 환경(검사)에서는 곧바로 받는다 — 견본이 기본
 * 글꼴로 남는 것보다는 낫다.
 */
function FontRow({
  item,
  sample,
  weight,
  mine,
  onPick,
}: {
  item: FontFamily
  sample: string
  weight: number
  mine: boolean
  onPick: () => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [ready, setReady] = useState(false)
  const file = pickWeight(item, weight)

  useEffect(() => {
    if (file === null) return
    let alive = true
    const start = () =>
      void loadFont(file).then((ok) => {
        if (alive && ok) setReady(true)
      })
    const node = ref.current
    if (node === null || typeof IntersectionObserver !== 'function') {
      start()
      return () => {
        alive = false
      }
    }
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect()
          start()
        }
      },
      // 조금 앞서 받는다 — 스크롤이 닿기 직전에 준비되도록.
      { rootMargin: '120px' },
    )
    seen.observe(node)
    return () => {
      alive = false
      seen.disconnect()
    }
  }, [file])

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={mine}
      aria-label={`글꼴 ${item.family}`}
      className={`font-pick__item${mine ? ' is-on' : ''}`}
      onClick={onPick}
    >
      <span
        className="font-pick__sample"
        style={file !== null && ready ? { fontFamily: `"${faceName(file)}"`, fontWeight: file.weight } : undefined}
      >
        {sample}
      </span>
      <span className="font-pick__name">{item.family}</span>
    </button>
  )
}

export function FontPicker({
  sample,
  family,
  weight,
  onPick,
}: {
  /** 미리보기에 쓸 글자 — 그 문구 자체를 보여 준다. */
  sample: string
  family: string | undefined
  weight: number | undefined
  onPick: (patch: { fontFamily?: string | undefined; fontWeight?: number | undefined }) => void
}) {
  const [families, setFamilies] = useState<FontFamily[] | null>(cached)
  const [query, setQuery] = useState('')
  const chosenScript = families?.find((f) => f.family === family)?.script
  const [script, setScript] = useState<FontScript>(chosenScript ?? 'ko')

  useEffect(() => {
    if (cached !== null) return
    let alive = true
    void (async () => {
      const list = parseFontCatalog(await fetchFontCatalog())
      cached = list
      if (alive) setFamilies(list)
    })()
    return () => {
      alive = false
    }
  }, [])

  // 다른 블록을 고르면 그 블록의 글꼴이 있는 쪽을 연다.
  useEffect(() => {
    if (chosenScript !== undefined) setScript(chosenScript)
  }, [chosenScript])

  if (families === null || families.length === 0) return null
  const chosen = families.find((f) => f.family === family)
  const available = chosen === undefined ? [] : chosen.weights.map((w) => w.weight)
  const shown = filterFamilies(families, script, query)
  const text =
    sample.trim().length > 0 ? sample.trim().slice(0, 14) : script === 'ko' ? '여름 시즌오프' : 'Summer Sale'

  return (
    <div className="font-pick">
      <p className="block-order__label">
        글꼴 <span className="font-pick__required">필수</span>
        {chosen !== undefined && <span className="font-pick__current"> · {chosen.family}</span>}
      </p>
      {chosen === undefined && <p className="font-pick__warn">글꼴을 골라야 이 문구를 만들 수 있습니다.</p>}
      <div className="font-pick__tabs" role="tablist" aria-label="글꼴 종류">
        {FONT_SCRIPTS.map((s) => (
          <button
            key={s.script}
            type="button"
            role="tab"
            aria-selected={script === s.script}
            className={`btn font-pick__tab${script === s.script ? ' is-on' : ''}`}
            onClick={() => setScript(s.script)}
          >
            {s.label} {families.filter((f) => f.script === s.script).length}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="field__input font-pick__search"
        placeholder="글꼴 이름으로 찾기"
        aria-label="글꼴 이름으로 찾기"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="font-pick__list" role="radiogroup" aria-label="글꼴 고르기">
        {shown.length === 0 && <p className="block-order__empty">맞는 글꼴이 없습니다.</p>}
        {groupFamilies(shown).map((group) => (
          <div key={group.group} className="font-pick__group">
            <p className="font-pick__group-name">{group.group}</p>
            {group.families.map((item) => (
              <FontRow
                key={item.family}
                item={item}
                sample={text}
                weight={weight ?? DEFAULT_WEIGHT}
                mine={item.family === family}
                onPick={() => onPick({ fontFamily: item.family })}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 굵기는 글꼴을 고른 뒤에 나온다. 무엇의 굵기인지 모른 채 고르게 하지 않는다. */}
      {chosen !== undefined && chosen.weights.length > 1 && (
        <div className="font-pick__weights" role="group" aria-label="글꼴 굵기">
          {WEIGHT_LABEL.filter((w) => available.some((a) => Math.abs(a - w.weight) <= 100)).map((w) => (
            <button
              key={w.weight}
              type="button"
              aria-pressed={(weight ?? DEFAULT_WEIGHT) === w.weight}
              className={`btn font-pick__weight${(weight ?? DEFAULT_WEIGHT) === w.weight ? ' is-on' : ''}`}
              onClick={() => onPick({ fontWeight: w.weight })}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
