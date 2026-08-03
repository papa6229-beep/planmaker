/**
 * 기획서와 AI 생성 결과를 나란히 두는 화면 (1단계 §5).
 *
 * 왼쪽은 **기존 캔버스 그대로**다. 복제본이 아니라 같은 컴포넌트이므로 여기서도
 * 블록을 고르고 옮기고 문구를 고칠 수 있고, 고치는 순간 오른쪽 결과에 "이건 그
 * 전에 만든 것"이라는 표시가 붙는다.
 *
 * 오른쪽은 생성된 이미지를 원본 비율로 보여 준다. 자르지 않는다 — 잘라서 맞춘
 * 그림을 나란히 놓으면 비교 자체가 거짓말이 된다. 기획서와 같은 표시 폭을 쓰므로
 * 두 장이 같은 배율로 함께 흐른다.
 *
 * 참고 이미지의 옛 `나란히 보기`와는 아무 관계가 없다. 데이터도 상태도 다른
 * 곳에 있다 — 저쪽은 문서의 참고 자료, 이쪽은 Studio 작업의 생성 결과다.
 */

import { useEffect, useState } from 'react'
import { BriefCanvas } from '../canvas/BriefCanvas'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { pageResultIsStale, pageResultOf } from '../../domain/studioJob'
import { getAsset } from '../../services/assetStore'

function formatTime(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

export function ResultCompare() {
  const { getDocument } = useBriefDocument()
  const studio = useStudioJob()
  const doc = getDocument()
  const pageId = doc.activePageId
  const result = pageResultOf(studio?.job ?? null, pageId)
  const stale = studio !== null && pageResultIsStale(studio.job, doc, pageId)
  const [url, setUrl] = useState<string | null>(null)

  // 결과 이미지는 자산 저장소에 있다. 화면에 걸 주소는 볼 때만 만들고, 떠날 때
  // 되돌려 준다 — 생성할 때마다 주소가 쌓이면 탭이 무거워진다.
  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    void (async () => {
      if (result === undefined) {
        setUrl(null)
        return
      }
      const asset = await getAsset(result.assetId)
      if (cancelled || asset === undefined) return
      revoked = URL.createObjectURL(asset.blob)
      setUrl(revoked)
    })()
    return () => {
      cancelled = true
      if (revoked !== null) URL.revokeObjectURL(revoked)
    }
  }, [result])

  return (
    <div className="compare">
      <section className="compare__pane compare__brief" aria-label="기획서 작업본">
        <header className="compare__head">
          <h2 className="compare__label">기획서 작업본</h2>
          <p className="compare__note">여기서 계속 고칠 수 있습니다.</p>
        </header>
        <BriefCanvas />
      </section>

      <section className="compare__pane compare__result" aria-label="AI 생성 결과">
        <header className="compare__head">
          <h2 className="compare__label">AI 1차 생성 결과</h2>
          {result !== undefined && (
            <p className="compare__note">
              {result.model} · {result.quality} · {result.requestedSize} · {formatTime(result.createdAt)}
            </p>
          )}
        </header>
        {stale && (
          <p className="compare__stale" role="status">
            기획서 수정 전 생성 결과
          </p>
        )}
        {result === undefined ? (
          <p className="compare__empty">아직 생성한 결과가 없습니다.</p>
        ) : url === null ? (
          <p className="compare__empty">결과 이미지를 불러오는 중…</p>
        ) : (
          /* 원본 비율 그대로. 폭만 기획서와 맞춘다. */
          <img className="compare__image" src={url} alt="AI가 생성한 결과 이미지" />
        )}
      </section>
    </div>
  )
}
