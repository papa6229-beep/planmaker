import { BLOCK_TYPE_LIST, type BlockCategory } from '../domain'

/**
 * Phase 0 application shell: the 3-column layout described in WORK_PLAN §6
 * (palette · canvas · inspector) plus the top toolbar. Interactive editing,
 * drag-and-drop, and the inspector are built out in later phases; this shell
 * only proves the structure and that the domain catalog is wired in.
 */

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  text: '문구',
  image: '이미지',
  structure: '행사정보',
  reference: '참고 / 링크',
}

const CATEGORY_ORDER: BlockCategory[] = ['text', 'image', 'structure', 'reference']

export function App() {
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="toolbar__brand">Event Brief Builder</strong>
        <nav className="toolbar__actions">
          <button type="button" disabled>새로 만들기</button>
          <button type="button" disabled>불러오기</button>
          <span className="toolbar__status">저장 상태: —</span>
          <button type="button" disabled>미리보기</button>
          <button type="button" disabled>기획서 내보내기</button>
        </nav>
      </header>

      <main className="workspace">
        <aside className="palette" aria-label="블록 팔레트">
          {CATEGORY_ORDER.map((category) => (
            <section key={category} className="palette__group">
              <h2 className="palette__heading">{CATEGORY_LABELS[category]}</h2>
              <ul className="palette__list">
                {BLOCK_TYPE_LIST.filter((meta) => meta.category === category).map((meta) => (
                  <li key={meta.type} className={`palette__item palette__item--${category}`}>
                    {meta.label}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </aside>

        <section className="canvas" aria-label="기획 캔버스">
          <div className="canvas__sheet">
            <p className="canvas__placeholder">
              840px 기준 기획 캔버스<br />
              (Phase 2~3에서 드래그·이동·크기 조절 구현)
            </p>
          </div>
        </section>

        <aside className="inspector" aria-label="선택 블록 설정">
          <h2 className="inspector__heading">선택 블록 설정</h2>
          <p className="inspector__empty">블록을 선택하면 내용·중요도·필수 여부·AI 전달 여부를 편집합니다.</p>
        </aside>
      </main>
    </div>
  )
}
