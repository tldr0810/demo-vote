// Every API response is uncacheable. A cached ballot would show a stale
// countdown, and a cached tally would show a stale winner.
const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(BASE_HEADERS)) headers.set(key, value)
  return Response.json(data, { ...init, headers })
}

/**
 * Machine-readable failure. `code` is a stable identifier the SPA switches on;
 * user-facing wording lives in the frontend so it can be translated.
 */
export function fail(code: ApiErrorCode, status: number, extra: Record<string, unknown> = {}) {
  return json({ error: code, ...extra }, { status })
}

export type ApiErrorCode =
  // Voter flow
  | 'INVALID_CODE' // wrong shape, or no such code — deliberately the same code
  | 'EVENT_NOT_FOUND'
  | 'VOTING_NOT_OPEN'
  | 'VOTING_CLOSED'
  | 'CODE_ALREADY_USED'
  | 'ALREADY_VOTED'
  | 'NO_SESSION'
  | 'UNKNOWN_DEMO'
  | 'RATE_LIMITED'
  // Organiser flow
  | 'ADMIN_REQUIRED'
  | 'BAD_PASSWORD'
  | 'BAD_REQUEST'
  | 'INVALID_TRANSITION'
  // Deployment
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

/**
 * D1 surfaces constraint violations as an opaque Error whose message carries the
 * SQLite text. Losing a race on votes.code is expected behaviour, not a fault,
 * so it has to be distinguishable from a real database failure.
 */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('UNIQUE constraint failed')
}
