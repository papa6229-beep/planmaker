/**
 * 접었다 펴는 우측 패널 한 칸 (우측 패널 정리 Patch).
 *
 * 작업판 오른쪽에는 성격이 다른 도구가 여섯 벌 있다 — 고른 블록의 배치, 그 블록의
 * 생성 전 주문, 합성 효과, 결과 톤, 종이 테두리, 그리고 부분수정. 전부 펼쳐 두면
 * 슬라이더만 열 개가 넘게 세로로 늘어서고, **지금 하려는 일이 어느 칸인지** 화면이
 * 말해 주지 못한다.
 *
 * 그래서 접는다. 접힌 칸도 제목은 남으므로 무엇이 있는지는 여전히 보이고, 한 번
 * 펴 두면 그 상태가 이 세션 동안 유지된다 — 같은 값을 여러 번 만지는 일이 대부분
 * 이기 때문이다.
 *
 * 열림 상태는 **저장하지 않는다.** 작업 내용이 아니라 화면 상태이고, 저장하면
 * 작업 파일이 그만큼 다른 컴퓨터의 화면까지 정하게 된다.
 */

import { useState, type ReactNode } from 'react'

/** 칸 이름 → 열려 있는가. 화면을 떠났다 돌아와도 이 세션 동안은 그대로다. */
const opened = new Map<string, boolean>()

export function PanelFold({
  id,
  title,
  /** 접혀 있을 때 제목 옆에 붙는 한 마디 — 안에 무엇이 있는지. */
  note,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  note?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => opened.get(id) ?? defaultOpen)
  const toggle = () => {
    const next = !open
    opened.set(id, next)
    setOpen(next)
  }

  return (
    <section className={`fold${open ? ' fold--open' : ''}`}>
      <button type="button" className="fold__head" aria-expanded={open} onClick={toggle}>
        <span className="fold__mark" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="fold__title">{title}</span>
        {!open && note !== undefined && <span className="fold__note">{note}</span>}
      </button>
      {open && <div className="fold__body">{children}</div>}
    </section>
  )
}
