import { useState } from 'react'
import { COLORS, FONTS } from '../theme'

export default function ToolCallCard({
  tool,
  input,
  output,
  isError,
}: {
  tool: string
  input: unknown
  output: string | null
  isError: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const running = output === null
  const accent = isError ? COLORS.red : running ? COLORS.blue : COLORS.green

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
        <StatusBadge running={running} isError={isError} />
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 10px 14px' }}>
          <Section label="input">
            <pre style={preStyle}>{JSON.stringify(input, null, 2)}</pre>
          </Section>
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

function StatusBadge({
  running,
  isError,
}: {
  running: boolean
  isError: boolean
}) {
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
