export type AgentKind = 'claude' | 'openai'

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'error'
  | 'stopped'

export interface CredentialStatus {
  agent_kind: AgentKind
  has_key: boolean
  updated_at: string | null
}

export interface Session {
  id: string
  agent_kind: AgentKind
  model: string
  folder_path: string
  title: string
  status: SessionStatus
  created_at: string
  updated_at: string
  last_active_at: string
}

export interface SessionCreate {
  agent_kind: AgentKind
  model: string
  folder_path: string
  title?: string
}

export type ModelsByAgent = Record<AgentKind, string[]>

export interface FolderValidateResponse {
  exists: boolean
  is_dir: boolean
  resolved_path: string | null
}

export interface FolderEntry {
  name: string
  is_dir: boolean
}

export interface FolderListResponse {
  path: string
  parent: string | null
  entries: FolderEntry[]
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      const j = JSON.parse(body)
      if (j && typeof j.detail === 'string') detail = j.detail
    } catch {
      /* keep raw body */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  credentials: {
    list: () => fetch('/api/credentials').then((r) => handle<CredentialStatus[]>(r)),
    set: (agent: AgentKind, api_key: string) =>
      fetch(`/api/credentials/${agent}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key }),
      }).then((r) => handle<CredentialStatus>(r)),
    remove: (agent: AgentKind) =>
      fetch(`/api/credentials/${agent}`, { method: 'DELETE' }).then((r) =>
        handle<void>(r),
      ),
  },
  sessions: {
    list: () => fetch('/api/sessions').then((r) => handle<Session[]>(r)),
    get: (id: string) => fetch(`/api/sessions/${id}`).then((r) => handle<Session>(r)),
    create: (body: SessionCreate) =>
      fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => handle<Session>(r)),
    remove: (id: string) =>
      fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then((r) => handle<void>(r)),
    messages: (id: string) =>
      fetch(`/api/sessions/${id}/messages`).then((r) =>
        handle<Array<Record<string, unknown> & { seq: number }>>(r),
      ),
  },
  folders: {
    validate: (path: string) =>
      fetch('/api/folders/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }).then((r) => handle<FolderValidateResponse>(r)),
    list: (path?: string, includeFiles = false) => {
      const params = new URLSearchParams()
      if (path) params.set('path', path)
      if (includeFiles) params.set('include_files', 'true')
      const qs = params.toString()
      return fetch(
        `/api/folders/list${qs ? `?${qs}` : ''}`,
      ).then((r) => handle<FolderListResponse>(r))
    },
  },
  models: {
    list: () => fetch('/api/models').then((r) => handle<ModelsByAgent>(r)),
  },
}
