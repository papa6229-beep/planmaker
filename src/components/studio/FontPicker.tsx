/**
 * 이 문구를 어느 글꼴로 그릴 것인가 (문구 판 Patch).
 *
 * ## 왜 이 칸이 생겼나
 *
 * 로컬 엔진은 한글을 쓰지 못한다 (2026-09-16 확인: `여름 시즌오프` → `메롱 시셩므무`).
 * 그래서 글자는 브라우저가 그리고 모델은 재질만 입힌다. 그 구조에서 **디자인의
 * 폭은 글꼴이 정한다** — 모델은 글자꼴을 바꾸지 못하고, 바꾸게 두면 한글이 틀린다.
 *
 * ## 왜 이름만 늘어놓지 않는가
 *
 * 글꼴은 이름으로 고르는 것이 아니다. 그래서 **고른 글꼴로 그 문구를 실제로 써서**
 * 보여 준다. 목록에 올라온 글꼴은 그때 내려받는다 — 스물네 벌을 미리 받으면
 * 화면이 열리지 않는다 (한글 한 벌이 수백 KB다).
 *
 * 글꼴 목록을 읽지 못해도 화면은 열린다. 그때는 이 칸이 나오지 않고, 그리는 쪽이
 * 기본 글꼴로 그린다.
 */

import { useEffect, useState } from 'react'
import {
  DEFAULT_WEIGHT,
  groupFamilies,
  parseFontCatalog,
  pickWeight,
  type FontFamily,
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
  const [ready, setReady] = useState<Record<string, boolean>>({})

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

  // 목록에 보이는 글꼴은 미리보기를 위해 받아 둔다. 고른 것 하나만 받으면 나머지는
  // 기본 글꼴로 보여서, 고르는 일 자체가 되지 않는다.
  useEffect(() => {
    if (families === null) return
    let alive = true
    for (const item of families) {
      const file = pickWeight(item, weight ?? DEFAULT_WEIGHT)
      if (file === null || ready[file.file] === true) continue
      void loadFont(file).then((ok) => {
        if (alive && ok) setReady((was) => ({ ...was, [file.file]: true }))
      })
    }
    return () => {
      alive = false
    }
  }, [families, weight, ready])

  if (families === null || families.length === 0) return null
  const chosen = families.find((f) => f.family === family)
  const available = chosen === null || chosen === undefined ? [] : chosen.weights.map((w) => w.weight)

  return (
    <div className="font-pick">
      <p className="block-order__label">글꼴</p>
      <div className="font-pick__list" role="radiogroup" aria-label="글꼴 고르기">
        {groupFamilies(families).map((group) => (
          <div key={group.group} className="font-pick__group">
            <p className="font-pick__group-name">{group.group}</p>
            {group.families.map((item) => {
              const file = pickWeight(item, weight ?? DEFAULT_WEIGHT)
              const mine = item.family === family
              return (
                <button
                  key={item.family}
                  type="button"
                  role="radio"
                  aria-checked={mine}
                  aria-label={`글꼴 ${item.family}`}
                  className={`font-pick__item${mine ? ' is-on' : ''}`}
                  onClick={() => onPick({ fontFamily: item.family })}
                >
                  <span
                    className="font-pick__sample"
                    style={
                      file !== null && ready[file.file] === true
                        ? { fontFamily: `"${faceName(file)}"`, fontWeight: file.weight }
                        : undefined
                    }
                  >
                    {sample.trim().length > 0 ? sample.slice(0, 14) : '여름 시즌오프'}
                  </span>
                  <span className="font-pick__name">{item.family}</span>
                </button>
              )
            })}
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

      {family !== undefined && (
        <button
          type="button"
          className="btn font-pick__clear"
          onClick={() => onPick({ fontFamily: '', fontWeight: undefined })}
        >
          글꼴 고르지 않기
        </button>
      )}
    </div>
  )
}
