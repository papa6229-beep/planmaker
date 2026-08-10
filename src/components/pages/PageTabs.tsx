/**
 * Page filmstrip above the canvas (WORK_PLAN Phase 7 §9.2). Lists the document's
 * pages, switches the active page, and offers per-page actions (rename,
 * duplicate, delete, move left/right) plus "페이지 추가". The strip scrolls
 * horizontally when there are many pages. No fake data — everything reflects the
 * real `BriefDocument`.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStudioJob } from '../../features/studio/useStudioJob'
import { useBriefDocument } from '../../features/document/useBriefDocument'

export function PageTabs() {
  const { pages: allPages, activePageId, addPage, duplicatePage, deletePage, movePage, renamePage, switchPage } =
    useBriefDocument()
  const studio = useStudioJob()
  /**
   * 배너는 페이지로 살지만 여기 나오지 않는다 (배너 Patch §5).
   *
   * 이 탭이 뜻하는 것은 "이벤트 페이지가 몇 장인가"이고, 이벤트 페이지가 두 장인
   * 경우는 없다. 배너 다섯이 끼면 그 뜻이 흐려진다 — 배너는 `WorkList`가 맡는다.
   */
  const pages = allPages.filter((page) => studio?.bannerSpecOf(page.id) == null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirming] = useState<string | null>(null)
  /**
   * The page whose ⋯ menu is open, or `null`. Held here rather than in a
   * `<details>` element so only one menu can ever be open, Esc and a click
   * outside close it, and the trigger is a real button a person can hit.
   */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /**
   * Where the open menu is drawn. The strip scrolls sideways, so it clips
   * anything hanging below it; the panel is therefore positioned against the
   * viewport from the trigger's own rectangle instead of inside the strip.
   */
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const openMenu = (id: string, trigger: HTMLElement) => {
    const r = trigger.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 170))
    setMenuAt({ top: r.bottom + 4, left })
    setOpenMenuId(id)
  }
  const setOpenMenu = (id: string | null) => {
    if (id === null) setMenuAt(null)
    setOpenMenuId(id)
  }

  // A click anywhere outside the strip, or Esc, closes the open menu. The
  // outside listener watches pointerdown, so the very click that opens a menu
  // (which already delivered its pointerdown) never closes it again.
  useEffect(() => {
    if (openMenuId === null) return
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target
      if (target instanceof Node && stripRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    // The panel is anchored to the viewport, so anything that moves the strip
    // closes it rather than leaving it floating away from its tab.
    const onViewportChange = () => setOpenMenu(null)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [openMenuId])

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
  const confirmingPage = pages.find((p) => p.id === confirmingId)

  return (
    <div className="page-tabs" role="group" aria-label="기획 페이지">
      <div className="page-tabs__strip" ref={stripRef}>
        {pages.map((page, i) => {
          const active = page.id === activePageId
          const menuOpen = page.id === openMenuId
          return (
            <div
              key={page.id}
              className={`page-tab${active ? ' is-active' : ''}${menuOpen ? ' is-menu-open' : ''}`}
            >
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

              <div className="page-tab__menu">
                <button
                  type="button"
                  className="page-tab__menu-trigger"
                  aria-label={`${page.title} 페이지 메뉴`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title={`${page.title} 메뉴`}
                  onClick={(e) => {
                    // The trigger sits beside the page button, never inside it,
                    // and its click never doubles as "switch to this page".
                    e.stopPropagation()
                    if (menuOpen) setOpenMenu(null)
                    else openMenu(page.id, e.currentTarget)
                  }}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    className="page-tab__menu-panel"
                    aria-label={`${page.title} 페이지 작업`}
                    style={menuAt ? { top: menuAt.top, left: menuAt.left } : undefined}
                  >
                    <button
                      type="button"
                      className="page-tab__menu-item"
                      onClick={() => {
                        setOpenMenu(null)
                        beginRename(page.id, page.title)
                      }}
                    >
                      이름 변경
                    </button>
                    <button
                      type="button"
                      className="page-tab__menu-item"
                      onClick={() => {
                        setOpenMenu(null)
                        duplicatePage(page.id)
                      }}
                    >
                      복제
                    </button>
                    <button
                      type="button"
                      className="page-tab__menu-item"
                      disabled={i === 0}
                      onClick={() => {
                        setOpenMenu(null)
                        movePage(page.id, -1)
                      }}
                    >
                      왼쪽으로 이동
                    </button>
                    <button
                      type="button"
                      className="page-tab__menu-item"
                      disabled={i === pages.length - 1}
                      onClick={() => {
                        setOpenMenu(null)
                        movePage(page.id, 1)
                      }}
                    >
                      오른쪽으로 이동
                    </button>
                    <button
                      type="button"
                      className="page-tab__menu-item page-tab__menu-item--danger"
                      disabled={onlyOne}
                      title={onlyOne ? '마지막 페이지는 삭제할 수 없습니다' : undefined}
                      onClick={() => {
                        setOpenMenu(null)
                        if (onlyOne) return
                        // A page holding work is never removed on one click.
                        const holdsWork = page.blocks.length > 0 || page.reference.assetId !== undefined
                        if (holdsWork) setConfirming(page.id)
                        else deletePage(page.id)
                      }}
                    >
                      페이지 삭제
                    </button>
                    {onlyOne && (
                      <p className="page-tab__menu-note">마지막 페이지는 삭제할 수 없습니다</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <button type="button" className="page-tabs__add" onClick={addPage}>
          + 페이지 추가
        </button>
      </div>

      {confirmingPage && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setConfirming(null)}>
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="페이지 삭제 확인"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm__text">
              ‘{confirmingPage.title}’를 삭제할까요?<br />
              이 페이지에 넣은 내용도 함께 삭제됩니다.
            </p>
            <div className="confirm__actions">
              <button type="button" className="btn" onClick={() => setConfirming(null)}>취소</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  deletePage(confirmingPage.id)
                  setConfirming(null)
                }}
              >
                페이지 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
