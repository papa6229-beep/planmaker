/**
 * Vitest setup. @testing-library/react auto-cleans between tests when the
 * framework's afterEach global is present (vitest `globals: true`), but we
 * register cleanup explicitly so the suite is robust regardless of config.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement PointerEvent; provide a MouseEvent-based shim so
// drag/resize tests can carry clientX/clientY and modifier keys.
class PointerEventShim extends MouseEvent {
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
  }
}
if (!('PointerEvent' in globalThis)) {
  Object.defineProperty(globalThis, 'PointerEvent', {
    value: PointerEventShim,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  cleanup()
})
