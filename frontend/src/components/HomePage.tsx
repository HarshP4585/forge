import { useEffect, useMemo, useState } from 'react'
import {
  api,
  formatTokens,
  type AgentKind,
  type CredentialStatus,
  type ModelsDetails,
  type Session,
} from '../api/rest'
import { COLORS, providerAccent } from '../theme'
import Dropdown from './Dropdown'

const ALL = '__all__' // sentinel for "no filter applied" in dropdowns

/**
 * Landing page shown when no session is active. Lets the user quickly
 * start something new, resume recent work, or spot a missing provider
 * setup without digging into Settings.
 *
 * Not an empty-state illustration — a real functional home with recent
 * sessions as clickable cards and a provider-status row that routes to
 * Settings when something isn't configured.
 */

const AGENTS: { kind: AgentKind; label: string }[] = [
  { kind: 'claude', label: 'Claude' },
  { kind: 'openai', label: 'OpenAI' },
  { kind: 'gemini', label: 'Gemini' },
]

function folderBasename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 45) return 'just now'
  if (secs < 60 * 60) return `${Math.floor(secs / 60)}m ago`
  if (secs < 60 * 60 * 24) return `${Math.floor(secs / 60 / 60)}h ago`
  if (secs < 60 * 60 * 24 * 7)
    return `${Math.floor(secs / 60 / 60 / 24)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function HomePage({
  sessions,
  onSelectSession,
  onNewSession,
  onOpenSettings,
}: {
  sessions: Session[]
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onOpenSettings: () => void
}) {
  const [creds, setCreds] = useState<CredentialStatus[] | null>(null)
  const [modelDetails, setModelDetails] = useState<ModelsDetails | null>(null)
  const [usageBySession, setUsageBySession] = useState<Record<
    string,
    number
  > | null>(null)
  const [query, setQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState<string>(ALL)
  const [modelFilter, setModelFilter] = useState<string>(ALL)

  useEffect(() => {
    let cancelled = false
    // Three parallel fetches; any one failing doesn't block the others
    // from rendering their contribution.
    api.credentials
      .list()
      .then((c) => {
        if (!cancelled) setCreds(c)
      })
      .catch(() => {
        /* provider row just won't render */
      })
    api.models
      .details()
      .then((m) => {
        if (!cancelled) setModelDetails(m)
      })
      .catch(() => {
        /* context bars just won't render */
      })
    api.sessions
      .usage()
      .then((u) => {
        if (!cancelled) setUsageBySession(u)
      })
      .catch(() => {
        /* cards render without usage bars */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Unique folder basenames + models across all sessions, used to
  // populate the filter dropdowns. Recomputed when the session list
  // changes (create / delete / refresh).
  const folderOptions = useMemo(() => {
    const names = new Set<string>()
    for (const s of sessions) names.add(folderBasename(s.folder_path))
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [sessions])

  const modelOptions = useMemo(() => {
    const names = new Set<string>()
    for (const s of sessions) if (s.model) names.add(s.model)
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [sessions])

  const hasActiveFilter =
    query.trim() !== '' || folderFilter !== ALL || modelFilter !== ALL

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...sessions]
      .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at))
      .filter((s) => {
        if (folderFilter !== ALL && folderBasename(s.folder_path) !== folderFilter)
          return false
        if (modelFilter !== ALL && s.model !== modelFilter) return false
        if (q) {
          const hay =
            `${s.title} ${folderBasename(s.folder_path)} ${s.model} ${s.agent_kind}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
  }, [sessions, query, folderFilter, modelFilter])

  // When the user is actively filtering, show every match; otherwise
  // the homepage is an at-a-glance recap and six cards are plenty.
  const visible = hasActiveFilter ? filtered : filtered.slice(0, 6)

  const clearFilters = () => {
    setQuery('')
    setFolderFilter(ALL)
    setModelFilter(ALL)
  }

  const configuredCount = useMemo(
    () => (creds ?? []).filter((c) => c.has_key).length,
    [creds],
  )

  return (
    <div
      style={{
        // Align the home content to the left so it sits close to the
        // sidebar instead of floating in the middle of a huge empty
        // canvas. A generous max-width caps line length on very wide
        // displays; short line-lengths remain readable.
        maxWidth: 1200,
        padding: '56px 56px 48px',
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: -0.03,
            margin: '0 0 8px',
            color: COLORS.text,
          }}
        >
          {sessions.length > 0 ? 'Welcome back' : 'Welcome'}
          <span style={{ color: COLORS.purple }}>.</span>
        </h1>
        <p
          style={{
            fontSize: 15,
            color: COLORS.textMuted,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {sessions.length > 0
            ? 'Pick up where you left off, or start something new.'
            : 'Point an agent at a folder and describe what you want done. Every tool call is shown inline.'}
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 40 }}>
        <button
          onClick={onNewSession}
          style={{
            padding: '10px 20px',
            background: COLORS.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 4px 14px rgba(92,156,246,0.25)',
            cursor: 'pointer',
          }}
        >
          + New session
        </button>
        {configuredCount === 0 && (
          <button
            onClick={onOpenSettings}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              color: COLORS.amber,
              border: `1px solid ${COLORS.amber}55`,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            ⚠ No provider configured — open Settings
          </button>
        )}
      </div>

      {sessions.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <SectionLabel>
              {hasActiveFilter
                ? `Sessions · ${filtered.length} match${
                    filtered.length === 1 ? '' : 'es'
                  }`
                : 'Recent sessions'}
            </SectionLabel>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: COLORS.textMuted,
                  fontSize: 11,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          <FilterBar
            query={query}
            onQueryChange={setQuery}
            folderValue={folderFilter}
            folderOptions={folderOptions}
            onFolderChange={setFolderFilter}
            modelValue={modelFilter}
            modelOptions={modelOptions}
            onModelChange={setModelFilter}
          />

          {visible.length === 0 ? (
            <div
              style={{
                marginTop: 20,
                padding: '22px 18px',
                border: `1px dashed ${COLORS.border}`,
                borderRadius: 10,
                color: COLORS.textDim,
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              No sessions match those filters.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 12,
                marginTop: 16,
              }}
            >
              {visible.map((s) => {
                const used = usageBySession?.[s.id]
                const ctx =
                  modelDetails?.[s.agent_kind]?.find((d) => d.id === s.model)
                    ?.context_window ?? null
                return (
                  <SessionCard
                    key={s.id}
                    session={s}
                    usedTokens={used}
                    contextWindow={ctx}
                    onClick={() => onSelectSession(s.id)}
                  />
                )
              })}
            </div>
          )}

          {!hasActiveFilter && filtered.length > visible.length && (
            <div
              style={{
                marginTop: 14,
                fontSize: 11,
                color: COLORS.textDim,
              }}
            >
              Showing {visible.length} of {filtered.length}. Search or
              filter to see the rest.
            </div>
          )}
        </section>
      )}

      <section>
        <SectionLabel>Providers</SectionLabel>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 14,
          }}
        >
          {AGENTS.map((a) => {
            const has =
              creds?.find((c) => c.agent_kind === a.kind)?.has_key ?? false
            return (
              <ProviderChip
                key={a.kind}
                kind={a.kind}
                label={a.label}
                configured={has}
                onClick={onOpenSettings}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function FilterBar({
  query,
  onQueryChange,
  folderValue,
  folderOptions,
  onFolderChange,
  modelValue,
  modelOptions,
  onModelChange,
}: {
  query: string
  onQueryChange: (s: string) => void
  folderValue: string
  folderOptions: string[]
  onFolderChange: (v: string) => void
  modelValue: string
  modelOptions: string[]
  onModelChange: (v: string) => void
}) {
  const folderOpts = [
    { value: ALL, label: 'All folders' },
    ...folderOptions.map((f) => ({ value: f, label: f })),
  ]
  const modelOpts = [
    { value: ALL, label: 'All models' },
    ...modelOptions.map((m) => ({ value: m, label: m })),
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 220 }}>
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={COLORS.textDim}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by title, folder, model…"
          aria-label="Search sessions"
          style={{
            width: '100%',
            padding: '8px 10px 8px 32px',
            fontSize: 13,
          }}
        />
      </div>
      <div style={{ minWidth: 180 }}>
        <Dropdown
          value={folderValue}
          onChange={onFolderChange}
          options={folderOpts}
          aria-label="Filter by folder"
        />
      </div>
      <div style={{ minWidth: 180 }}>
        <Dropdown
          value={modelValue}
          onChange={onModelChange}
          options={modelOpts}
          aria-label="Filter by model"
        />
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: COLORS.textDim,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  )
}

function SessionCard({
  session,
  usedTokens,
  contextWindow,
  onClick,
}: {
  session: Session
  usedTokens?: number
  contextWindow: number | null
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const accent = providerAccent(session.agent_kind)
  const folder = folderBasename(session.folder_path)

  const hasUsage =
    typeof usedTokens === 'number' && usedTokens > 0 && !!contextWindow
  const pct = hasUsage
    ? Math.min(100, (usedTokens! / contextWindow!) * 100)
    : 0
  const barColor =
    pct >= 90 ? COLORS.red : pct >= 70 ? COLORS.amber : accent

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '14px 16px',
        background: hover ? COLORS.bgCardHover : COLORS.bgCard,
        border: `1px solid ${hover ? COLORS.borderStrong : COLORS.border}`,
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'background 140ms ease, border-color 140ms ease',
        color: COLORS.text,
        fontFamily: 'inherit',
      }}
    >
      {/* Provider-colored rail at the top of each card */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 14,
          right: 14,
          height: 2,
          background: accent,
          opacity: 0.7,
          borderRadius: '0 0 2px 2px',
        }}
      />
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: COLORS.textDim,
          marginBottom: 6,
          marginTop: 2,
        }}
      >
        {folder}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: COLORS.text,
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          minHeight: 38,
        }}
      >
        {session.title}
      </div>
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: COLORS.textDim,
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: accent,
            }}
          />
          {session.model}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {relativeTime(session.last_active_at)}
        </span>
      </div>
      {hasUsage && (
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 10.5,
            color: COLORS.textDim,
          }}
          title={`Context used: ${usedTokens!.toLocaleString()} / ${contextWindow!.toLocaleString()} (${pct.toFixed(1)}%)`}
        >
          <span
            aria-hidden
            style={{
              position: 'relative',
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: COLORS.bgElevated,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${pct}%`,
                background: barColor,
                transition: 'width 220ms ease',
              }}
            />
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>
            {formatTokens(usedTokens!)}
            <span style={{ opacity: 0.45 }}> / {formatTokens(contextWindow!)}</span>
          </span>
        </div>
      )}
    </button>
  )
}

function ProviderChip({
  kind,
  label,
  configured,
  onClick,
}: {
  kind: AgentKind
  label: string
  configured: boolean
  onClick: () => void
}) {
  const accent = providerAccent(kind)
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        configured
          ? `${label} — configured. Click to manage keys.`
          : `${label} — no key set. Click to add one.`
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px 6px 10px',
        background: COLORS.bgCard,
        border: `1px solid ${configured ? accent + '44' : COLORS.border}`,
        borderRadius: 999,
        fontSize: 12,
        color: configured ? COLORS.text : COLORS.textMuted,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: configured ? accent : 'transparent',
          border: configured ? 'none' : `1.5px solid ${COLORS.textDim}`,
        }}
      />
      {label}
      <span
        style={{
          fontSize: 10.5,
          color: configured ? COLORS.textDim : COLORS.textDim,
          opacity: 0.8,
          marginLeft: 2,
        }}
      >
        {configured ? 'configured' : 'not set'}
      </span>
    </button>
  )
}
