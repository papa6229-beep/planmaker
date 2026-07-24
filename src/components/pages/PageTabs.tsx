/**
 * Page filmstrip above the canvas (WORK_PLAN Phase 7 §9.2). Lists the document's
 * pages, switches the active page, and offers per-page actions (rename,
 * duplicate, delete, move left/right) plus "페이지 추가". The strip scrolls
 * horizontally when there are many pages. No fake data — everything reflects the
 * real `BriefDocument`.
 */

import { useState, type KeyboardEvent } from 'react'
import { useBriefDocument } from '../../features/document/useBriefDocument'

/** Closes the <details> menu that contains the clicked element. */
function closeMenu(el: HTMLElement): void {
  el.closest('details')?.removeAttribute('open')
}

export function PageTabs() {
  const { pages, activePageId, addPage, duplicatePage, deletePage, movePage, renamePage, switchPage } =
    useBriefDocument()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const beginRename = (id: string, title: string) => {
    setRenamingId(id)
    setDraft(title)
  }
  const commitRename = () => {
    if (renamingId !== null) {
      const title = draft.trim()
      if (title) renamePage(renamingId, title)
    }
    setRenamingId(null)
  }
  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename()
    else if (e.key === 'Escape') setRenamingId(null)
  }

  const onlyOne = pages.length <= 1

  return (
    <div className="page-tabs" role="group" aria-label="기획 페이지">
      <div className="page-tabs__strip">
        {pages.map((page, i) => {
          const active = page.id === activePageId
          return (
            <div key={page.id} className={`page-tab${active ? ' is-active' : ''}`}>
              {renamingId === page.id ? (
                <input
                  className="page-tab__rename"
                  aria-label="페이지 이름"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onRenameKey}
                  onBlur={commitRename}
                />
              ) : (
                <button
                  type="button"
                  className="page-tab__label"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => switchPage(page.id)}
                  onDoubleClick={() => beginRename(page.id, page.title)}
                  title={page.title}
                >
                  {page.title}
                </button>
              )}

              <details className="page-tab__menu">
                <summary className="page-tab__menu-trigger" aria-label={`${page.title} 페이지 메뉴`}>
                  ⋯
                </summary>
                <div className="page-tab__menu-panel" aria-label={`${page.title} 페이지 작업`}>
                  <button
                    type="button"
                    className="page-tab__menu-item"
                    onClick={(e) => {
                      closeMenu(e.currentTarget)
                      beginRename(page.id, page.title)
                    }}
                  >
                    이름 변경
                  </button>
                  <button
                    type="button"
                    className="page-tab__menu-item"
                    onClick={(e) => {
                      closeMenu(e.currentTarget)
                      duplicatePage(page.id)
                    }}
                  >
                    복제
                  </button>
                  <button
                    type="button"
                    className="page-tab__menu-item"
                    disabled={i === 0}
                    onClick={(e) => {
                      closeMenu(e.currentTarget)
                      movePage(page.id, -1)
                    }}
                  >
                    왼쪽으로 이동
                  </button>
                  <button
                    type="button"
                    className="page-tab__menu-item"
                    disabled={i === pages.length - 1}
                    onClick={(e) => {
                      closeMenu(e.currentTarget)
                      movePage(page.id, 1)
                    }}
                  >
                    오른쪽으로 이동
                  </button>
                  <button
                    type="button"
                    className="page-tab__menu-item page-tab__menu-item--danger"
                    disabled={onlyOne}
                    onClick={(e) => {
                      closeMenu(e.currentTarget)
                      if (!onlyOne) deletePage(page.id)
                    }}
                  >
                    삭제
                  </button>
                </div>
              </details>
            </div>
          )
        })}

        <button type="button" className="page-tabs__add" onClick={addPage}>
          + 페이지 추가
        </button>
      </div>
    </div>
  )
}
