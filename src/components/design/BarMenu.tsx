/**
 * 도구 막대의 작은 부품들 (도구 막대 Patch, 2026-09-17).
 *
 *  - `BarMenu`: 아이콘을 누르면 그 아래로 펼쳐지는 창. 화면 위 층에 떠서 캔버스나
 *    완성본 판에 잘리지 않고, 화면 밖으로 나가지 않게 자리를 잡는다. 바깥을 누르거나
 *    Esc를 누르면 닫힌다.
 *  - `NumField` · `ColorField` · `ToggleButton` · `RangeField`: 막대에 바로 서는 칸.
 *    바꾸기 시작할 때 `onStart`(되돌리기 한 칸)를 한 번 부른다.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function BarMenu({
  label,
  icon,
  title,
  marked = false,
  width = 280,
  disabled = false,
  children,
}: {
  label: string
  /** 막대에 보이는 것. 없으면 `label`. */
  icon?: ReactNode
  title?: string
  /** 켜진 값이 있으면 점을 단다. */
  marked?: boolean
  width?: number
  disabled?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r === undefined) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = panelRef.current?.offsetWidth || width
      const h = Math.min(panelRef.current?.offsetHeight ?? 300, vh - 16)
      const left = Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8))
      let top = r.bottom + 6
      if (top + h > vh - 8) top = Math.max(8, r.top - 6 - h)
      setAt({ left: Math.round(left), top: Math.round(top), maxHeight: vh - 16 })
    }
    place()
    const again = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    if (panelRef.current) sized?.observe(panelRef.current)
    return () => {
      cancelAnimationFrame(again)
      sized?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`design-bar__btn${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title ?? label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ?? label}
        {marked && <span className="design-bar__dot" aria-hidden="true" />}
        <span className="design-bar__caret" aria-hidden="true">▾</span>
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            className="design-menu"
            role="dialog"
            aria-label={label}
            style={
              at === null
                ? { visibility: 'hidden', width }
                : { left: at.left, top: at.top, maxHeight: at.maxHeight, width }
            }
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}

export function NumField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  onStart,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  onStart: () => void
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
  }
  return (
    <label className="design-bar__num" title={label}>
      <span className="design-bar__num-label">{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft ?? String(Number(value.toFixed(2)))}
        onFocus={() => {
          onStart()
          setDraft(null)
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {suffix !== undefined && <span className="design-bar__num-suffix">{suffix}</span>}
    </label>
  )
}

export function ColorField({
  label,
  value,
  disabled = false,
  onStart,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onStart: () => void
  onChange: (hex: string) => void
}) {
  return (
    <label className="design-bar__color" title={label}>
      <input
        type="color"
        aria-label={label}
        value={value}
        disabled={disabled}
        onFocus={onStart}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function ToggleButton({
  label,
  icon,
  on,
  disabled = false,
  onToggle,
}: {
  label: string
  icon?: ReactNode
  on: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`design-bar__btn${on ? ' is-on' : ''}`}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onToggle}
    >
      {icon ?? label}
    </button>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  shown,
  disabled = false,
  onStart,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  shown?: string
  disabled?: boolean
  onStart: () => void
  onChange: (value: number) => void
}) {
  return (
    <label className="design-range">
      <span className="design-range__label">
        {label}
        {shown !== undefined && <b> {shown}</b>}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onPointerDown={onStart}
        onKeyDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
