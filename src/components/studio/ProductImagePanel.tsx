/**
 * 제품 이미지 연결 패널 (이미지 생성기 0단계 §4).
 *
 * 기획서에 붙어 있는 그림은 전부 참고자료다 — "이런 느낌으로", "이 제품 자리에".
 * 최종 이미지에 실제로 들어갈 누끼는 디자인팀이 여기서 따로 연결한다. 그래서 이
 * 패널은 자리마다 둘을 나란히 보여 준다: 작성자가 붙인 참고 캡처와, 디자인팀이
 * 연결한 실제 사용 제품 이미지. 어느 쪽인지는 그림 밑에 글자로 적힌다.
 *
 * 연결을 지워도 기획서는 조금도 줄어들지 않는다. 연결은 기획서 문서가 아니라
 * Studio 작업자료에만 적히기 때문이다(§3.2).
 *
 * 목록은 `buildGenerationRequests`가 만든다. 화면이 보여 주는 자리와 GPT에게
 * 나가는 자리가 서로 다른 계산에서 나오면 안 되기 때문이다.
 */

import { useMemo, useRef } from 'react'
import { useAssets } from '../../features/assets/useAssets'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { buildGenerationRequests, type GenerationImageSlot } from '../../domain/generationRequest'

interface SlotRow {
  pageTitle: string
  slot: GenerationImageSlot
}

function SlotCard({ row }: { row: SlotRow }) {
  const { slot } = row
  const { getUrl, storeImage } = useAssets()
  const studio = useStudioJob()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const referenceUrl = getUrl(slot.referenceAsset?.assetId)
  const productUrl = getUrl(slot.productImage?.assetId)
  const linked = slot.status === 'linked'

  const attach = async (file: File | undefined) => {
    if (!file || !studio) return
    const asset = await storeImage(file)
    if (asset) studio.setProductImage(slot.blockId, asset.id)
  }

  return (
    <li className="studio-slot">
      <p className="studio-slot__page">{row.pageTitle}</p>
      <p className="studio-slot__desc">{slot.description ?? '어떤 이미지가 들어갈지 아직 적히지 않았습니다.'}</p>

      <div className="studio-slot__images">
        <figure className="studio-slot__image">
          {referenceUrl ? (
            <img src={referenceUrl} alt="작성자가 붙인 참고 이미지" draggable={false} />
          ) : (
            <span className="studio-slot__empty">참고 이미지 없음</span>
          )}
          <figcaption>
            <span className="studio-slot__tag studio-slot__tag--reference">참고</span>
            최종 사용 이미지 아님
          </figcaption>
        </figure>

        <figure className="studio-slot__image">
          {productUrl ? (
            <img src={productUrl} alt="연결된 실제 사용 제품 이미지" draggable={false} />
          ) : (
            <span className="studio-slot__empty studio-slot__empty--missing">제품 이미지 미연결</span>
          )}
          <figcaption>
            {linked ? (
              <>
                <span className="studio-slot__tag studio-slot__tag--product">실사용</span>
                최종 이미지에 들어감
              </>
            ) : (
              '연결하면 여기에 표시됩니다'
            )}
          </figcaption>
        </figure>
      </div>

      <div className="studio-slot__actions">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          {linked ? '제품 이미지 교체' : '제품 이미지 연결'}
        </button>
        {linked && (
          <button type="button" className="btn" onClick={() => studio?.removeProductImage(slot.blockId)}>
            제품 이미지 제거
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="studio-slot__file"
          onChange={(e) => {
            void attach(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
    </li>
  )
}

export function ProductImagePanel() {
  const { document: doc } = useBriefDocument()
  const studio = useStudioJob()

  const rows = useMemo<SlotRow[]>(() => {
    if (!studio) return []
    return buildGenerationRequests(doc, studio.job).flatMap((request) =>
      request.design.imageSlots.map((slot) => ({ pageTitle: request.design.document.pageTitle, slot })),
    )
  }, [doc, studio])

  const missing = rows.filter((r) => r.slot.status === 'missing').length

  return (
    <aside className="inspector studio-panel" aria-label="제품 이미지 연결">
      <header className="studio-panel__header">
        <h2 className="studio-panel__title">제품 이미지 연결</h2>
        <span className="studio-panel__count">
          {rows.length === 0 ? '자리 없음' : `${rows.length}자리 · 미연결 ${missing}`}
        </span>
      </header>

      {studio?.sourceChanged === true && (
        <p className="studio-panel__drift">
          불러온 원본 기획서와 지금 작업본이 달라졌습니다. 원본은 그대로 보관돼 있습니다.
        </p>
      )}

      <p className="studio-panel__note">
        기획서에 붙은 그림은 참고자료입니다. 최종 이미지에 넣을 제품 누끼는 자리마다 여기서 연결합니다.
      </p>

      {rows.length === 0 ? (
        <p className="studio-panel__empty">
          이미지 자리가 없습니다. 기획서 파일을 불러오면 자리마다 여기에 나타납니다.
        </p>
      ) : (
        <ul className="studio-panel__list">
          {rows.map((row) => (
            <SlotCard key={row.slot.blockId} row={row} />
          ))}
        </ul>
      )}
    </aside>
  )
}
