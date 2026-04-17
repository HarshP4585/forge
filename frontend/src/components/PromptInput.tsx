import { useRef, useState } from 'react'
import MentionPicker, { type MentionPickerHandle } from './MentionPicker'
import { COLORS } from '../theme'

export type Attachment =
  | {
      kind: 'image'
      name: string
      mime: string
      size: number
      base64: string
      dataUrl: string
    }
  | { kind: 'text'; name: string; size: number; text: string }

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const TEXT_EXT_RE = /\.(md|txt|json|ya?ml|log|csv|tsv|ini|toml|env|dockerfile|py|js|ts|tsx|jsx|html|css|scss|less|java|go|rs|rb|php|swift|kt|c|h|cc|cpp|hpp|sh|bash|zsh|sql|r)$/i

function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || TEXT_EXT_RE.test(file.name)
}

function readAsBase64(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1] || ''
      resolve({ base64, dataUrl })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function fileToAttachment(file: File): Promise<Attachment | string> {
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 5MB)`
  }
  if (file.type.startsWith('image/')) {
    const { base64, dataUrl } = await readAsBase64(file)
    return {
      kind: 'image',
      name: file.name,
      mime: file.type,
      size: file.size,
      base64,
      dataUrl,
    }
  }
  if (isTextFile(file)) {
    const text = await file.text()
    return { kind: 'text', name: file.name, size: file.size, text }
  }
  return `${file.name} — unsupported file type (images + text files only)`
}

/**
 * Walk back from ``cursor`` to find an active @-mention. A mention is "active"
 * when there is an ``@`` somewhere before the cursor with no whitespace
 * between it and the cursor, and the char before the ``@`` is whitespace or
 * start-of-string (so "email@example.com" doesn't trigger).
 */
function detectMention(value: string, cursor: number):
  | { start: number; query: string }
  | null {
  const before = value.slice(0, cursor)
  const atIdx = before.lastIndexOf('@')
  if (atIdx < 0) return null
  const after = before.slice(atIdx + 1)
  if (/\s/.test(after)) return null
  if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null
  return { start: atIdx, query: after }
}

export default function PromptInput({
  sessionFolder,
  wsOpen,
  running,
  onSend,
  onStop,
  footerLeft,
  footerRight,
}: {
  sessionFolder: string
  /** True only when the WebSocket is in the "open" state. When false, the
   *  user can still type — only Send is gated, with a tooltip. */
  wsOpen: boolean
  running: boolean
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  footerLeft?: string
  footerRight?: string
}) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(
    null,
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mentionPickerRef = useRef<MentionPickerHandle>(null)

  const addFiles = async (files: FileList | File[]) => {
    setAttachError(null)
    const current = attachments.length
    const incoming = Array.from(files).slice(0, MAX_ATTACHMENTS - current)
    if (current + Array.from(files).length > MAX_ATTACHMENTS) {
      setAttachError(`Max ${MAX_ATTACHMENTS} attachments per message.`)
    }
    const accepted: Attachment[] = []
    const errors: string[] = []
    for (const f of incoming) {
      const r = await fileToAttachment(f)
      if (typeof r === 'string') errors.push(r)
      else accepted.push(r)
    }
    if (accepted.length) setAttachments((a) => [...a, ...accepted])
    if (errors.length) setAttachError(errors.join('\n'))
  }

  const removeAt = (i: number) =>
    setAttachments((a) => a.filter((_, idx) => idx !== i))

  const updateMentionFromCursor = () => {
    const el = textareaRef.current
    if (!el) return
    const detected = detectMention(el.value, el.selectionStart ?? 0)
    setMention(detected)
  }

  const applyMention = (path: string) => {
    if (!mention) return
    const el = textareaRef.current
    if (!el) return
    const before = value.slice(0, mention.start)
    const after = value.slice(mention.start + 1 + mention.query.length)
    const inserted = `@${path} `
    const newValue = `${before}${inserted}${after}`
    setValue(newValue)
    setMention(null)
    // Restore focus and put the cursor right after the inserted mention.
    requestAnimationFrame(() => {
      el.focus()
      const pos = before.length + inserted.length
      el.setSelectionRange(pos, pos)
    })
  }

  const send = () => {
    if (!wsOpen || running) return
    const t = value.trim()
    if (!t && attachments.length === 0) return
    onSend(t, attachments)
    setValue('')
    setAttachments([])
    setAttachError(null)
    setMention(null)
  }

  const hasContent = value.trim().length > 0 || attachments.length > 0
  const canSend = wsOpen && !running && hasContent

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div
        style={{
          position: 'relative',
          background: COLORS.bgCard,
          border: `1px solid ${dragging ? COLORS.blue : focused ? COLORS.blue : COLORS.border}`,
          borderRadius: 12,
          padding: '12px 14px',
          boxShadow:
            focused || dragging
              ? `0 0 0 3px rgba(92,156,246,0.12), ${COLORS.shadowCard}`
              : COLORS.shadowCard,
          transition: 'border-color 120ms ease, box-shadow 120ms ease',
        }}
        onClick={() => textareaRef.current?.focus()}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files?.length) {
            void addFiles(e.dataTransfer.files)
          }
        }}
      >
        {mention && (
          <MentionPicker
            ref={mentionPickerRef}
            sessionFolder={sessionFolder}
            query={mention.query}
            onSelect={applyMention}
            onDismiss={() => setMention(null)}
          />
        )}

        {attachments.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 10,
            }}
          >
            {attachments.map((a, i) => (
              <AttachmentChip
                key={i}
                attachment={a}
                onRemove={() => removeAt(i)}
              />
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            updateMentionFromCursor()
          }}
          onKeyUp={updateMentionFromCursor}
          onClick={updateMentionFromCursor}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            // Delay dismissal so picker clicks can still land.
            setTimeout(() => setMention(null), 150)
          }}
          onKeyDown={(e) => {
            // Route navigation keys to the picker when it's open.
            if (mention && mentionPickerRef.current?.onKeyDown(e)) {
              e.preventDefault()
              return
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={
            running
              ? 'Agent is working…'
              : 'Message the agent…  (⌘/Ctrl+Enter to send, @ to mention a file, drop files to attach)'
          }
          // Only block typing while the agent is running. WS disconnect
          // doesn't disable the textarea — user can compose during reconnect.
          disabled={running}
          rows={3}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: COLORS.text,
            fontFamily: 'inherit',
            fontSize: 14,
            resize: 'none',
            padding: 2,
            lineHeight: 1.5,
          }}
        />

        {attachError && (
          <p
            style={{
              color: COLORS.amber,
              fontSize: 12,
              margin: '4px 0 0',
              whiteSpace: 'pre-wrap',
            }}
          >
            {attachError}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            paddingTop: 8,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              fileInputRef.current?.click()
            }}
            title="Attach files (images or text)"
            style={{
              border: 'none',
              background: 'transparent',
              color: COLORS.textMuted,
              padding: 6,
              width: 30,
              height: 30,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              lineHeight: 1,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.bgElevated
              e.currentTarget.style.color = COLORS.text
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = COLORS.textMuted
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {footerLeft && (
            <span
              style={{
                fontSize: 11,
                color: COLORS.textDim,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {footerLeft}
            </span>
          )}
          <span
            style={{ marginLeft: 'auto', fontSize: 11, color: COLORS.textDim }}
          >
            {footerRight}
          </span>
          {running ? (
            <button
              onClick={onStop}
              style={{
                background: COLORS.red,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontWeight: 500,
              }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!canSend}
              title={!wsOpen ? 'Not connected — waiting to reconnect' : undefined}
              style={{
                background: canSend ? COLORS.blue : COLORS.bgElevated,
                color: canSend ? '#fff' : COLORS.textDim,
                border: 'none',
                borderRadius: 8,
                padding: '6px 18px',
                fontWeight: 500,
              }}
            >
              {!wsOpen && hasContent ? 'Waiting…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove: () => void
}) {
  const sizeKb = Math.round(attachment.size / 1024)
  if (attachment.kind === 'image') {
    return (
      <div
        style={{
          position: 'relative',
          width: 64,
          height: 64,
          borderRadius: 8,
          overflow: 'hidden',
          background: COLORS.bgElevated,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          title={`${attachment.name} (${sizeKb} KB)`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <RemoveBadge onClick={onRemove} />
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px 6px 10px',
        background: COLORS.bgElevated,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        fontSize: 12,
        color: COLORS.text,
      }}
    >
      <span style={{ fontSize: 14 }}>📄</span>
      <span
        style={{
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {attachment.name}
      </span>
      <span style={{ color: COLORS.textDim, fontSize: 11 }}>{sizeKb}KB</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        style={{
          border: 'none',
          background: 'transparent',
          color: COLORS.textDim,
          padding: '0 2px',
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}

function RemoveBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        position: 'absolute',
        top: 2,
        right: 2,
        width: 18,
        height: 18,
        padding: 0,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.65)',
        color: '#fff',
        border: 'none',
        fontSize: 11,
        lineHeight: 1,
        cursor: 'pointer',
      }}
      title="Remove"
    >
      ×
    </button>
  )
}
