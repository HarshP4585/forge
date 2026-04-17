import { useEffect, useRef, useState } from 'react'
import { api, type Session } from '../api/rest'
import {
  openSessionSocket,
  type ServerEvent,
  type SessionSocket,
  type WsStatus,
} from '../api/ws'
import MessageList from './MessageList'
import PromptInput, { type Attachment } from './PromptInput'
import QuestionModal, { type AskQuestion } from './QuestionModal'
import { COLORS } from '../theme'

function folderBasename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

const STATUS_META: Record<
  string,
  { color: string; label: string; bg: string }
> = {
  idle: { color: COLORS.textMuted, label: 'Idle', bg: COLORS.bgCard },
  running: { color: COLORS.blue, label: 'Running', bg: 'rgba(92,156,246,0.12)' },
  awaiting_approval: {
    color: COLORS.amber,
    label: 'Waiting',
    bg: 'rgba(217,119,6,0.12)',
  },
  error: { color: COLORS.red, label: 'Error', bg: 'rgba(239,68,68,0.12)' },
  stopped: { color: COLORS.textDim, label: 'Stopped', bg: COLORS.bgCard },
}

const WS_STATUS_LABEL: Record<WsStatus, string> = {
  connecting: 'connecting',
  open: 'connected',
  reconnecting: 'reconnecting',
  closed: 'disconnected',
  error: 'error',
}

export default function SessionView({
  session,
  onSessionChanged,
}: {
  session: Session
  onSessionChanged?: () => void
}) {
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [status, setStatus] = useState<string>(session.status)
  const [title, setTitle] = useState<string>(session.title)
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<
    { id: string; questions: AskQuestion[] } | null
  >(null)
  const socketRef = useRef<SessionSocket | null>(null)
  const lastSeqRef = useRef(0)
  const onSessionChangedRef = useRef(onSessionChanged)
  onSessionChangedRef.current = onSessionChanged

  useEffect(() => {
    let cancelled = false
    setEvents([])
    lastSeqRef.current = 0
    setLoadError(null)

    const applyEvent = (e: ServerEvent) => {
      if (e.seq <= lastSeqRef.current) return
      lastSeqRef.current = e.seq
      setEvents((prev) => [...prev, e])
      if (e.type === 'session.status' && typeof e.status === 'string') {
        setStatus(e.status)
      }
      if (e.type === 'session.title' && typeof e.title === 'string') {
        setTitle(e.title)
        onSessionChangedRef.current?.()
      }
      if (e.type === 'ask.question' && typeof e.id === 'string') {
        setPendingQuestion({
          id: e.id,
          questions: (e.questions as AskQuestion[]) ?? [],
        })
      }
    }

    const catchUpHistory = async () => {
      try {
        const history = (await api.sessions.messages(
          session.id,
        )) as ServerEvent[]
        if (cancelled) return
        setEvents(history)
        lastSeqRef.current = history.length
          ? history[history.length - 1].seq
          : 0
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message)
      }
    }

    ;(async () => {
      await catchUpHistory()
      if (cancelled) return
      const sock = openSessionSocket(session.id, applyEvent, setWsStatus)
      sock.onReconnected(() => {
        // Server may have emitted events we missed during downtime — refetch
        // and rely on seq-based dedup in applyEvent.
        void catchUpHistory()
      })
      socketRef.current = sock
    })()

    return () => {
      cancelled = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [session.id])

  useEffect(() => {
    setStatus(session.status)
    setTitle(session.title)
  }, [session.status, session.title])

  const send = (text: string, attachments: Attachment[]) => {
    socketRef.current?.send({
      type: 'prompt.submit',
      text,
      attachments: attachments.map((a) =>
        a.kind === 'image'
          ? { kind: 'image', name: a.name, mime: a.mime, base64: a.base64 }
          : { kind: 'text', name: a.name, text: a.text },
      ),
    })
  }

  const stop = () => {
    socketRef.current?.send({ type: 'interrupt' })
  }

  const answerQuestion = (answers: Record<string, string | string[]>) => {
    if (!pendingQuestion) return
    socketRef.current?.send({
      type: 'ask.answer',
      id: pendingQuestion.id,
      answers,
    })
    setPendingQuestion(null)
  }

  const running = status === 'running' || status === 'awaiting_approval'
  const folderLabel = folderBasename(session.folder_path)
  const statusMeta = STATUS_META[status] ?? STATUS_META.idle
  const wsConnected = wsStatus === 'open'
  const wsPillColor =
    wsStatus === 'open'
      ? COLORS.green
      : wsStatus === 'reconnecting' || wsStatus === 'connecting'
        ? COLORS.amber
        : COLORS.red

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 24px',
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: COLORS.bgCard,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
          }}
        >
          📁
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              color: COLORS.textDim,
              lineHeight: 1.2,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            {folderLabel}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: -0.01,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        </div>

        <span
          style={{
            fontSize: 11,
            color: COLORS.textDim,
            padding: '4px 8px',
            background: COLORS.bgCard,
            borderRadius: 999,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {session.agent_kind} · {session.model}
        </span>
        <span
          style={{
            fontSize: 11,
            color: statusMeta.color,
            padding: '4px 10px',
            background: statusMeta.bg,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: statusMeta.color,
              boxShadow:
                status === 'running' ? `0 0 8px ${statusMeta.color}` : undefined,
            }}
          />
          {statusMeta.label}
        </span>
        {!wsConnected && (
          <span
            style={{
              fontSize: 10,
              color: wsPillColor,
              padding: '3px 8px',
              border: `1px solid ${wsPillColor}55`,
              borderRadius: 999,
            }}
            title="WebSocket is not currently connected; messages are buffered until it reopens."
          >
            {WS_STATUS_LABEL[wsStatus]}
          </span>
        )}
      </header>

      {loadError && (
        <div style={{ color: COLORS.red, padding: 10, fontSize: 13 }}>
          Error: {loadError}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '24px',
        }}
      >
        <MessageList events={events} />
      </div>

      <div style={{ padding: '0 24px 18px' }}>
        <PromptInput
          sessionFolder={session.folder_path}
          wsOpen={wsConnected}
          running={running}
          onSend={send}
          onStop={stop}
          footerLeft={`${session.agent_kind} · ${session.model}`}
          footerRight={
            wsConnected ? statusMeta.label : WS_STATUS_LABEL[wsStatus]
          }
        />
      </div>

      {pendingQuestion && (
        <QuestionModal
          questions={pendingQuestion.questions}
          onSubmit={answerQuestion}
          onCancel={() => answerQuestion({})}
        />
      )}
    </div>
  )
}
