export interface ServerEvent {
  type: string
  seq: number
  created_at: string
  [key: string]: unknown
}

export interface WireAttachment {
  kind: 'image' | 'text'
  name: string
  mime?: string
  base64?: string
  text?: string
}

export type ClientEvent =
  | { type: 'prompt.submit'; text: string; attachments?: WireAttachment[] }
  | {
      type: 'tool.approve.response'
      call_id: string
      approved: boolean
      remember?: 'session'
    }
  | { type: 'interrupt' }
  | { type: 'compact' }
  | { type: 'ask.answer'; id: string; answers: Record<string, string | string[]> }
  | { type: 'plan.decision'; approved: boolean; feedback?: string }

export type WsStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error'

export interface SessionSocket {
  send: (e: ClientEvent) => void
  close: () => void
  /** Registered listener called each time the socket transitions back to open
   * AFTER a reconnect — lets callers re-fetch history to catch any events
   * missed during downtime. Not called on the very first open. */
  onReconnected: (fn: () => void) => void
}

const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 30_000

export function openSessionSocket(
  sessionId: string,
  onEvent: (e: ServerEvent) => void,
  onStatus: (status: WsStatus) => void,
): SessionSocket {
  let ws: WebSocket | null = null
  let closedByCaller = false
  let attempt = 0
  let firstOpenSeen = false
  const reconnectedListeners: Array<() => void> = []

  const url = (() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/sessions/${sessionId}`
  })()

  const connect = () => {
    ws = new WebSocket(url)
    onStatus(firstOpenSeen ? 'reconnecting' : 'connecting')

    ws.addEventListener('open', () => {
      attempt = 0
      onStatus('open')
      if (firstOpenSeen) {
        reconnectedListeners.forEach((fn) => {
          try {
            fn()
          } catch (e) {
            console.error('[ws] onReconnected handler threw', e)
          }
        })
      } else {
        firstOpenSeen = true
      }
    })

    ws.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as ServerEvent
        onEvent(parsed)
      } catch (e) {
        console.error('[ws] bad message', e, ev.data)
      }
    })

    ws.addEventListener('error', () => {
      // error always precedes close in browsers; let close handle retry.
      onStatus('error')
    })

    ws.addEventListener('close', () => {
      if (closedByCaller) {
        onStatus('closed')
        return
      }
      attempt += 1
      const delay = Math.min(
        MAX_DELAY_MS,
        BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 8)),
      )
      onStatus('reconnecting')
      setTimeout(() => {
        if (!closedByCaller) connect()
      }, delay)
    })
  }

  connect()

  return {
    send: (e) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(e))
      } else {
        console.warn('[ws] dropped send while not open', e)
      }
    },
    close: () => {
      closedByCaller = true
      ws?.close()
    },
    onReconnected: (fn) => {
      reconnectedListeners.push(fn)
    },
  }
}
