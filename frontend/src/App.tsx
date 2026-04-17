import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Session } from './api/rest'
import Sidebar from './components/Sidebar'
import SessionView from './components/SessionView'
import CredentialsPage from './components/CredentialsPage'
import NewSessionModal from './components/NewSessionModal'
import ConfirmModal from './components/ConfirmModal'
import { COLORS } from './theme'

export default function App() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [page, setPage] = useState<'sessions' | 'settings'>('sessions')
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await api.sessions.list()
      setSessions(list)
      setActiveId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev
        return list[0]?.id ?? null
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onCreated = async (s: Session) => {
    setModalOpen(false)
    await refresh()
    setActiveId(s.id)
    setPage('sessions')
  }

  const requestDelete = (id: string) => {
    const target = sessions?.find((s) => s.id === id) ?? null
    if (target) setPendingDelete(target)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.sessions.remove(pendingDelete.id)
      await refresh()
      setPendingDelete(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  // Memoize so re-renders that don't change (sessions, activeId) don't
  // produce a new `active` object identity — keeps SessionView stable.
  const active = useMemo(
    () => sessions?.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: COLORS.bg,
        color: COLORS.text,
      }}
    >
      <Sidebar
        sessions={sessions ?? []}
        activeId={activeId}
        page={page}
        onSelectSession={(id) => {
          setActiveId(id)
          setPage('sessions')
        }}
        onNewSession={() => setModalOpen(true)}
        onDeleteSession={requestDelete}
        onOpenSettings={() => setPage('settings')}
      />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {error && (
          <div
            style={{
              padding: 10,
              background: '#3a1010',
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        {page === 'settings' ? (
          <CredentialsPage />
        ) : active ? (
          <SessionView
            key={active.id}
            session={active}
            onSessionChanged={refresh}
          />
        ) : (
          <EmptyState onNew={() => setModalOpen(true)} />
        )}
      </main>

      {modalOpen && (
        <NewSessionModal
          onClose={() => setModalOpen(false)}
          onCreated={onCreated}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Delete session?"
          message={`"${pendingDelete.title}" and its conversation history will be permanently removed.`}
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => (deleting ? null : setPendingDelete(null))}
        />
      )}
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 20,
        color: COLORS.textMuted,
        textAlign: 'center',
        padding: 40,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.purple})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 32,
          color: '#fff',
          boxShadow: '0 20px 40px rgba(92,156,246,0.2)',
        }}
      >
        ✨
      </div>
      <div>
        <h2
          style={{
            fontSize: 22,
            margin: '0 0 6px',
            color: COLORS.text,
            fontWeight: 600,
            letterSpacing: -0.015,
          }}
        >
          Start a session
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, maxWidth: 420 }}>
          Point the agent at a folder, pick a model, and go. Every tool call is
          shown inline and nothing leaves your machine.
        </p>
      </div>
      <button
        onClick={onNew}
        style={{
          padding: '10px 22px',
          background: COLORS.blue,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 500,
          fontSize: 14,
          boxShadow: '0 4px 14px rgba(92,156,246,0.3)',
        }}
      >
        + New session
      </button>
    </div>
  )
}
