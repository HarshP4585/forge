import { useState } from 'react'
import { COLORS } from '../theme'

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
  const statusColor = isError
    ? COLORS.red
    : running
      ? COLORS.blue
      : COLORS.textDim
  const statusLabel = isError ? 'error' : running ? 'running…' : 'done'

  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        margin: '10px 0',
        background: COLORS.bgCard,
        fontSize: 13,
      }}
    >
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: COLORS.text,
        }}
      >
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <code style={{ fontWeight: 600, color: COLORS.text }}>{tool}</code>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: statusColor,
          }}
        >
          {statusLabel}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 10px' }}>
          <Section label="input">
            <pre style={preStyle}>{JSON.stringify(input, null, 2)}</pre>
          </Section>
          {output !== null && (
            <Section label="output">
              <pre
                style={{
                  ...preStyle,
                  color: isError ? '#fca5a5' : COLORS.codeText,
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          color: COLORS.textDim,
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 4,
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
  padding: 8,
  margin: 0,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 300,
  overflow: 'auto',
  color: COLORS.codeText,
}
