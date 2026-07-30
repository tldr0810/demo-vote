// Stateless HMAC-signed session cookies for both voters and organisers.
//
// Nothing here is stored server-side. A voter session says "this browser
// redeemed code X for event Y until time Z" and the score endpoint re-checks
// every one of those claims against D1 before writing, so a forged or replayed
// cookie cannot inflate a demo's total — UNIQUE(code, demo_id) is still the last
// line of defence, and it makes a replayed write an overwrite rather than a
// second row.

export const VOTER_COOKIE = 'dv_voter'
export const ADMIN_COOKIE = 'dv_admin'

export type VoterSession = {
  t: 'v'
  /** The redeemed code. */
  c: string
  /** Event the code belongs to. */
  e: string
  /** Expiry, epoch seconds. */
  exp: number
}

export type AdminSession = {
  t: 'a'
  exp: number
}

type SessionPayload = VoterSession | AdminSession

const encoder = new TextEncoder()

// importKey is not free and the hot path runs it on every request, so cache the
// derived CryptoKey per secret for the lifetime of the isolate.
const keyCache = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string): Promise<CryptoKey> {
  let cached = keyCache.get(secret)
  if (!cached) {
    cached = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    keyCache.set(secret, cached)
  }
  return cached
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

/** Length-independent, value-constant-time comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return `${body}.${toBase64Url(new Uint8Array(signature))}`
}

/**
 * Returns the payload only if the signature is valid and the session has not
 * expired. `now` is injectable so window behaviour can be tested without
 * waiting an hour.
 */
export async function verifySession<T extends SessionPayload>(
  token: string | null | undefined,
  secret: string,
  expectedType: T['t'],
  now: number = Math.floor(Date.now() / 1000),
): Promise<T | null> {
  if (!token) return null
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const body = token.slice(0, separator)
  const provided = fromBase64Url(token.slice(separator + 1))
  if (!provided) return null

  const key = await hmacKey(secret)
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  if (!timingSafeEqual(provided, expected)) return null

  const decoded = fromBase64Url(body)
  if (!decoded) return null

  let payload: SessionPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(decoded)) as SessionPayload
  } catch {
    return null
  }

  if (payload.t !== expectedType) return null
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null
  return payload as T
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return null
}

export function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    // Lax rather than Strict: voters arrive by scanning a QR code, which is a
    // cross-site top-level navigation, and Strict would drop the cookie on that
    // first hop. There is no state-changing GET to protect, and every mutating
    // endpoint is a same-origin POST from our own SPA.
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  // Browsers reject Secure cookies over plain http, which is how `vite dev`
  // serves localhost.
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

export function clearCookie(name: string, secure: boolean): string {
  return buildCookie(name, '', 0, secure)
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

/**
 * Verifies the organiser password.
 *
 * Deliberately *not* backed by a global lockout counter. During a live event a
 * global counter is a weapon: anyone who can reach /admin could lock the
 * organiser out of their own dashboard mid-session by failing on purpose. The
 * per-IP ADMIN_RATE_LIMITER binding raises the cost of guessing without giving
 * a stranger that power.
 */
export async function checkAdminPassword(supplied: string, expected: string): Promise<boolean> {
  // Compare digests rather than raw strings so the comparison cost does not
  // depend on how many leading characters happen to match.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}
