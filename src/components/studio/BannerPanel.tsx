/**
 * 완성본에서 배너를 뽑는다 (배너 Patch §5).
 *
 * 여기서는 **만들기만** 한다. 만들고 나면 그 배너는 페이지가 되고, 가운데 화면이
 * 완성본과 똑같이 그것을 연다 — 확대해서 보고, 조각을 끌어 옮기고, 크기를 바꾸고,
 * 지운다. 그래서 이 패널에 미리보기가 없다. 가운데가 곧 미리보기다.
 *
 * 자동 배치는 **초안**이다. 완벽할 필요가 없고, 그래서 이 패널이 하는 나머지 절반은
 * **무엇을 버렸는지 말하는 것**이다. 배너는 버리는 일이고, 말하지 않으면 사람이
 * 그 배너를 믿고 그대로 내보낸다.
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
  // 만드는 동안·만든 뒤에는 결과 유무와 상관없이 남는다. 만드는 도중 가운데가
  // 잠깐 다른 페이지를 가리키는데, 그때 사라지면 방금 만든 배너의 안내가 함께
  // 사라진다 — 무엇을 버렸는지가 그 안내에만 있다.
  if (banner === null || generation === null) return null
  if (!generation.hasResult && banner.state.kind === 'idle') return null

  const busy = banner.state.kind === 'working' || generation.state.kind === 'running'
  const result = banner.state.kind === 'done' ? banner.state.result : null
  const warnings = result?.notes.filter((n) => NEEDS_EYES.has(n.kind)) ?? []

  return (
    <PanelFold id="banner" title="배너 뽑기" note="완성본 조각을 다시 놓습니다" marked={warnings.length > 0}>
      <section className="banner" aria-label="배너 뽑기">
        <p className="banner__note">
          완성본에 쓴 조각을 배너 규격에 다시 놓습니다. 새로 그리지 않으므로 AI 호출이 없습니다. 만든 뒤에는
          가운데에서 조각을 끌어 옮기고 크기를 바꿀 수 있습니다.
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
              {spec.width}×{spec.height} {banner.viewingSpecId === spec.id ? '다시 만들기' : '만들기'}
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
              <p className="banner__status">배경에서 잔잔한 자리를 고르지 못해 원본 배경을 그대로 썼습니다.</p>
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

            <p className="banner__note">
              저장은 위의 <b>이미지 저장</b>으로 합니다 — 배너도 한 장의 완성본입니다.
            </p>
          </div>
        )}
      </section>
    </PanelFold>
  )
}
