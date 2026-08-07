/**
 * 블록 하나에만 붙는 **생성 전** 주문 (블록별 주문 Patch).
 *
 * 완성 뒤의 `AI 부분수정`과 목적이 다르다. 저쪽은 이미 만들어진 것을 고치는
 * 일이라 고르지 않은 것을 건드리지 않는 것이 요점이고, 이쪽은 처음 만들 때
 * "이 문구는 이런 느낌으로"라고 미리 말해 두는 일이다 — 아직 아무것도 없으므로
 * 고정할 것도 없다.
 *
 * 참고 그림을 따로 받는 것은 말로 안 되는 것이 있기 때문이다. "라벨 위에 글자",
 * "둥근 상자 안에 글자" 같은 짜임새는 문장으로 적는 것보다 한 장을 보여 주는
 * 편이 언제나 정확하다. 그 그림은 **이 블록의 요청에만** 실린다.
 *
 * 고른 블록이 문구·버튼일 때만 나온다. 이미지·컷아웃은 원본을 그대로 얹으므로
 * AI에게 주문할 것이 없다.
 */

import { useRef } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefEditor } from '../../features/editor/useBriefEditor'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { getBlockTypeMeta } from '../../domain/blockTypes'
import { ACCEPTED_MIME_TYPES } from '../../features/assets/imageUtils'

const IMAGE_ACCEPT = ACCEPTED_MIME_TYPES.join(',')

export function BlockOrderPanel() {
  const studio = useStudioJob()
  const { selected } = useBriefEditor()
  const { storeImage, getUrl } = useAssets()
  const fileRef = useRef<HTMLInputElement | null>(null)
  if (studio === null || selected === null) return null

  const meta = getBlockTypeMeta(selected.type)
  if (meta.requiresAsset || !meta.hasText) return null

  const order = studio.blockOrderOf(selected.id)
  const url = getUrl(order.referenceAssetId)

  const pick = async (file: File) => {
    const asset = await storeImage(file)
    if (asset === null) return
    await studio.setBlockOrder(selected.id, { referenceAssetId: asset.id })
  }

  return (
    <section className="block-order" aria-label="이 블록의 디자인 주문">
      <h2 className="block-order__title">이 블록의 디자인 주문</h2>
      <p className="block-order__hint">
        생성하기 전에 이 문구에만 붙는 주문입니다. 페이지 전체 지시보다 우선합니다.
      </p>

      <textarea
        className="field__input block-order__note"
        aria-label={`${selected.label} 디자인 주문`}
        rows={3}
        placeholder="예: 둥근 라벨 위에 굵은 글씨로. 배경은 밝은 노랑."
        value={order.note ?? ''}
        onChange={(e) => void studio.setBlockOrder(selected.id, { note: e.target.value })}
      />

      <p className="block-order__label">참고 그림 (이 블록에만)</p>
      {url === undefined ? (
        <p className="block-order__empty">
          없음 — 말로 설명하기 어려운 짜임새는 그림 한 장이 정확합니다.
        </p>
      ) : (
        <div className="block-order__preview">
          <img src={url} alt={`${selected.label} 참고 그림`} />
        </div>
      )}

      <div className="block-order__actions">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          {order.referenceAssetId === undefined ? '참고 그림 추가' : '교체'}
        </button>
        {order.referenceAssetId !== undefined && (
          <button
            type="button"
            className="btn"
            onClick={() => void studio.setBlockOrder(selected.id, { referenceAssetId: '' })}
          >
            제거
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="block-order__file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void pick(file)
          e.target.value = ''
        }}
      />
    </section>
  )
}
