/**
 * Inline, dependency-free line icons for the product shell (WORK_PLAN Phase 7
 * §8, §11). Used for meaning only and marked aria-hidden by consumers, so they
 * are ignored by screen readers. No external network resources.
 */

interface IconProps {
  className?: string
  size?: number
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
}

/** Document / brief. */
export function DocIcon({ className, size = 24 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M8 12h8M8 16h6" />
    </svg>
  )
}

/** Image / design work. */
export function ImageIcon({ className, size = 24 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 4.5-4.5 4 4 3-3L20 17" />
    </svg>
  )
}

/** Empty inbox / no requests. */
export function InboxIcon({ className, size = 24 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 13 6 5h12l2 8" />
      <path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
      <path d="M4 13h5l1.5 2h3L15 13h5" />
    </svg>
  )
}

/** Brand mark. */
export function BrandMark({ className, size = 24 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="3.5" width="12" height="17" rx="2" />
      <path d="M8 8h4M8 12h4M8 16h2.5" />
      <rect x="14" y="9" width="6" height="6" rx="1.5" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  )
}

/** Right arrow for CTAs. */
export function ArrowRightIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
