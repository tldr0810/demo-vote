import { describe, expect, it } from 'vitest'
import {
  ADMIN_COOKIE,
  buildCookie,
  checkAdminPassword,
  isSecureRequest,
  readCookie,
  signSession,
  verifySession,
  type AdminSession,
  type VoterSession,
} from '../worker/auth'

const SECRET = 'test-hmac-key-at-least-32-characters-long'
const NOW = 1_800_000_000

function voter(overrides: Partial<VoterSession> = {}): VoterSession {
  return { t: 'v', c: 'K7M29XYZ', e: 'evt_1', exp: NOW + 600, ...overrides }
}

describe('session signing', () => {
  it('round-trips a valid voter session', async () => {
    const token = await signSession(voter(), SECRET)
    const decoded = await verifySession<VoterSession>(token, SECRET, 'v', NOW)
    expect(decoded).toMatchObject({ t: 'v', c: 'K7M29XYZ', e: 'evt_1' })
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(voter(), 'a-completely-different-secret-value')
    expect(await verifySession(token, SECRET, 'v', NOW)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await signSession(voter(), SECRET)
    const [body, signature] = token.split('.')
    const forged = `${body.slice(0, -1)}${body.slice(-1) === 'A' ? 'B' : 'A'}.${signature}`
    expect(await verifySession(forged, SECRET, 'v', NOW)).toBeNull()
  })

  it('rejects an expired session', async () => {
    const token = await signSession(voter({ exp: NOW - 1 }), SECRET)
    expect(await verifySession(token, SECRET, 'v', NOW)).toBeNull()
  })

  it('accepts a session in its final second and rejects it one second later', async () => {
    const token = await signSession(voter({ exp: NOW + 1 }), SECRET)
    expect(await verifySession(token, SECRET, 'v', NOW)).not.toBeNull()
    expect(await verifySession(token, SECRET, 'v', NOW + 1)).toBeNull()
  })

  it('will not let a voter cookie authenticate as an organiser', async () => {
    const token = await signSession(voter(), SECRET)
    expect(await verifySession<AdminSession>(token, SECRET, 'a', NOW)).toBeNull()
  })

  it('rejects malformed tokens without throwing', async () => {
    for (const bad of ['', 'nodot', '.', 'a.b', '....', 'not-base64!.also-not']) {
      expect(await verifySession(bad, SECRET, 'v', NOW)).toBeNull()
    }
    expect(await verifySession(null, SECRET, 'v', NOW)).toBeNull()
  })
})

describe('checkAdminPassword', () => {
  it('accepts the exact password and rejects near misses', async () => {
    expect(await checkAdminPassword('hunter2-hunter2', 'hunter2-hunter2')).toBe(true)
    expect(await checkAdminPassword('hunter2-hunter', 'hunter2-hunter2')).toBe(false)
    expect(await checkAdminPassword('', 'hunter2-hunter2')).toBe(false)
    expect(await checkAdminPassword('HUNTER2-HUNTER2', 'hunter2-hunter2')).toBe(false)
  })
})

describe('cookies', () => {
  it('omits Secure on http so localhost development works', () => {
    expect(buildCookie(ADMIN_COOKIE, 'v', 60, false)).not.toContain('Secure')
    expect(buildCookie(ADMIN_COOKIE, 'v', 60, true)).toContain('Secure')
  })

  it('is HttpOnly and SameSite=Lax so a QR-code arrival keeps the cookie', () => {
    const cookie = buildCookie(ADMIN_COOKIE, 'v', 60, true)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('reads one cookie out of a crowded header', () => {
    const request = new Request('https://example.com', {
      headers: { Cookie: 'other=1; dv_admin=abc.def; trailing=2' },
    })
    expect(readCookie(request, ADMIN_COOKIE)).toBe('abc.def')
    expect(readCookie(request, 'missing')).toBeNull()
  })

  it('detects transport security from the request URL', () => {
    expect(isSecureRequest(new Request('https://example.com'))).toBe(true)
    expect(isSecureRequest(new Request('http://localhost:5173'))).toBe(false)
  })
})
