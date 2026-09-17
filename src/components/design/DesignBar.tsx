/**
 * 도구 막대 (도구 막대 Patch, 2026-09-17).
 *
 * 사용자: "완성본 아래 화면맞춤 옆에 비어 있는 공간 … 포토샵이나 일러스트레이터처럼
 * 아이콘 형식으로." 그리고 "완성된 이미지 블록의 편집 때도 저 위의 패널을 활용."
 *
 * 왼쪽은 **도구**(선택 V · 문자 T · 도형 U · 선 L), 오른쪽은 **지금 고른 것의 옵션**이다.
 * 옵션은 고른 것에 따라 바뀐다:
 *
 *  - 문구: 글꼴·굵기·글자 선택·색·크기·자간·행간·정렬·세로쓰기·휘기·테두리·그림자·톤
 *  - 도형·선: 모양·채우기·테두리·두께·선 모양·모서리·꼭짓점·화살표·그림자·불투명도·톤
 *  - 완성본의 이미지: 색·레벨·커브·그림자·테두리·모양 (예전 "후보정" 창)
 *
 * 생성 전 캔버스와 완성본에서 같은 막대다. AI 호출은 없다.
 */

import { useEffect } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { setTool, useDesignTools, type DesignTool } from '../../features/studio/designTools'
import { useDesignTarget } from '../../features/studio/designTarget'
import { SHAPE_KINDS } from '../../domain/shapeLook'
import { ObjectPostEditor, TAB_LABEL, postEditMarks, type PostEditTab } from '../studio/ObjectPostEditor'
import { BarMenu } from './BarMenu'
import { TextOptions } from './TextOptions'
import { ShapeOptions } from './ShapeOptions'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (el === null) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

const IMAGE_TABS: readonly PostEditTab[] = ['color', 'levels', 'shadow', 'outline', 'shape']

export function DesignBar() {
  const studio = useStudioJob()
  const generation = useImageGeneration()
  const { tool, lastShape } = useDesignTools()
  const target = useDesignTarget()

  // 포토샵과 같은 단축키. 글을 적는 중에는 듣지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      const next: DesignTool | null =
        key === 'v' ? 'select' : key === 't' ? 'text' : key === 'u' ? lastShape : key === 'l' ? 'line' : null
      if (next !== null) {
        setTool(next)
        return
      }
      if (e.key === 'Escape' && tool !== 'select') setTool('select')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, lastShape])

  if (studio === null) return null

  const marks =
    target?.kind === 'image' ? postEditMarks(studio.objectToneOf(target.blockId), studio.effectsOf(target.blockId)) : null
  const shapeIcon = SHAPE_KINDS.find((k) => k.kind === lastShape)?.icon ?? '▭'
  const label =
    (target !== null && generation?.editTargets.find((t) => t.blockId === target.blockId)?.label) ||
    target?.block?.label ||
    (target?.kind === 'shape' ? '도형' : target?.kind === 'image' ? '이미지' : '문구')

  return (
    <div className="design-bar" role="toolbar" aria-label="디자인 도구">
      <div className="design-bar__tools" role="radiogroup" aria-label="도구">
        {(
          [
            { tool: 'select', icon: '↖', label: '선택 (V)' },
            { tool: 'text', icon: 'T', label: '문자 (T) — 끌어서 문구 만들기' },
          ] as const
        ).map((t) => (
          <button
            key={t.tool}
            type="button"
            role="radio"
            aria-checked={tool === t.tool}
            aria-label={t.label}
            title={t.label}
            className={`design-bar__tool${tool === t.tool ? ' is-on' : ''}`}
            onClick={() => setTool(t.tool)}
          >
            {t.icon}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={tool === lastShape}
          aria-label="도형 (U) — 끌어서 도형 만들기"
          title="도형 (U) — 끌어서 도형 만들기 · Shift로 정사각"
          className={`design-bar__tool${tool === lastShape ? ' is-on' : ''}`}
          onClick={() => setTool(lastShape)}
        >
          {shapeIcon}
        </button>
        <BarMenu label="도형 고르기" icon={<></>} width={200}>
          <div className="shape-pick" role="group" aria-label="도형 종류">
            {SHAPE_KINDS.filter((k) => k.kind !== 'line').map((k) => (
              <button
                key={k.kind}
                type="button"
                className={`design-bar__btn${tool === k.kind ? ' is-on' : ''}`}
                aria-label={k.label}
                title={k.label}
                onClick={() => setTool(k.kind)}
              >
                <span aria-hidden="true">{k.icon}</span> {k.label}
              </button>
            ))}
          </div>
        </BarMenu>
        <button
          type="button"
          role="radio"
          aria-checked={tool === 'line'}
          aria-label="선 (L) — 끌어서 선 긋기"
          title="선 (L) — 끌어서 긋기 · Shift로 수평·수직·45°"
          className={`design-bar__tool${tool === 'line' ? ' is-on' : ''}`}
          onClick={() => setTool('line')}
        >
          ╱
        </button>
      </div>

      <span className="design-bar__sep" aria-hidden="true" />

      <div className="design-bar__options" role="group" aria-label="고른 것의 옵션">
        {tool !== 'select' ? (
          <span className="design-bar__note">
            캔버스에서 끌어 {tool === 'text' ? '문구' : tool === 'line' ? '선' : '도형'}을 만드세요 · Esc 취소
          </span>
        ) : target === null ? (
          <span className="design-bar__note">블록이나 조각을 고르면 옵션이 나옵니다 · V 선택 · T 문자 · U 도형 · L 선</span>
        ) : target.kind === 'text' ? (
          <TextOptions key={target.blockId} target={target} label={label} />
        ) : target.kind === 'shape' ? (
          <ShapeOptions key={target.blockId} target={target} label={label} />
        ) : (
          IMAGE_TABS.map((tab) => (
            <BarMenu
              key={`${target.blockId}-${tab}`}
              label={TAB_LABEL[tab]}
              icon={TAB_LABEL[tab]}
              marked={marks !== null && (tab === 'color' || tab === 'levels' || tab === 'shadow' || tab === 'outline') && marks[tab]}
              width={tab === 'levels' ? 300 : 280}
            >
              <ObjectPostEditor
                pageId={target.pageId}
                blockId={target.blockId}
                kind="image"
                label={label}
                only={tab}
              />
            </BarMenu>
          ))
        )}
      </div>
    </div>
  )
}
