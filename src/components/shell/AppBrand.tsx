/**
 * Service brand mark + name (WORK_PLAN Phase 7 §3A, §7). Links back to the
 * gate. The name is unified to the existing project identity ("Event Brief
 * Builder", per README) rather than introducing a new brand mid-project.
 */

import { Link } from 'react-router-dom'
import { BrandMark } from './icons'

export const SERVICE_NAME = 'Event Brief Builder'
export const SERVICE_TAGLINE = '기획 요청과 디자인 작업을 한곳에서'

export function AppBrand() {
  return (
    <Link className="app-brand" to="/" aria-label={`${SERVICE_NAME} 홈`}>
      <span className="app-brand__mark" aria-hidden="true">
        <BrandMark size={22} />
      </span>
      <span className="app-brand__text">
        <span className="app-brand__name">{SERVICE_NAME}</span>
        <span className="app-brand__tag">{SERVICE_TAGLINE}</span>
      </span>
    </Link>
  )
}
