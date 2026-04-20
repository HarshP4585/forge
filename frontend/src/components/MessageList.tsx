import { useEffect, useMemo, useRef } from 'react'
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
    }
  | { kind: 'notice'; seq: number; level: string; text: string }
  | { kind: 'usage'; seq: number; input_tokens: number; output_tokens: number }
  | { kind: 'error'; seq: number; message: string }

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
      })
      toolIdx.set(cid, items.length - 1)
    } else if (t === 'tool.call.result') {
      const cid = String(e.call_id ?? '')
      const idx = toolIdx.get(cid)
      if (idx !== undefined) {
        const prev = items[idx] as Extract<RenderItem, { kind: 'tool' }>
        items[idx] = {
          ...prev,
          output: String(e.output ?? ''),
          is_error: Boolean(e.is_error),
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
    }
  }
  return items
}

export default function MessageList({
  events,
  agentKind,
  contextLimits,
}: {
  events: ServerEvent[]
  agentKind: AgentKind
  contextLimits?: ContextLimits | null
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
        <div key={i}>{renderItem(it, accent, contextLimits ?? null)}</div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

function renderItem(
  it: RenderItem,
  accent: string,
  limits: ContextLimits | null,
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
  }
}
