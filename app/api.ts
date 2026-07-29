// Thin typed wrapper over fetch. Every call resolves; nothing throws, because
// during a live event an unhandled rejection is a white screen in someone's
// hand.

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number }

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    })
    const text = await response.text()
    const payload: T & { error?: string } = text ? JSON.parse(text) : {}

    if (!response.ok) {
      return { ok: false, error: payload.error ?? 'UNKNOWN', status: response.status }
    }
    return { ok: true, data: payload }
  } catch {
    // Offline, DNS failure, venue wifi dropping out mid-request.
    return { ok: false, error: 'NETWORK', status: 0 }
  }
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
}

// ------------------------------------------------------------------- types

export type EventStatus = 'draft' | 'open' | 'closed' | 'revealed'

export type PublicEvent = {
  id: string
  name: string
  status: EventStatus
  votingLive: boolean
  secondsRemaining: number
}

export type BallotDemo = {
  id: string
  slot: number
  name: string
  team: string
  blurb: string
}

export type Ballot = {
  event: { id: string; name: string; status: EventStatus }
  votingLive: boolean
  closesAt: string | null
  secondsRemaining: number
  hasVoted: boolean
  demos: BallotDemo[]
}

export type TallyRow = {
  demoId: string
  slot: number
  name: string
  team: string
  votes: number
}

export type CodeStats = { issued: number; activated: number; voted: number }

export type AdminResults = {
  event: { id: string; name: string; status: EventStatus }
  votingLive: boolean
  secondsRemaining: number
  stats: CodeStats
  tally: TallyRow[]
}

export type AdminEvent = {
  id: string
  name: string
  status: EventStatus
  windowSeconds: number
  openedAt: string | null
  closesAt: string | null
  createdAt: string
  votingLive: boolean
  secondsRemaining: number
  demos: { id: string; slot: number; name: string; team: string; blurb: string }[]
  stats: CodeStats
}
