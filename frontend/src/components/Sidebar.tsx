import { useMemo, useState } from 'react'
import type { Session, SessionStatus } from '../api/rest'
import { COLORS, providerAccent } from '../theme'

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

function shortModel(model: string): string {
  if (!model) return ''
  return model.replace(/^claude-/, '').replace(/^gemini-/, '')
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
  onGoHome,
}: {
  sessions: Session[]
  activeId: string | null
  page: 'sessions' | 'settings'
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onOpenSettings: () => void
  /** Clear the active session and route to the Home view. Wired to
   *  the logo at the top so "Forge." acts as a "back to home" link. */
  onGoHome: () => void
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
      {/* Wordmark doubles as a "go home" link. Click "Forge." → drop
       * the active session and land on the HomePage. */}
      <button
        type="button"
        onClick={onGoHome}
        title="Home"
        style={{
          padding: '18px 18px 14px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: -0.035,
            color: '#ffffff',
            lineHeight: 1,
          }}
        >
          Forge
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 19,
            fontWeight: 800,
            color: COLORS.purple,
            lineHeight: 1,
            marginLeft: 1,
          }}
        >
          .
        </span>
      </button>

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
              <span>{folder}</span>
              <span style={{ marginLeft: 6, opacity: 0.6 }}>· {list.length}</span>
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
  const accent = providerAccent(session.agent_kind)
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 14px 8px 16px',
        marginLeft: 4,
        marginRight: 4,
        borderRadius: 6,
        background: active
          ? COLORS.bgElevated
          : hover
            ? COLORS.bgCardHover
            : 'transparent',
        cursor: 'pointer',
        fontSize: 13,
        color: active ? COLORS.text : COLORS.textMuted,
        transition: 'background 120ms ease',
      }}
    >
      {/* Provider-accented left rail when active. Absolutely positioned
       * so toggling it doesn't reflow the row's contents (avoiding a
       * 2px horizontal jitter on select). */}
      {active && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            background: accent,
            borderRadius: 2,
          }}
        />
      )}
      {(() => {
        const isAbnormal =
          session.status === 'error' || session.status === 'awaiting_approval'
        const dotColor = isAbnormal ? STATUS_COLORS[session.status] : accent
        return (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: dotColor,
              flexShrink: 0,
              boxShadow:
                session.status === 'running'
                  ? `0 0 6px ${accent}`
                  : undefined,
              opacity: session.status === 'stopped' ? 0.45 : 1,
            }}
            title={`${session.agent_kind} · ${session.status}`}
          />
        )
      })()}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: active ? 500 : 400,
            fontSize: 13,
          }}
        >
          {session.title}
        </span>
        {session.model && (
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 10.5,
              color: accent,
              opacity: 0.75,
              lineHeight: 1.2,
            }}
          >
            {shortModel(session.model)}
          </span>
        )}
      </div>
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
