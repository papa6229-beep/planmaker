/**
 * Vitest setup. @testing-library/react auto-cleans between tests when the
 * framework's afterEach global is present (vitest `globals: true`), but we
 * register cleanup explicitly so the suite is robust regardless of config.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
