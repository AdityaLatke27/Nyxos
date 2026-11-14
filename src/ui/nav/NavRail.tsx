import { forwardRef, type ReactNode } from 'react'
import './navRail.css'

export type NavId = 'craters' | 'compare' | 'landing' | 'history'

interface Item {
  id: NavId
  label: string
  short: string
  href?: string
  icon: ReactNode
}

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ITEMS: Item[] = [
  {
    id: 'craters',
    label: 'Crater Analysis',
    short: 'Craters',
    href: '/app/?site=im2',
    icon: (
      <svg viewBox="0 0 24 24" {...ICON}>
        <circle cx="12" cy="12" r="8.5" />
        <ellipse cx="10.2" cy="10.4" rx="3.1" ry="2.5" />
        <circle cx="15.6" cy="15.2" r="1.5" />
        <circle cx="8.4" cy="16" r="0.8" />
      </svg>
    ),
  },
  {
    id: 'compare',
    label: 'Site Comparison',
    short: 'Compare',
    href: '/app/compare',
    icon: (
      <svg viewBox="0 0 24 24" {...ICON}>
        <path d="M7.5 20s-4.5-4.4-4.5-8a4.5 4.5 0 0 1 9 0c0 3.6-4.5 8-4.5 8z" />
        <circle cx="7.5" cy="12" r="1.5" />
        <path d="M16.5 15s-4-3.9-4-7a4 4 0 0 1 8 0c0 3.1-4 7-4 7z" />
        <circle cx="16.5" cy="8" r="1.3" />
      </svg>
    ),
  },
  {
    id: 'landing',
    label: 'Landing Analysis',
    short: 'Landing',
    href: '/app/landing',
    icon: (
      <svg viewBox="0 0 24 24" {...ICON}>
        <path d="M12 3v11" />
        <path d="M8 10.5l4 4 4-4" />
        <path d="M4 20.5h16" />
        <path d="M7 20.5l1.6-3h6.8l1.6 3" />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'Moon History',
    short: 'History',
    href: '/app/history',
    icon: (
      <svg viewBox="0 0 24 24" {...ICON}>
        <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
        <path d="M3.5 4.5v4h4" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
]

interface Props {
  active?: NavId
  /** Starts hidden; the landing intro fades it in. */
  intro?: boolean
}

/** Left-hand navigation between the NYXOS tools, shared by the home page and the tools. */
const NavRail = forwardRef<HTMLElement, Props>(function NavRail({ active, intro }, ref) {
  return (
    <nav className={`nav-rail${intro ? ' intro' : ''}`} aria-label="NYXOS tools" ref={ref}>
      {ITEMS.map((it) =>
        it.href ? (
          <a
            key={it.id}
            className={`nav-item${active === it.id ? ' on' : ''}`}
            href={it.href}
            aria-current={active === it.id ? 'page' : undefined}
            data-tip={it.label}
          >
            {it.icon}
            <span>{it.short}</span>
          </a>
        ) : (
          <span key={it.id} className="nav-item soon" aria-disabled="true" data-tip={`${it.label} · coming soon`}>
            {it.icon}
            <span>{it.short}</span>
          </span>
        ),
      )}
    </nav>
  )
})

export default NavRail
