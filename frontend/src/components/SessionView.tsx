import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  formatTokens,
  type ModelsByAgent,
  type ModelsDetails,
  type Session,
} from '../api/rest'
import {
  openSessionSocket,
  type ServerEvent,
  type SessionSocket,
  type WsStatus,
} from '../api/ws'
import Dropdown from './Dropdown'
import MessageList from './MessageList'
import PromptInput, { type Attachment } from './PromptInput'
import QuestionModal, { type AskQuestion } from './QuestionModal'
import { COLORS, FONTS, providerAccent } from '../theme'

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
  const [models, setModels] = useState<ModelsByAgent | null>(null)
  const [modelDetails, setModelDetails] = useState<ModelsDetails | null>(null)
  const [currentModel, setCurrentModel] = useState<string>(session.model)
  const [modelSwitching, setModelSwitching] = useState(false)
  const [compacting, setCompacting] = useState(false)
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
      if (e.type === 'compact.start') {
        setCompacting(true)
      }
      if (e.type === 'compact.result') {
        setCompacting(false)
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
    setCurrentModel(session.model)
  }, [session.status, session.title, session.model])

  useEffect(() => {
    let cancelled = false
    api.models
      .list()
      .then((m) => {
        if (!cancelled) setModels(m)
      })
      .catch(() => {
        /* non-fatal — dropdown just falls back to the current model */
      })
    api.models
      .details()
      .then((d) => {
        if (!cancelled) setModelDetails(d)
      })
      .catch(() => {
        /* non-fatal — tooltip just won't show context info */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Context info for the currently-selected model (for the header pill
  // tooltip). Null while loading or if the model isn't in the table.
  const currentDetail =
    modelDetails?.[session.agent_kind]?.find((d) => d.id === currentModel) ??
    null

  // "Current context usage" = the input-token count from the most
  // recent completed turn. That number reflects the size of everything
  // the model saw on that turn (system prompt + full history). On the
  // next turn it'll grow further.
  const lastUsage = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'usage') {
        return {
          input: Number(e.input_tokens ?? 0),
          output: Number(e.output_tokens ?? 0),
        }
      }
    }
    return null
  }, [events])

  // Context usage percentage drives the compact-button styling —
  // muted below 70%, amber 70–89%, red ≥90% (matches the meter).
  const contextPct =
    lastUsage && currentDetail?.context_window
      ? Math.min(
          100,
          (lastUsage.input / currentDetail.context_window) * 100,
        )
      : 0
  const showCompactHint = contextPct >= 80
  const compactHintColor =
    contextPct >= 90
      ? COLORS.red
      : contextPct >= 70
        ? COLORS.amber
        : COLORS.textMuted
  const modelTooltip = currentDetail
    ? [
        'Change model for this session',
        currentDetail.context_window
          ? `Context: ${formatTokens(currentDetail.context_window)}`
          : null,
        currentDetail.max_output_tokens
          ? `Max output: ${formatTokens(currentDetail.max_output_tokens)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Change model for this session'

  const onModelChange = async (nextModel: string) => {
    if (nextModel === currentModel) return
    const prev = currentModel
    setCurrentModel(nextModel)
    setModelSwitching(true)
    setLoadError(null)
    try {
      await api.sessions.update(session.id, { model: nextModel })
      onSessionChangedRef.current?.()
    } catch (e) {
      setCurrentModel(prev)
      setLoadError(`Couldn't switch model: ${(e as Error).message}`)
    } finally {
      setModelSwitching(false)
    }
  }

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
    const sock = socketRef.current
    if (!sock) {
      console.warn('[forge] Stop: no socket')
      return
    }
    console.info('[forge] Stop → sending interrupt')
    sock.send({ type: 'interrupt' })
  }

  const compact = () => {
    if (compacting) return
    // Optimistically flip the local flag; compact.start confirms,
    // compact.result clears. Error path also clears (backend emits
    // compact.result with ok=false on failure).
    setCompacting(true)
    socketRef.current?.send({ type: 'compact' })
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
  const accent = providerAccent(session.agent_kind)
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

        {/* Live context-usage bar. Sits just before the model pill so
         * the "how full is this session" signal is next to the "which
         * model is it" signal. Hidden until at least one turn has
         * completed (no usage events → nothing to show yet). */}
        {lastUsage && currentDetail?.context_window ? (
          <ContextMeter
            used={lastUsage.input}
            total={currentDetail.context_window}
          />
        ) : null}
        {/* Compact button — manual trigger to summarize the
         * conversation and shrink the context. Styled as a proper
         * primary-weight action so it reads as a button you can
         * reach for, not a tertiary chip. Color intensifies into
         * amber at 70% and red at 90%, with a pulsing glow above
         * 80% to nudge the user when a compact is a good idea. */}
        {(() => {
          const disabled = compacting || running || !lastUsage
          // Default state uses the accent palette (blue-ish) so the
          // button is always visible, not just at threshold.
          const baseColor = COLORS.blue
          const activeColor = showCompactHint ? compactHintColor : baseColor
          const title = compacting
            ? 'Compacting conversation…'
            : running
              ? "Can't compact while a turn is running"
              : !lastUsage
                ? 'Send a prompt first'
                : showCompactHint
                  ? `Conversation is getting large (${contextPct.toFixed(
                      0,
                    )}%). Compact summarizes older turns so future prompts use less context.`
                  : 'Summarize older turns to free up context'
          return (
            <button
              type="button"
              onClick={compact}
              disabled={disabled}
              title={title}
              style={{
                fontSize: 12,
                padding: '5px 12px 5px 10px',
                borderRadius: 999,
                border: `1px solid ${activeColor}66`,
                background: `${activeColor}1f`,
                color: activeColor,
                fontFamily: 'inherit',
                fontWeight: 600,
                letterSpacing: 0.1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                boxShadow:
                  showCompactHint && !compacting
                    ? `0 0 0 3px ${activeColor}33`
                    : undefined,
                transition:
                  'color 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 120ms ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                lineHeight: 1,
              }}
            >
              {compacting ? (
                <>
                  <span
                    className="forge-pulse-dot"
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'currentColor',
                    }}
                  />
                  Compacting…
                </>
              ) : (
                <>
                  {/* Compress icon — two arrows pointing toward each
                   * other. Visually says "fold this down". */}
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="14" y1="10" x2="21" y2="3" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                  {showCompactHint ? (
                    <>
                      <span aria-hidden>⚠</span>
                      Compact
                    </>
                  ) : (
                    'Compact'
                  )}
                </>
              )}
            </button>
          )
        })()}
        {/* Model pill: outlined, monospace, dim. The provider-colored dot
         * on the left carries the "which provider" signal. Designed to
         * read as metadata, not primary status. */}
        <span
          style={{
            fontSize: 11,
            color: COLORS.textMuted,
            padding: '3px 10px 3px 8px',
            background: 'transparent',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 999,
            fontFamily: FONTS.mono,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: modelSwitching ? 0.6 : 1,
          }}
          title={modelSwitching ? 'Switching model…' : modelTooltip}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: accent,
              flexShrink: 0,
            }}
          />
          {session.agent_kind}
          <span style={{ opacity: 0.4 }}>/</span>
          <Dropdown
            variant="inline"
            value={currentModel}
            onChange={(m) => void onModelChange(m)}
            options={models?.[session.agent_kind] ?? [currentModel]}
            disabled={modelSwitching || !models}
            aria-label="Model"
          />
          {currentDetail?.context_window ? (
            <span
              style={{
                marginLeft: 2,
                paddingLeft: 8,
                borderLeft: `1px solid ${COLORS.border}`,
                color: COLORS.textDim,
                fontSize: 10.5,
                letterSpacing: 0.3,
              }}
              title={
                currentDetail.max_output_tokens
                  ? `Context window · max output ${formatTokens(currentDetail.max_output_tokens)}`
                  : 'Context window'
              }
            >
              {formatTokens(currentDetail.context_window)}
            </span>
          ) : null}
        </span>
        {/* Status pill: filled, the primary signal of "what's the agent
         * doing right now". Intentionally visually louder than the model
         * pill above. */}
        <span
          style={{
            fontSize: 11,
            color: statusMeta.color,
            padding: '4px 11px',
            background: statusMeta.bg,
            border: `1px solid ${statusMeta.color}22`,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 600,
            letterSpacing: 0.1,
          }}
        >
          <span
            className={status === 'running' ? 'forge-pulse-dot' : undefined}
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
        <MessageList
          events={events}
          agentKind={session.agent_kind}
          contextLimits={
            currentDetail
              ? {
                  context_window: currentDetail.context_window,
                  max_output_tokens: currentDetail.max_output_tokens,
                }
              : null
          }
        />
      </div>

      <div style={{ padding: '0 24px 18px' }}>
        <PromptInput
          sessionFolder={session.folder_path}
          wsOpen={wsConnected}
          running={running}
          onSend={send}
          onStop={stop}
          footerLeft={`${session.agent_kind} · ${currentModel}`}
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

/** Compact progress bar showing how much of the model's context window
 *  the current conversation is using. Drawn as a thin bar + a numeric
 *  label; color warms to amber then red as the session fills up so the
 *  user notices before they hit the wall. */
function ContextMeter({
  used,
  total,
}: {
  used: number
  total: number
}) {
  const pct = Math.min(100, Math.max(0, (used / total) * 100))
  const fillColor =
    pct >= 90 ? COLORS.red : pct >= 70 ? COLORS.amber : COLORS.blue
  const textColor =
    pct >= 90 ? COLORS.red : pct >= 70 ? COLORS.amber : COLORS.textMuted
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 10px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: 999,
        fontFamily: FONTS.mono,
        fontSize: 11,
        color: textColor,
      }}
      title={`Context used: ${used.toLocaleString()} / ${total.toLocaleString()} (${pct.toFixed(1)}%)`}
    >
      <span
        aria-hidden
        style={{
          width: 56,
          height: 4,
          borderRadius: 2,
          background: COLORS.bgElevated,
          overflow: 'hidden',
          display: 'inline-block',
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: fillColor,
            transition: 'width 240ms ease, background-color 240ms ease',
          }}
        />
      </span>
      <span>
        {formatTokens(used)}
        <span style={{ opacity: 0.45 }}> / {formatTokens(total)}</span>
      </span>
    </span>
  )
}
