/**
 * 문구 하나의 **생성 전** 디자인 — 글꼴 · 주문 · 참고 그림 (문구 디자인 창, 2026-09-17).
 *
 * 전에는 오른쪽 패널의 "이 문구 디자인 주문" 칸에 있었다. 사용자: "참고그림 추가와
 * AI에게 설명할 것도 텍스트 블록 가까이서 컨트롤하는 게 낫다 … 우측 요약 한 줄조차
 * 필요 없다." 그래서 이 편집기는 **블록 옆에 뜨는 창 안에만** 선다. 같은 일을 두
 * 곳에서 하게 두면 어느 쪽이 진짜인지 알 수 없다.
 *
 * 셋 다 "이 문구를 어떻게 만들 것인가"라서 한 창에 탭으로 둔다.
 *
 *  - **글꼴**(필수): 로컬 엔진은 한글을 쓰지 못해 글자를 브라우저가 그린다. 디자인의
 *    폭을 정하는 것은 글꼴이다. 가리키면 캔버스의 글자가 그 글꼴로 바뀐다.
 *  - **주문**: 색·테두리·그림자 같은 말. 이 블록의 요청에만 실린다.
 *  - **참고 그림**: "라벨 위에 글자"처럼 말로 어려운 짜임새. 이 블록의 요청에만 실린다.
 *
 * 창이 닫혀 있어도 무엇이 들어 있는지는 막대 버튼이 말한다 — 접어 둔 칸을 보고
 * "기능이 없어졌냐"는 말이 나온 적이 있다 (§16-B).
 */

import { useRef, useState } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'
import { FontPicker } from './FontPicker'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

export type TextDesignTab = 'font' | 'note' | 'reference'

export function TextDesignEditor({
  blockId,
  label,
  content,
  onPreview,
}: {
  blockId: string
  /** 블록 이름 — 입력칸의 이름에 쓴다. */
  label: string
  /** 글꼴 견본에 쓸 그 문구. */
  content: string
  onPreview: (point: { family: string; weight?: number | undefined } | null) => void
}) {
  const studio = useStudioJob()
  const { storeImage, getUrl } = useAssets()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [tab, setTab] = useState<TextDesignTab>('font')
  const [large, setLarge] = useState(false)
  if (studio === null) return null

  const order = studio.blockOrderOf(blockId)
  const url = getUrl(order.referenceAssetId)
  const hasNote = (order.note ?? '').trim().length > 0
  const hasRef = order.referenceAssetId !== undefined

  const pick = async (file: File) => {
    const asset = await storeImage(file)
    if (asset === null) return
    await studio.setBlockOrder(blockId, { referenceAssetId: asset.id })
  }

  const TABS: readonly { key: TextDesignTab; label: string; marked: boolean; missing?: boolean }[] = [
    { key: 'font', label: '글꼴', marked: false, missing: order.fontFamily === undefined },
    { key: 'note', label: '주문', marked: hasNote },
    { key: 'reference', label: '참고 그림', marked: hasRef },
  ]

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

      {tab === 'font' && (
        <FontPicker
          sample={content}
          family={order.fontFamily}
          weight={order.fontWeight}
          autoFocus
          onPick={(patch) => void studio.setBlockOrder(blockId, patch)}
          onPreview={onPreview}
        />
      )}

      {tab === 'note' && (
        <div className="text-design__pane">
          <p className="text-design__hint">
            이 문구에만 붙는 주문입니다. 페이지 전체 지시보다 우선합니다. 비워 두면 배경에 어울리게 꾸밉니다.
          </p>
          <textarea
            className="field__input text-design__note"
            aria-label={`${label} 디자인 주문`}
            rows={5}
            autoFocus
            placeholder="예: 알록달록하게, 흰색 테두리, 그림자. 둥근 라벨 위에 굵은 글씨로."
            value={order.note ?? ''}
            onChange={(e) => void studio.setBlockOrder(blockId, { note: e.target.value })}
          />
        </div>
      )}

      {tab === 'reference' && (
        <div className="text-design__pane">
          <p className="text-design__hint">
            말로 설명하기 어려운 짜임새는 그림 한 장이 정확합니다. 이 문구의 요청에만 실립니다.
          </p>
          {url === undefined ? (
            <p className="text-design__empty">참고 그림 없음</p>
          ) : (
            <button
              type="button"
              className={`text-design__preview${large ? ' is-large' : ''}`}
              aria-label={large ? '참고 그림 작게 보기' : '참고 그림 크게 보기'}
              title={large ? '작게 보기' : '크게 보기'}
              onClick={() => setLarge((v) => !v)}
            >
              <img src={url} alt={`${label} 참고 그림`} />
            </button>
          )}
          <div className="text-design__actions">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              {hasRef ? '교체' : '참고 그림 추가'}
            </button>
            {hasRef && (
              <button
                type="button"
                className="btn"
                onClick={() => void studio.setBlockOrder(blockId, { referenceAssetId: '' })}
              >
                제거
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="text-design__file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void pick(file)
              e.target.value = ''
            }}
          />
        </div>
      )}
    </section>
  )
}
