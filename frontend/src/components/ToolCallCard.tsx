import { useState } from 'react'
import { COLORS, FONTS } from '../theme'

export type ApprovalState =
  | 'unrequested'
  | 'pending'
  | 'approved'
  | 'denied'

export default function ToolCallCard({
  tool,
  input,
  output,
  isError,
  approval = 'unrequested',
  onApprove,
  onDeny,
}: {
  tool: string
  input: unknown
  output: string | null
  isError: boolean
  approval?: ApprovalState
  onApprove?: (remember: boolean) => void
  onDeny?: () => void
}) {
  // Auto-expand while waiting for user so the input is fully visible —
  // otherwise people click Approve without seeing what they're approving.
  const [expanded, setExpanded] = useState(approval === 'pending')
  const running = output === null
  const accent = isError
    ? COLORS.red
    : approval === 'pending'
      ? COLORS.amber
      : running
        ? COLORS.blue
        : COLORS.green

  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        margin: '10px 0',
        background: COLORS.bgCard,
        fontSize: 13,
        overflow: 'hidden',
      }}
    >
      {/* Thin colored rail on the left signals status at a glance. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: accent,
          opacity: isError ? 0.9 : running ? 0.6 : 0.35,
        }}
      />
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          padding: '8px 12px 8px 14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: COLORS.text,
        }}
      >
        <span style={{ color: COLORS.textDim, fontSize: 10, lineHeight: 1 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <code
          style={{
            fontFamily: FONTS.mono,
            fontWeight: 600,
            color: COLORS.text,
            background: 'transparent',
            padding: 0,
            fontSize: 12.5,
          }}
        >
          {tool}
        </code>
        <StatusBadge
          running={running}
          isError={isError}
          approval={approval}
        />
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 10px 14px' }}>
          <EditDiffOrInput tool={tool} input={input} />
          {approval === 'pending' && (onApprove || onDeny) && (
            <ApprovalBar onApprove={onApprove} onDeny={onDeny} />
          )}
          {output !== null && (
            <Section label="output">
              <pre
                style={{
                  ...preStyle,
                  color: isError ? '#fca5a5' : COLORS.codeText,
                  borderColor: isError
                    ? 'rgba(239,68,68,0.3)'
                    : COLORS.border,
                }}
              >
                {output}
              </pre>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function ApprovalBar({
  onApprove,
  onDeny,
}: {
  onApprove?: (remember: boolean) => void
  onDeny?: () => void
}) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        border: `1px solid ${COLORS.amber}66`,
        background: `${COLORS.amber}12`,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: COLORS.text,
          marginRight: 'auto',
          lineHeight: 1.4,
        }}
      >
        This tool can modify files, run commands, or reach the network. Approve?
      </span>
      <button
        type="button"
        onClick={() => onApprove?.(false)}
        style={approveBtn}
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => onApprove?.(true)}
        style={approveRememberBtn}
        title="Skip approval for this tool for the rest of this session"
      >
        Approve & remember
      </button>
      <button type="button" onClick={() => onDeny?.()} style={denyBtn}>
        Deny
      </button>
    </div>
  )
}

const approveBtn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 999,
  border: `1px solid ${COLORS.green}66`,
  background: `${COLORS.green}22`,
  color: COLORS.green,
  cursor: 'pointer',
}

const approveRememberBtn: React.CSSProperties = {
  ...approveBtn,
  background: 'transparent',
  color: COLORS.textMuted,
  borderColor: COLORS.border,
}

const denyBtn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 999,
  border: `1px solid ${COLORS.red}66`,
  background: 'transparent',
  color: COLORS.red,
  cursor: 'pointer',
}

function StatusBadge({
  running,
  isError,
  approval,
}: {
  running: boolean
  isError: boolean
  approval: ApprovalState
}) {
  if (approval === 'pending') {
    return (
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: COLORS.amber,
          padding: '2px 10px',
          background: `${COLORS.amber}12`,
          border: `1px solid ${COLORS.amber}66`,
          borderRadius: 999,
        }}
      >
        awaiting approval
      </span>
    )
  }
  if (approval === 'denied') {
    return (
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: COLORS.red,
          padding: '2px 8px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 999,
        }}
      >
        denied
      </span>
    )
  }
  if (isError) {
    return (
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: COLORS.red,
          padding: '2px 8px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 999,
        }}
      >
        error
      </span>
    )
  }
  if (running) {
    return (
      <span
        className="forge-running-badge"
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: COLORS.blue,
          padding: '2px 10px',
          borderRadius: 999,
          border: '1px solid rgba(92,156,246,0.3)',
        }}
      >
        running
      </span>
    )
  }
  return (
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        color: COLORS.textDim,
      }}
    >
      done
    </span>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          color: COLORS.textDim,
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

const preStyle: React.CSSProperties = {
  background: COLORS.bgInput,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: 10,
  margin: 0,
  fontSize: 12,
  fontFamily: FONTS.mono,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 300,
  overflow: 'auto',
  color: COLORS.codeText,
  lineHeight: 1.5,
}

// ─── Diff preview ────────────────────────────────────────────────────
// For edit-like tools, render a per-hunk +/- diff view instead of a raw
// JSON dump of the input. Keeps the approval decision grounded in what's
// actually changing, not a wall of escaped strings.

type EditInput = {
  file_path?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  edits?: Array<{
    old_string?: string
    new_string?: string
    replace_all?: boolean
  }>
  content?: string
}

function EditDiffOrInput({ tool, input }: { tool: string; input: unknown }) {
  const typed = (input || {}) as EditInput
  if (tool === 'Edit' && typed.old_string != null && typed.new_string != null) {
    return (
      <>
        <FilePathHeader path={typed.file_path} />
        <DiffHunk
          oldText={String(typed.old_string)}
          newText={String(typed.new_string)}
          replaceAll={!!typed.replace_all}
        />
      </>
    )
  }
  if (tool === 'MultiEdit' && Array.isArray(typed.edits)) {
    return (
      <>
        <FilePathHeader path={typed.file_path} />
        {typed.edits.map((e, i) => (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 10 }}>
            <div
              style={{
                color: COLORS.textDim,
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              edit {i + 1}
              {e.replace_all ? ' (replace all)' : ''}
            </div>
            <DiffHunk
              oldText={String(e.old_string ?? '')}
              newText={String(e.new_string ?? '')}
              replaceAll={!!e.replace_all}
            />
          </div>
        ))}
      </>
    )
  }
  if (tool === 'Write' && typeof typed.content === 'string') {
    return (
      <>
        <FilePathHeader path={typed.file_path} />
        <Section label="new contents">
          <pre style={preStyle}>{typed.content}</pre>
        </Section>
      </>
    )
  }
  // Fallback for any other tool / shape — raw JSON as before.
  return (
    <Section label="input">
      <pre style={preStyle}>{JSON.stringify(input, null, 2)}</pre>
    </Section>
  )
}

function FilePathHeader({ path }: { path?: string }) {
  if (!path) return null
  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 11.5,
        color: COLORS.textMuted,
        padding: '4px 8px',
        background: COLORS.bgInput,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 6,
        marginBottom: 8,
        wordBreak: 'break-all',
      }}
    >
      {path}
    </div>
  )
}

/**
 * Minimal old/new line diff. We don't have full-file context (the model
 * only sends old_string / new_string) so this renders the two chunks
 * line-by-line with +/- prefixes, not a true LCS diff. That's enough
 * for a human to decide whether to approve.
 */
function DiffHunk({
  oldText,
  newText,
  replaceAll,
}: {
  oldText: string
  newText: string
  replaceAll: boolean
}) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontFamily: FONTS.mono,
        fontSize: 12,
        lineHeight: 1.5,
        maxHeight: 300,
        overflowY: 'auto',
        background: COLORS.bgInput,
      }}
    >
      {replaceAll && (
        <div
          style={{
            fontSize: 10.5,
            padding: '4px 10px',
            background: 'rgba(92,156,246,0.08)',
            borderBottom: `1px solid ${COLORS.border}`,
            color: COLORS.blue,
            letterSpacing: 0.3,
          }}
        >
          replace_all — every occurrence in the file
        </div>
      )}
      {oldLines.map((line, i) => (
        <DiffLine key={`o${i}`} sign="-" text={line} />
      ))}
      {newLines.map((line, i) => (
        <DiffLine key={`n${i}`} sign="+" text={line} />
      ))}
    </div>
  )
}

function DiffLine({ sign, text }: { sign: '+' | '-'; text: string }) {
  const bg = sign === '+' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'
  const fg = sign === '+' ? '#86efac' : '#fca5a5'
  return (
    <div
      style={{
        display: 'flex',
        background: bg,
        padding: '0 10px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <span style={{ color: fg, width: 14, flexShrink: 0, userSelect: 'none' }}>
        {sign}
      </span>
      <span style={{ color: COLORS.codeText }}>{text || ' '}</span>
    </div>
  )
}
