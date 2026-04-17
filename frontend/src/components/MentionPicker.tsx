import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import React from 'react'
import { api, type FolderListResponse } from '../api/rest'
import { COLORS } from '../theme'

export interface MentionPickerHandle {
  onKeyDown: (e: React.KeyboardEvent) => boolean
}

/**
 * Tree-navigation @-mention picker.
 *
 * Starts at the session's folder_path. Folders navigate in on click/Enter,
 * files return the selected path to the parent. Users can also escape the
 * session folder by going up.
 *
 * Path returned to the parent is relative to the session folder if the
 * selection is inside it, otherwise absolute — so prompts stay readable.
 */
export default React.forwardRef<
  MentionPickerHandle,
  {
    sessionFolder: string
    query: string
    onSelect: (pathForPrompt: string) => void
    onDismiss: () => void
  }
>(function MentionPicker(
  { sessionFolder, query, onSelect, onDismiss },
  ref,
) {
  const [currentPath, setCurrentPath] = useState<string>(sessionFolder)
  const [data, setData] = useState<FolderListResponse | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqIdRef = useRef(0)

  // Fetch whenever the current directory changes.
  useEffect(() => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    api.folders
      .list(currentPath, true)
      .then((resp) => {
        if (reqId !== reqIdRef.current) return
        setData(resp)
        setActiveIdx(0)
      })
      .catch((e) => {
        if (reqId !== reqIdRef.current) return
        setError((e as Error).message)
        setData(null)
      })
      .finally(() => {
        if (reqId !== reqIdRef.current) return
        setLoading(false)
      })
  }, [currentPath])

  // Filter against the query the user typed after `@` in the textarea.
  const filteredEntries = useMemo(() => {
    if (!data) return []
    if (!query) return data.entries
    const q = query.toLowerCase()
    return data.entries.filter((e) => e.name.toLowerCase().includes(q))
  }, [data, query])

  const makePromptPath = (absolutePath: string): string => {
    // Relative to session folder if inside it; else absolute.
    const base = sessionFolder.replace(/\/+$/, '')
    if (absolutePath === base || absolutePath.startsWith(`${base}/`)) {
      return absolutePath.slice(base.length + 1) || '.'
    }
    return absolutePath
  }

  const joinPath = (dir: string, name: string): string =>
    dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`

  const pickEntry = (idx: number) => {
    const entry = filteredEntries[idx]
    if (!entry || !data) return
    const full = joinPath(data.path, entry.name)
    if (entry.is_dir) {
      setCurrentPath(full)
    } else {
      onSelect(makePromptPath(full))
    }
  }

  const goUp = () => {
    if (data?.parent) setCurrentPath(data.parent)
  }

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
          setActiveIdx((i) =>
            Math.min(i + 1, Math.max(0, filteredEntries.length - 1)),
          )
          return true
        }
        if (e.key === 'ArrowUp') {
          setActiveIdx((i) => Math.max(i - 1, 0))
          return true
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (filteredEntries[activeIdx]) {
            pickEntry(activeIdx)
            return true
          }
          return false
        }
        if (e.key === 'ArrowLeft' && (e.metaKey || e.altKey)) {
          goUp()
          return true
        }
        if (e.key === 'Escape') {
          onDismiss()
          return true
        }
        return false
      },
    }),
    [filteredEntries, activeIdx, data],
  )

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        maxHeight: 360,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: COLORS.bgElevated,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        boxShadow: COLORS.shadowFloat,
        zIndex: 5,
        fontSize: 13,
      }}
      onMouseDown={(e) => e.preventDefault() /* keep textarea focus */}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderBottom: `1px solid ${COLORS.border}`,
          fontSize: 11,
          color: COLORS.textDim,
        }}
      >
        <button
          type="button"
          onClick={goUp}
          disabled={!data?.parent}
          title="Up one level"
          style={{
            padding: '2px 8px',
            fontSize: 12,
            background: 'transparent',
            border: `1px solid ${COLORS.border}`,
          }}
        >
          ↑
        </button>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'ui-monospace, monospace',
          }}
          title={data?.path ?? currentPath}
        >
          {data?.path ?? currentPath}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '10px 12px', color: COLORS.textDim }}>
            Loading…
          </div>
        )}
        {error && (
          <div
            style={{
              padding: '10px 12px',
              color: COLORS.red,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && filteredEntries.length === 0 && (
          <div style={{ padding: '10px 12px', color: COLORS.textDim }}>
            {query ? `No entries matching "${query}".` : 'Folder is empty.'}
          </div>
        )}
        {filteredEntries.map((entry, i) => {
          const active = i === activeIdx
          return (
            <div
              key={`${entry.is_dir ? 'd' : 'f'}-${entry.name}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pickEntry(i)
              }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: active ? COLORS.bgCardHover : 'transparent',
              }}
            >
              <span style={{ fontSize: 12, width: 14 }}>
                {entry.is_dir ? '📁' : '📄'}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'ui-monospace, monospace',
                  color: COLORS.text,
                }}
                title={entry.name}
              >
                {entry.name}
              </span>
              {entry.is_dir && (
                <span
                  style={{ fontSize: 10, color: COLORS.textDim }}
                  aria-hidden
                >
                  ›
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
