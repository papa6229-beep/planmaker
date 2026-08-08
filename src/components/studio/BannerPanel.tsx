/**
 * 완성본에서 배너를 뽑는다 (배너 Patch §4).
 *
 * 완성본이 있을 때만 나온다. 만든 적 없는 완성본에서 배너를 지어낼 수는 없다.
 *
 * 화면이 하는 일의 절반은 **무엇을 버렸는지 말하는 것**이다. 배너는 버리는 일이고,
 * 무엇을 버렸는지 말하지 않으면 사람이 그 배너를 믿고 그대로 내보낸다. 넷을 나눠
 * 적고, 그중 둘(자리를 못 얻음·조각이 없음)은 색을 달리해 **사람이 봐야 한다**고
 * 말한다.
 *
 * 미리보기는 실제 크기로 보여 준다. 1020×70은 패널보다 넓어 가로로 밀리지만,
 * 줄여서 보여 주면 글자가 읽히는지를 볼 수 없다 — 그것이 이 배너에서 유일하게
 * 중요한 것이다.
 */

import { useBannerMaker, sideLabel, type BannerNote } from '../../features/studio/useBannerMaker'
import { useImageGeneration } from '../../features/studio/useImageGeneration'
import { BANNER_SPECS } from '../../domain/bannerSpec'
import { PanelFold } from './PanelFold'

const NOTE_TEXT: Record<BannerNote['kind'], string> = {
  unplaced: '자리를 못 얻었습니다 — 빼면 안 되는 것입니다',
  missing: '완성본에 이 블록의 그림이 없습니다',
  background: '모양이 안 맞아 배경으로 내렸습니다',
  dropped: '자리가 없어 뺐습니다',
}

/** 사람이 봐야 하는 것과 그냥 알려 주는 것. */
const NEEDS_EYES = new Set<BannerNote['kind']>(['unplaced', 'missing'])

export function BannerPanel() {
  const banner = useBannerMaker()
  const generation = useImageGeneration()
  if (banner === null || generation === null || !generation.hasResult) return null

  const busy = banner.state.kind === 'working' || generation.state.kind === 'running'
  const result = banner.state.kind === 'done' ? banner.state.result : null
  const warnings = result?.notes.filter((n) => NEEDS_EYES.has(n.kind)) ?? []

  return (
    <PanelFold id="banner" title="배너 뽑기" note="완성본 조각을 다시 놓습니다" marked={warnings.length > 0}>
      <section className="banner" aria-label="배너 뽑기">
        <p className="banner__note">
          완성본에 쓴 조각을 배너 규격에 다시 놓습니다. 새로 그리지 않으므로 AI 호출이 없습니다.
        </p>

        <div className="banner__specs">
          {BANNER_SPECS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              className="btn btn--primary banner__make"
              disabled={busy}
              onClick={() => banner.make(spec.id)}
            >
              {spec.width}×{spec.height} 만들기
            </button>
          ))}
        </div>

        {banner.state.kind === 'working' && <p className="banner__status">만드는 중…</p>}
        {banner.state.kind === 'failed' && <p className="banner__status banner__status--bad">{banner.state.message}</p>}

        {result !== null && (
          <div className="banner__result">
            <p className="banner__size">
              {result.spec.label} · {result.spec.width}×{result.spec.height}
              {result.spec.siblings.length > 0 && (
                <span className="banner__siblings">
                  {' '}
                  · 같은 배치로 {result.spec.siblings.map((s) => `${s.width}×${s.height}`).join(', ')} 도 저장하세요
                </span>
              )}
            </p>

            <div className="banner__preview">
              <img src={result.url} alt={`${result.spec.width}×${result.spec.height} 배너 미리보기`} />
            </div>

            {result.edges.length > 0 && (
              <div className="banner__edges">
                <span className="banner__edges-title">끝단 색</span>
                {result.edges.map((edge) => (
                  <button
                    key={edge.side}
                    type="button"
                    className="banner__edge"
                    title={`${sideLabel(edge.side)} ${edge.hex} 복사`}
                    onClick={() => void navigator.clipboard?.writeText(edge.hex)}
                  >
                    <span className="banner__swatch" style={{ background: edge.hex }} aria-hidden="true" />
                    {sideLabel(edge.side)} {edge.hex}
                  </button>
                ))}
              </div>
            )}

            {result.centerFallback && (
              <p className="banner__status">배경에서 잔잔한 자리를 고르지 못해 가운데를 썼습니다.</p>
            )}

            {result.notes.length > 0 && (
              <ul className="banner__notes">
                {result.notes.map((note, index) => (
                  <li
                    key={`${note.kind}-${note.label}-${String(index)}`}
                    className={NEEDS_EYES.has(note.kind) ? 'banner__notes-item is-warn' : 'banner__notes-item'}
                  >
                    <b>{note.label}</b> — {NOTE_TEXT[note.kind]}
                  </li>
                ))}
              </ul>
            )}

            <div className="banner__actions">
              <button type="button" className="btn btn--primary" onClick={banner.save}>
                PNG 저장
              </button>
              <button type="button" className="btn" onClick={banner.dismiss}>
                닫기
              </button>
            </div>
          </div>
        )}
      </section>
    </PanelFold>
  )
}
