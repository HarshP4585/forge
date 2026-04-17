import { useEffect, useState } from 'react'
import { api, type FolderListResponse } from '../api/rest'
import { COLORS } from '../theme'

export default function FolderBrowser({
  onSelect,
  onCancel,
}: {
  onSelect: (path: string) => void
  onCancel: () => void
}) {
  const [data, setData] = useState<FolderListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const navigate = async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.folders.list(path)
      setData(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    navigate()
  }, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => data?.parent && navigate(data.parent)}
          disabled={!data?.parent || loading}
          title="Up one level"
        >
          ↑
        </button>
        <input
          value={data?.path ?? ''}
          readOnly
          style={{
            flex: 1,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 13,
            background: COLORS.bgInput,
          }}
        />
        <button
          type="button"
          onClick={() => data && onSelect(data.path)}
          disabled={!data || loading}
          style={{ background: COLORS.blue, color: '#fff', border: 'none' }}
        >
          Use this folder
        </button>
      </div>

      {loading && <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Loading…</p>}
      {error && <p style={{ color: COLORS.red, fontSize: 13 }}>{error}</p>}

      {!loading && !error && data && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            maxHeight: 320,
            overflowY: 'auto',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            background: COLORS.bgCard,
          }}
        >
          {data.entries.length === 0 && (
            <li style={{ padding: 12, color: COLORS.textDim, fontSize: 13 }}>
              No subfolders here. (Hidden folders are not shown.)
            </li>
          )}
          {data.entries.map((e) => (
            <li
              key={e.name}
              onClick={() =>
                navigate(
                  data.path.endsWith('/')
                    ? `${data.path}${e.name}`
                    : `${data.path}/${e.name}`,
                )
              }
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                borderBottom: `1px solid ${COLORS.border}`,
                fontSize: 14,
                color: COLORS.text,
              }}
              onMouseEnter={(ev) =>
                (ev.currentTarget.style.background = COLORS.bgCardHover)
              }
              onMouseLeave={(ev) =>
                (ev.currentTarget.style.background = 'transparent')
              }
            >
              <span style={{ marginRight: 8 }}>📁</span>
              {e.name}
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
