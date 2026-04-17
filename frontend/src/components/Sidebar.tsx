import { useMemo, useState } from 'react'
import type { Session, SessionStatus } from '../api/rest'
import { COLORS } from '../theme'

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: COLORS.textDim,
  running: COLORS.blue,
  awaiting_approval: COLORS.amber,
  error: COLORS.red,
  stopped: COLORS.textDim,
}

function folderBasename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

function groupByFolder(sessions: Session[]) {
  const groups = new Map<string, Session[]>()
  for (const s of sessions) {
    const key = folderBasename(s.folder_path)
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => b.last_active_at.localeCompare(a.last_active_at))
  }
  return Array.from(groups.entries())
}

export default function Sidebar({
  sessions,
  activeId,
  page,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onOpenSettings,
}: {
  sessions: Session[]
  activeId: string | null
  page: 'sessions' | 'settings'
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onOpenSettings: () => void
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return sessions
    const q = query.trim().toLowerCase()
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        folderBasename(s.folder_path).toLowerCase().includes(q),
    )
  }, [sessions, query])

  const groups = useMemo(() => groupByFolder(filtered), [filtered])

  return (
    <aside
      style={{
        width: 272,
        background: COLORS.bgSidebar,
        borderRight: `1px solid ${COLORS.borderSubtle}`,
        display: 'flex',
        flexDirection: 'column',
        fontSize: 13,
      }}
    >
      <div
        style={{
          padding: '16px 16px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.purple})`,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.01 }}>
          Forge
        </span>
      </div>

      <div style={{ padding: '4px 10px 8px' }}>
        <button
          onClick={onNewSession}
          style={{
            width: '100%',
            padding: '9px 12px',
            textAlign: 'left',
            borderRadius: 8,
            border: `1px solid ${COLORS.border}`,
            background: COLORS.bgCard,
            color: COLORS.text,
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: COLORS.textMuted, fontSize: 14, lineHeight: 1 }}>＋</span>
          New session
        </button>
      </div>

      {sessions.length > 3 && (
        <div style={{ padding: '0 10px 8px' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            style={{
              width: '100%',
              fontSize: 13,
              padding: '6px 10px',
              background: COLORS.bg,
            }}
          />
        </div>
      )}

      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0 12px',
        }}
      >
        {sessions.length === 0 && (
          <p
            style={{
              padding: '18px 18px',
              color: COLORS.textDim,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            No sessions yet. Click + to start one.
          </p>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p style={{ padding: '12px 18px', color: COLORS.textDim, fontSize: 12 }}>
            No matches for "{query}".
          </p>
        )}

        {groups.map(([folder, list]) => (
          <div key={folder} style={{ marginTop: 10 }}>
            <div
              style={{
                padding: '4px 18px',
                color: COLORS.textDim,
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                fontWeight: 600,
              }}
            >
              {folder}
            </div>
            {list.map((s) => {
              const active = page === 'sessions' && s.id === activeId
              return (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={active}
                  onSelect={() => onSelectSession(s.id)}
                  onDelete={() => onDeleteSession(s.id)}
                />
              )
            })}
          </div>
        ))}
      </nav>

      <div
        style={{
          borderTop: `1px solid ${COLORS.borderSubtle}`,
          padding: '10px',
        }}
      >
        <button
          onClick={onOpenSettings}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            borderRadius: 6,
            background: page === 'settings' ? COLORS.bgCard : 'transparent',
            color: page === 'settings' ? COLORS.text : COLORS.textMuted,
            border: 'none',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14 }}>⚙</span> Settings
        </button>
      </div>
    </aside>
  )
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: Session
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 14px 7px 16px',
        marginLeft: 4,
        marginRight: 4,
        borderRadius: 6,
        background: active
          ? COLORS.bgCard
          : hover
            ? COLORS.bgCardHover
            : 'transparent',
        cursor: 'pointer',
        fontSize: 13,
        color: active ? COLORS.text : COLORS.textMuted,
        borderLeft: active
          ? `2px solid ${COLORS.blue}`
          : '2px solid transparent',
        paddingLeft: 14,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: STATUS_COLORS[session.status],
          flexShrink: 0,
          boxShadow:
            session.status === 'running'
              ? `0 0 8px ${COLORS.blue}`
              : undefined,
        }}
        title={session.status}
      />
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: active ? 500 : 400,
        }}
      >
        {session.title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        style={{
          border: 'none',
          padding: '0 4px',
          background: 'transparent',
          color: COLORS.textDim,
          fontSize: 14,
          lineHeight: 1,
          opacity: hover || active ? 0.7 : 0,
          transition: 'opacity 120ms ease',
        }}
        title="Delete session"
      >
        ×
      </button>
    </div>
  )
}
