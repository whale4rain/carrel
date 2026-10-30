// The few line icons the shell uses, drawn as in the Margin mockups.

const line = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export const SearchIcon = () => (
  <svg {...line}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

export const ChevronIcon = () => (
  <svg {...line}>
    <path d="M7 10l5 5 5-5" />
  </svg>
)

export const BookIcon = () => (
  <svg {...line}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
  </svg>
)

export const LinkIcon = () => (
  <svg {...line}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
  </svg>
)

export const SparkIcon = () => (
  <svg {...line}>
    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
  </svg>
)

export const NoteIcon = () => (
  <svg {...line}>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 12h7M9 16h5" />
  </svg>
)

export const HandIcon = () => (
  <svg {...line}>
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
)

export const MapIcon = () => (
  <svg {...line}>
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
)

export const SidebarIcon = () => (
  <svg {...line} width={14} height={14}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
)

/** A ribbon: hollow, or filled when the page is kept. */
export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...line} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
)

export const FolderIcon = () => (
  <svg {...line}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

export const PinIcon = () => (
  <svg {...line}>
    <path d="M12 17v5" />
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
  </svg>
)

export const CalendarIcon = () => (
  <svg {...line}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
)

export const TableIcon = () => (
  <svg {...line}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M10 10v10" />
  </svg>
)

/** The memory map: three pieces joined by lines. */
export const LinesIcon = () => (
  <svg {...line}>
    <circle cx="5" cy="17" r="2" />
    <circle cx="12" cy="7" r="2" />
    <circle cx="19" cy="15" r="2" />
    <path d="M6.5 15.5 10.5 8.5M13.8 8.2l3.6 5.4" />
  </svg>
)

// The rail's icons: larger, and a little lighter, as in the MarginNavB mockup.
const rail = { ...line, width: 18, height: 18, strokeWidth: 1.75 } as const

/** One icon per place on the rail. */
export const PlaceIcon = ({ place }: { place: 'map' | 'today' | 'desks' | 'notes' | 'sources' | 'search' | 'settings' | 'keys' }) => (
  <svg {...rail}>
    {place === 'map' && (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="17" r="2" />
        <path d="M8 7.5l8-1M7 9l4 6.5M17 8l-4 7.5" />
      </>
    )}
    {place === 'today' && (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>
    )}
    {place === 'desks' && (
      <>
        <rect x="3" y="5" width="8" height="10" rx="1" />
        <rect x="13" y="8" width="8" height="11" rx="1" />
      </>
    )}
    {place === 'notes' && <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5" />}
    {place === 'sources' && <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5" />}
    {place === 'search' && (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5" />
      </>
    )}
    {place === 'settings' && (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
      </>
    )}
    {place === 'keys' && (
      <>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
      </>
    )}
  </svg>
)
