import { useState } from 'react'
import { COLORS } from '../theme'

export interface AskOption {
  label: string
  description: string
}

export interface AskQuestion {
  question: string
  header: string
  options: AskOption[]
  multiSelect?: boolean
}

export default function QuestionModal({
  questions,
  onSubmit,
  onCancel,
}: {
  questions: AskQuestion[]
  onSubmit: (answers: Record<string, string | string[]>) => void
  onCancel: () => void
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})

  const setSingle = (header: string, label: string) =>
    setAnswers((a) => ({ ...a, [header]: label }))

  const toggleMulti = (header: string, label: string) =>
    setAnswers((a) => {
      const prev = Array.isArray(a[header]) ? (a[header] as string[]) : []
      const next = prev.includes(label)
        ? prev.filter((x) => x !== label)
        : [...prev, label]
      return { ...a, [header]: next }
    })

  const handleSubmit = () => {
    // Swap "Other" sentinel for the typed text where applicable.
    const out: Record<string, string | string[]> = {}
    for (const q of questions) {
      const v = answers[q.header]
      if (Array.isArray(v)) {
        out[q.header] = v.map((x) =>
          x === 'Other' && otherText[q.header] ? otherText[q.header] : x,
        )
      } else if (v === 'Other' && otherText[q.header]) {
        out[q.header] = otherText[q.header]
      } else if (v !== undefined) {
        out[q.header] = v
      }
    }
    onSubmit(out)
  }

  const allAnswered = questions.every((q) => {
    const v = answers[q.header]
    if (Array.isArray(v)) return v.length > 0
    return Boolean(v)
  })

  return (
    <div style={backdrop}>
      <div style={modal}>
        <h3 style={{ marginTop: 0 }}>Agent is asking</h3>
        {questions.map((q) => {
          const current = answers[q.header]
          const selectedOther =
            Array.isArray(current)
              ? current.includes('Other')
              : current === 'Other'
          return (
            <div key={q.header} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: COLORS.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 4,
                }}
              >
                {q.header}
              </div>
              <div style={{ fontSize: 14, marginBottom: 10 }}>{q.question}</div>
              {q.options.map((opt) => {
                const active = Array.isArray(current)
                  ? current.includes(opt.label)
                  : current === opt.label
                return (
                  <div
                    key={opt.label}
                    onClick={() =>
                      q.multiSelect
                        ? toggleMulti(q.header, opt.label)
                        : setSingle(q.header, opt.label)
                    }
                    style={optionRow(active)}
                  >
                    <span style={{ marginRight: 10 }}>
                      {q.multiSelect ? (active ? '☑' : '☐') : active ? '●' : '○'}
                    </span>
                    <div>
                      <div style={{ fontSize: 14 }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: COLORS.textMuted }}>
                        {opt.description}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div
                onClick={() =>
                  q.multiSelect
                    ? toggleMulti(q.header, 'Other')
                    : setSingle(q.header, 'Other')
                }
                style={optionRow(selectedOther)}
              >
                <span style={{ marginRight: 10 }}>
                  {q.multiSelect
                    ? selectedOther
                      ? '☑'
                      : '☐'
                    : selectedOther
                      ? '●'
                      : '○'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>Other</div>
                  {selectedOther && (
                    <input
                      autoFocus
                      placeholder="Type your answer…"
                      value={otherText[q.header] ?? ''}
                      onChange={(e) =>
                        setOtherText({ ...otherText, [q.header]: e.target.value })
                      }
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: '100%', marginTop: 6 }}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        })}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 12,
          }}
        >
          <button onClick={onCancel}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            style={{
              background: allAnswered ? COLORS.blue : COLORS.bgCard,
              color: allAnswered ? '#fff' : COLORS.textDim,
              border: 'none',
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20,
}

const modal: React.CSSProperties = {
  background: COLORS.bgSidebar,
  padding: 24,
  borderRadius: 10,
  width: 560,
  maxWidth: '92vw',
  maxHeight: '85vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
  border: `1px solid ${COLORS.border}`,
  color: COLORS.text,
}

const optionRow = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  padding: '10px 12px',
  borderRadius: 6,
  marginBottom: 6,
  cursor: 'pointer',
  background: active ? 'rgba(74,143,245,0.08)' : COLORS.bgCard,
  border: `1px solid ${active ? COLORS.blue : COLORS.border}`,
})
