import { COLORS } from '../theme'

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div style={backdrop} onClick={onCancel}>
      <div
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>{title}</h3>
        <p
          style={{
            color: COLORS.textMuted,
            fontSize: 13,
            margin: '0 0 20px',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              background: destructive ? COLORS.red : COLORS.blue,
              color: '#fff',
              border: 'none',
              fontWeight: 500,
            }}
          >
            {busy ? '…' : confirmLabel}
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
  zIndex: 30,
}

const modal: React.CSSProperties = {
  background: COLORS.bgSidebar,
  padding: 20,
  borderRadius: 10,
  width: 420,
  maxWidth: '92vw',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
  border: `1px solid ${COLORS.border}`,
  color: COLORS.text,
}
