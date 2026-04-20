import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Session } from './api/rest'
import Sidebar from './components/Sidebar'
import SessionView from './components/SessionView'
import CredentialsPage from './components/CredentialsPage'
import HomePage from './components/HomePage'
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
      // Drop a stale active id if the session no longer exists (e.g.
      // it was deleted in another tab). Otherwise leave selection
      // alone — the user lands on Home by default and explicitly opts
      // into a session from there or from the sidebar.
      setActiveId((prev) =>
        prev && list.some((s) => s.id === prev) ? prev : null,
      )
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
        onGoHome={() => {
          setActiveId(null)
          setPage('sessions')
        }}
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
          <HomePage
            sessions={sessions ?? []}
            onSelectSession={(id) => setActiveId(id)}
            onNewSession={() => setModalOpen(true)}
            onOpenSettings={() => setPage('settings')}
          />
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

