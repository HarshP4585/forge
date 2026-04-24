import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTokens, type AgentKind } from '../api/rest'
import type { ServerEvent } from '../api/ws'
import Markdown from './Markdown'
import ToolCallCard from './ToolCallCard'
import { COLORS, FONTS, providerAccent } from '../theme'

interface ContextLimits {
  context_window: number | null
  max_output_tokens: number | null
}

interface AttachmentMeta {
  kind: 'image' | 'text'
  name: string
}

type RenderItem =
  | { kind: 'user'; seq: number; text: string; attachments?: AttachmentMeta[] }
  | { kind: 'assistant'; seq: number; message_id: string; text: string }
  | { kind: 'thinking'; seq: number; message_id: string; text: string }
  | {
      kind: 'tool'
      seq: number
      call_id: string
      tool: string
      input: unknown
      output: string | null
      is_error: boolean
      /** 'pending' once a tool.approve.request arrives; set to 'approved' or
       *  'denied' locally on click (optimistic) or when the backend
       *  emits a tool.call.result. 'unrequested' is the default — most
       *  tools don't need approval at all. */
      approval: 'unrequested' | 'pending' | 'approved' | 'denied'
    }
  | { kind: 'notice'; seq: number; level: string; text: string }
  | { kind: 'usage'; seq: number; input_tokens: number; output_tokens: number }
  | { kind: 'error'; seq: number; message: string }
  | {
      kind: 'plan'
      seq: number
      plan: string
      /** 'pending' while awaiting user decision; 'accepted' / 'rejected'
       *  reflect what the user chose. Computed from subsequent
       *  plan.accepted / plan.rejected events in the stream. */
      status: 'pending' | 'accepted' | 'rejected'
      feedback?: string
    }

function reduce(events: ServerEvent[]): RenderItem[] {
  const items: RenderItem[] = []
  const assistantIdx = new Map<string, number>()
  const thinkingIdx = new Map<string, number>()
  const toolIdx = new Map<string, number>()

  for (const e of events) {
    const t = e.type as string
    const seq = e.seq
    if (t === 'message.user') {
      items.push({
        kind: 'user',
        seq,
        text: String(e.text ?? ''),
        attachments: Array.isArray(e.attachments)
          ? (e.attachments as AttachmentMeta[])
          : undefined,
      })
    } else if (t === 'assistant.delta' || t === 'assistant.complete') {
      const mid = String(e.message_id ?? '')
      const idx = assistantIdx.get(mid)
      if (idx === undefined) {
        items.push({ kind: 'assistant', seq, message_id: mid, text: String(e.text ?? '') })
        assistantIdx.set(mid, items.length - 1)
      } else {
        const prev = items[idx] as Extract<RenderItem, { kind: 'assistant' }>
        const text =
          t === 'assistant.complete'
            ? String(e.text ?? '')
            : prev.text + String(e.text ?? '')
        items[idx] = { ...prev, text }
      }
    } else if (
      t === 'assistant.thinking.delta' ||
      t === 'assistant.thinking.complete'
    ) {
      const mid = String(e.message_id ?? '')
      const idx = thinkingIdx.get(mid)
      if (idx === undefined) {
        items.push({ kind: 'thinking', seq, message_id: mid, text: String(e.text ?? '') })
        thinkingIdx.set(mid, items.length - 1)
      } else {
        const prev = items[idx] as Extract<RenderItem, { kind: 'thinking' }>
        const text =
          t === 'assistant.thinking.complete'
            ? String(e.text ?? '')
            : prev.text + String(e.text ?? '')
        items[idx] = { ...prev, text }
      }
    } else if (t === 'tool.call.start') {
      const cid = String(e.call_id ?? '')
      items.push({
        kind: 'tool',
        seq,
        call_id: cid,
        tool: String(e.tool ?? 'unknown'),
        input: e.input,
        output: null,
        is_error: false,
        approval: 'unrequested',
      })
      toolIdx.set(cid, items.length - 1)
    } else if (t === 'tool.approve.request') {
      const cid = String(e.call_id ?? '')
      const idx = toolIdx.get(cid)
      if (idx !== undefined) {
        const prev = items[idx] as Extract<RenderItem, { kind: 'tool' }>
        items[idx] = { ...prev, approval: 'pending' }
      }
    } else if (t === 'tool.call.result') {
      const cid = String(e.call_id ?? '')
      const idx = toolIdx.get(cid)
      if (idx !== undefined) {
        const prev = items[idx] as Extract<RenderItem, { kind: 'tool' }>
        // If the tool ran (no error tagged as "denied…"), the pending
        // gate must have been approved. If it errored because the user
        // denied it, the agent feeds back an is_error=true tool_result
        // that includes "User denied" in the text — surface that state
        // so the UI can style the card accordingly.
        const outputStr = String(e.output ?? '')
        const isError = Boolean(e.is_error)
        const wasDenied = isError && outputStr.startsWith('User denied')
        const nextApproval: typeof prev.approval =
          prev.approval === 'pending'
            ? wasDenied ? 'denied' : 'approved'
            : prev.approval
        items[idx] = {
          ...prev,
          output: outputStr,
          is_error: isError,
          approval: nextApproval,
        }
      }
    } else if (t === 'system.notice') {
      items.push({
        kind: 'notice',
        seq,
        level: String(e.level ?? 'info'),
        text: String(e.text ?? ''),
      })
    } else if (t === 'usage') {
      items.push({
        kind: 'usage',
        seq,
        input_tokens: Number(e.input_tokens ?? 0),
        output_tokens: Number(e.output_tokens ?? 0),
      })
    } else if (t === 'error') {
      items.push({ kind: 'error', seq, message: String(e.message ?? '') })
    } else if (t === 'plan.proposal') {
      items.push({
        kind: 'plan',
        seq,
        plan: String(e.plan ?? ''),
        status: 'pending',
      })
    } else if (t === 'plan.accepted' || t === 'plan.rejected') {
      // Walk backward to the most recent pending plan and resolve it.
      for (let j = items.length - 1; j >= 0; j--) {
        const it = items[j]
        if (it.kind === 'plan' && it.status === 'pending') {
          items[j] = {
            ...it,
            status: t === 'plan.accepted' ? 'accepted' : 'rejected',
            feedback:
              t === 'plan.rejected' ? String(e.feedback ?? '') : undefined,
          }
          break
        }
      }
    }
  }
  return items
}

export default function MessageList({
  events,
  agentKind,
  contextLimits,
  onToolApproval,
  onPlanDecision,
}: {
  events: ServerEvent[]
  agentKind: AgentKind
  contextLimits?: ContextLimits | null
  onToolApproval?: (
    callId: string,
    approved: boolean,
    remember: boolean,
  ) => void
  onPlanDecision?: (approved: boolean, feedback?: string) => void
}) {
  const items = useMemo(() => reduce(events), [events])
  const bottomRef = useRef<HTMLDivElement>(null)
  const accent = providerAccent(agentKind)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items.length, items[items.length - 1]])

  if (items.length === 0) {
    return (
      <div
        style={{
          maxWidth: 720,
          margin: '60px auto 0',
          textAlign: 'center',
          color: COLORS.textMuted,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 20px',
            borderRadius: 14,
            background: `linear-gradient(135deg, ${COLORS.blue}, ${COLORS.purple})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            color: '#fff',
          }}
        >
          ✨
        </div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 600,
            margin: '0 0 8px',
            color: COLORS.text,
            letterSpacing: -0.01,
          }}
        >
          What can I help you with?
        </h2>
        <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          Ask a question, describe a bug, or request a change. The agent has
          read/write access to files in this folder and can run shell commands.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 0 20px' }}>
      {items.map((it, i) => (
        <div key={i}>
          {renderItem(
            it,
            accent,
            contextLimits ?? null,
            onToolApproval,
            onPlanDecision,
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

function renderItem(
  it: RenderItem,
  accent: string,
  limits: ContextLimits | null,
  onToolApproval?: (
    callId: string,
    approved: boolean,
    remember: boolean,
  ) => void,
  onPlanDecision?: (approved: boolean, feedback?: string) => void,
) {
  switch (it.kind) {
    case 'user':
      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            margin: '16px 0',
          }}
        >
          <div
            style={{
              maxWidth: '75%',
              background: COLORS.userBubble,
              color: COLORS.userBubbleText,
              padding: '10px 14px',
              borderRadius: 12,
              fontSize: 14,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}
          >
            {it.attachments && it.attachments.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginBottom: it.text ? 8 : 0,
                }}
              >
                {it.attachments.map((a, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      background: 'rgba(255,255,255,0.12)',
                      borderRadius: 999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {a.kind === 'image' ? '🖼' : '📄'} {a.name}
                  </span>
                ))}
              </div>
            )}
            {it.text}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div
          style={{
            margin: '20px 0',
            padding: '2px 0 2px 14px',
            borderLeft: `2px solid ${accent}`,
          }}
        >
          <Markdown>{it.text}</Markdown>
        </div>
      )
    case 'thinking':
      return (
        <div
          style={{
            margin: '8px 0',
            padding: '8px 12px',
            borderLeft: `2px solid ${COLORS.purple}`,
            background: 'rgba(167,139,250,0.06)',
            color: COLORS.textMuted,
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: COLORS.purple,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 4,
              fontStyle: 'normal',
            }}
          >
            Thinking
          </div>
          <Markdown style={{ fontSize: 13, color: COLORS.textMuted }}>
            {it.text}
          </Markdown>
        </div>
      )
    case 'tool':
      return (
        <ToolCallCard
          tool={it.tool}
          input={it.input}
          output={it.output}
          isError={it.is_error}
          approval={it.approval}
          onApprove={
            onToolApproval
              ? (remember) => onToolApproval(it.call_id, true, remember)
              : undefined
          }
          onDeny={
            onToolApproval
              ? () => onToolApproval(it.call_id, false, false)
              : undefined
          }
        />
      )
    case 'notice':
      return (
        <div
          style={{
            fontSize: 12,
            color:
              it.level === 'error'
                ? COLORS.red
                : it.level === 'warn'
                  ? COLORS.amber
                  : COLORS.textDim,
            padding: '4px 0',
          }}
        >
          · {it.text}
        </div>
      )
    case 'usage': {
      const ctx = limits?.context_window ?? null
      const maxOut = limits?.max_output_tokens ?? null
      // Fill percentage drives a gentle color shift — stays muted for
      // most turns, warms into amber/red when approaching the cap.
      const pct =
        ctx && ctx > 0
          ? Math.min(100, Math.round((it.input_tokens / ctx) * 100))
          : null
      const pctColor =
        pct == null
          ? COLORS.textDim
          : pct >= 90
            ? COLORS.red
            : pct >= 70
              ? COLORS.amber
              : COLORS.textDim
      return (
        <div
          style={{
            fontSize: 11,
            color: COLORS.textDim,
            padding: '2px 0 10px 14px',
            fontFamily: FONTS.mono,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            opacity: 0.85,
          }}
          title={
            ctx
              ? `Input: ${it.input_tokens.toLocaleString()} / ${ctx.toLocaleString()} context · Output: ${it.output_tokens.toLocaleString()}${
                  maxOut ? ` / ${maxOut.toLocaleString()}` : ''
                }`
              : 'Tokens consumed on this turn'
          }
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 15 14" />
          </svg>
          <span>
            in {it.input_tokens.toLocaleString()}
            {ctx ? (
              <>
                <span style={{ opacity: 0.5 }}> / </span>
                {formatTokens(ctx)}
              </>
            ) : null}
          </span>
          {pct != null && (
            <span style={{ color: pctColor, fontWeight: 600 }}>
              ({pct}%)
            </span>
          )}
          <span style={{ opacity: 0.5 }}>·</span>
          <span>
            out {it.output_tokens.toLocaleString()}
            {maxOut ? (
              <>
                <span style={{ opacity: 0.5 }}> / </span>
                {formatTokens(maxOut)}
              </>
            ) : null}
          </span>
        </div>
      )
    }
    case 'error':
      return (
        <div
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: `1px solid rgba(239,68,68,0.3)`,
            color: '#fca5a5',
            padding: 10,
            borderRadius: 6,
            margin: '6px 0',
            fontSize: 13,
          }}
        >
          Error: {it.message}
        </div>
      )
    case 'plan':
      return (
        <PlanCard
          plan={it.plan}
          status={it.status}
          feedback={it.feedback}
          onDecision={onPlanDecision}
          accent={accent}
        />
      )
  }
}

function PlanCard({
  plan,
  status,
  feedback,
  onDecision,
  accent,
}: {
  plan: string
  status: 'pending' | 'accepted' | 'rejected'
  feedback?: string
  onDecision?: (approved: boolean, feedback?: string) => void
  accent: string
}) {
  const [showRevise, setShowRevise] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const pending = status === 'pending'
  const badge =
    status === 'accepted'
      ? { text: 'Accepted', color: COLORS.green }
      : status === 'rejected'
        ? { text: 'Rejected', color: COLORS.red }
        : { text: 'Awaiting decision', color: COLORS.amber }
  return (
    <div
      style={{
        position: 'relative',
        margin: '14px 0',
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Left rail in the provider accent, like assistant messages. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: accent,
          opacity: pending ? 0.9 : 0.4,
        }}
      />
      <div
        style={{
          padding: '12px 16px 6px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: `1px solid ${COLORS.borderSubtle}`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: accent,
          }}
        >
          Proposed plan
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: badge.color,
            padding: '2px 10px',
            background: `${badge.color}12`,
            border: `1px solid ${badge.color}66`,
            borderRadius: 999,
          }}
        >
          {badge.text}
        </span>
      </div>
      <div style={{ padding: '10px 18px 12px' }}>
        <Markdown>{plan}</Markdown>
      </div>
      {status === 'rejected' && feedback && (
        <div
          style={{
            padding: '8px 18px 12px',
            color: COLORS.textMuted,
            fontSize: 12,
            borderTop: `1px solid ${COLORS.borderSubtle}`,
          }}
        >
          <span style={{ color: COLORS.textDim, fontWeight: 600 }}>
            Your feedback:
          </span>{' '}
          {feedback}
        </div>
      )}
      {pending && onDecision && (
        <div
          style={{
            padding: '10px 16px 14px',
            borderTop: `1px solid ${COLORS.borderSubtle}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {showRevise ? (
            <>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What should the plan change? (optional)"
                rows={3}
                style={{
                  width: '100%',
                  fontFamily: FONTS.body,
                  fontSize: 13,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${COLORS.border}`,
                  background: COLORS.bgInput,
                  color: COLORS.text,
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowRevise(false)}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(false, feedbackText.trim() || undefined)}
                  style={denyBtnStyle}
                >
                  Send feedback
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowRevise(true)}
                style={secondaryBtnStyle}
              >
                Revise…
              </button>
              <button
                type="button"
                onClick={() => onDecision(false)}
                style={denyBtnStyle}
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => onDecision(true)}
                style={{
                  ...acceptBtnStyle,
                  background: `${accent}22`,
                  color: accent,
                  border: `1px solid ${accent}66`,
                }}
              >
                Accept plan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const acceptBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '7px 16px',
  borderRadius: 999,
  cursor: 'pointer',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  padding: '7px 14px',
  borderRadius: 999,
  border: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: COLORS.textMuted,
  cursor: 'pointer',
}

const denyBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '7px 14px',
  borderRadius: 999,
  border: `1px solid ${COLORS.red}66`,
  background: 'transparent',
  color: COLORS.red,
  cursor: 'pointer',
}
