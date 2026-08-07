/**
 * 완성본을 보고 고치는 화면 (완성본 모드 Patch).
 *
 * 앞선 판은 기획서와 결과를 **반씩** 나눠 놓은 비교 화면이었다. 비교가 필요한
 * 순간은 만든 직후 잠깐이고, 그 뒤로는 완성본만 본다. 그런데 반쪽에 갇힌 결과는
 * 배율도 없어서 세로로 잘렸고, 전체를 한 번에 볼 방법이 아예 없었다.
 *
 * 그래서 완성본이 가운데를 **전부** 쓴다. 기획서는 `기획서 나란히 보기`로 필요할
 * 때만 꺼낸다 — 꺼내면 예전처럼 같은 캔버스가 그대로 서므로, 거기서 블록을 고치는
 * 일도 그대로 된다.
 *
 * 배율은 `useResultView`가 갖는다. 기획서 배율과 **다른 값**이다.
 *
 * 참고 이미지의 옛 `나란히 보기`와는 아무 관계가 없다. 데이터도 상태도 다른
 * 곳에 있다 — 저쪽은 문서의 참고 자료, 이쪽은 Studio 작업의 생성 결과다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BriefCanvas } from '../canvas/BriefCanvas'
import { useBriefDocument } from '../../features/document/useBriefDocument'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { pageResultIsStale, pageResultOf } from '../../domain/studioJob'
import { getAsset } from '../../services/assetStore'
import { ResultObjectLayer } from './ResultObjectLayer'
import { useResultView } from '../../features/studio/useResultView'

function formatTime(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

export function ResultCompare() {
  const { getDocument } = useBriefDocument()
  const studio = useStudioJob()
  const view = useResultView()
  const doc = getDocument()
  const pageId = doc.activePageId
  const result = pageResultOf(studio?.job ?? null, pageId)
  const stale = studio !== null && pageResultIsStale(studio.job, doc, pageId)
  const [url, setUrl] = useState<string | null>(null)
  /** 기획서를 옆에 세울 것인가. 기본은 아니다 — 완성본이 가운데를 다 쓴다. */
  const [withBrief, setWithBrief] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const page = doc.pages.find((p) => p.id === pageId)
  const logicalWidth = page?.canvasWidth ?? 840
  const logicalHeight = page?.canvasHeight ?? 1000
  const logical = { width: logicalWidth, height: logicalHeight }

  // 볼 수 있는 자리가 얼마인지 알려 준다. `전체 보기`는 세로까지 봐야 하므로
  // 폭만이 아니라 높이도 함께 보낸다.
  const report = view?.report
  useLayoutEffect(() => {
    const box = viewportRef.current
    if (box === null || report === undefined) return
    const send = () => {
      const rect = box.getBoundingClientRect()
      report({ width: rect.width, height: rect.height }, { width: logicalWidth, height: logicalHeight })
    }
    send()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(send)
    observer.observe(box)
    return () => observer.disconnect()
  }, [report, logicalWidth, logicalHeight, withBrief, url])

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

  const zoom = view?.zoom ?? 1

  return (
    <div className={`compare${withBrief ? ' compare--split' : ''}`}>
      {withBrief && (
        <section className="compare__pane compare__brief" aria-label="기획서 작업본">
          <header className="compare__head">
            <h2 className="compare__label">기획서 작업본</h2>
            <p className="compare__note">여기서 계속 고칠 수 있습니다.</p>
          </header>
          <BriefCanvas />
        </section>
      )}

      <section className="compare__pane compare__result" aria-label="AI 생성 결과">
        <header className="compare__head">
          <h2 className="compare__label">완성본</h2>
          <button
            type="button"
            className={`btn compare__with-brief${withBrief ? ' is-active' : ''}`}
            aria-pressed={withBrief}
            title="기획서를 옆에 세웁니다"
            onClick={() => setWithBrief((on) => !on)}
          >
            기획서 나란히 보기
          </button>
          {result !== undefined && (
            <p className="compare__note">
              {/* 보이는 그림은 작업본이다. 모델 규격은 참고로만 함께 적는다 —
                  둘을 한 값처럼 보이면 832짜리를 840인 줄 알고 쓰게 된다. */}
              작업본 {result.workingSize ?? result.requestedSize} · AI 생성 규격 {result.requestedSize} ·{' '}
              {result.model} · {result.quality} · {formatTime(result.createdAt)}
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
          /* 원본 비율 그대로. 폭만 기획서와 맞춘다. 이미지와 꾸며진 문구는 그림
             위에 겹쳐 두어, 결과를 보면서 바로 옮기고 크기를 바꿀 수 있다 (§2). */
          <div className="compare__viewport" ref={viewportRef}>
            {/* 판의 폭을 픽셀로 못박는다. 오브젝트 겹은 자기 상자의 실제 폭에서
                배율을 되짚으므로(`ResultObjectLayer`의 `scale`), 이 한 줄로
                확대해도 잡는 자리와 그려지는 자리가 어긋나지 않는다. */}
            <div
              className="compare__stage"
              style={{ width: `${String(Math.round(logical.width * zoom))}px` }}
            >
              <img className="compare__image" src={url} alt="AI가 생성한 결과 이미지" />
              <ResultObjectLayer pageId={pageId} page={logical} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
