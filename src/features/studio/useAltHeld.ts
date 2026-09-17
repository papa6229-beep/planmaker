/** Alt를 누르고 있는가 — 돋보기가 축소로 바뀐 것을 보여 주려고 (돋보기 도구 Patch). */

import { useEffect, useState } from 'react'

export function useAltHeld(): boolean {
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => setAlt(e.altKey)
    const off = () => setAlt(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return alt
}
