import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

const ORIGIN = 'https://vote.example.com'
const PASSWORD = 'test-admin-password'

let ipCounter = 0
function freshIp(): string {
  ipCounter += 1
  return `198.51.100.${ipCounter % 250}`
}

async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('CF-Connecting-IP', freshIp())
  if (init.body) headers.set('Content-Type', 'application/json')
  if (init.cookie) headers.set('Cookie', init.cookie)
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers })
}

async function login(): Promise<string> {
  const response = await api('/api/admin/session', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const header = response.headers.get('Set-Cookie') ?? ''
  const match = header.match(/dv_admin=([^;]+)/)
  if (!match) throw new Error(`no admin cookie: ${header}`)
  return `dv_admin=${match[1]}`
}

const SIX_DEMOS = Array.from({ length: 6 }, (_, index) => ({
  slot: index + 1,
  name: `Demo ${index + 1}`,
}))

async function createEvent(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await api('/api/admin/event', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name: 'Demo Day', demos: SIX_DEMOS, ...overrides }),
  })
  expect(response.status).toBe(201)
  const { eventId } = await response.json<{ eventId: string }>()
  return eventId
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM votes'),
    env.DB.prepare('DELETE FROM codes'),
    env.DB.prepare('DELETE FROM demos'),
    env.DB.prepare('DELETE FROM events'),
  ])
})

describe('organiser login', () => {
  it('accepts the configured password and rejects anything else', async () => {
    await login()
    const wrong = await api('/api/admin/session', {
      method: 'POST',
      body: JSON.stringify({ password: 'not-the-password' }),
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ error: 'BAD_PASSWORD' })
  })

  it('locks every admin route behind the cookie', async () => {
    for (const [path, method] of [
      ['/api/admin/state', 'GET'],
      ['/api/admin/event', 'POST'],
    ] as const) {
      const response = await api(path, { method, body: method === 'POST' ? '{}' : undefined })
      expect(response.status).toBe(401)
    }
  })
})

describe('event setup', () => {
  it('creates an event in draft with its demo roster', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)

    const state = await (await api('/api/admin/state', { cookie })).json<{
      events: { id: string; status: string; demos: { slot: number }[] }[]
    }>()
    const created = state.events.find((event) => event.id === eventId)
    expect(created?.status).toBe('draft')
    expect(created?.demos.map((demo) => demo.slot)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('rejects a roster with duplicate slots', async () => {
    const cookie = await login()
    const response = await api('/api/admin/event', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        name: 'Broken',
        demos: [
          { slot: 1, name: 'A' },
          { slot: 1, name: 'B' },
        ],
      }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects an event with no demos', async () => {
    const cookie = await login()
    const response = await api('/api/admin/event', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Empty', demos: [] }),
    })
    expect(response.status).toBe(400)
  })

  it('freezes the demo roster once voting has opened', async () => {
    // Renaming a demo mid-vote would relabel ballots already cast.
    const cookie = await login()
    const eventId = await createEvent(cookie)
    await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })

    const response = await api(`/api/admin/event/${eventId}`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ demos: [{ slot: 1, name: 'Renamed' }] }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'INVALID_TRANSITION' })
  })
})

describe('code batches', () => {
  it('generates the requested number of distinct codes and serves them as CSV', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)

    const response = await api(`/api/admin/event/${eventId}/codes`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ count: 40 }),
    })
    expect(response.status).toBe(201)
    const { codes } = await response.json<{ codes: string[] }>()
    expect(new Set(codes).size).toBe(40)

    const csv = await api(`/api/admin/event/${eventId}/codes.csv`, { cookie })
    expect(csv.headers.get('Content-Type')).toContain('text/csv')
    const text = await csv.text()
    expect(text.split('\n').filter(Boolean)).toHaveLength(41) // header + 40
  })

  it('generates a batch far larger than one D1 statement can bind', async () => {
    // D1 caps bound parameters per statement, so a realistic conference-sized
    // batch has to be chunked. 300 slips crosses that boundary many times over.
    const cookie = await login()
    const eventId = await createEvent(cookie)
    const response = await api(`/api/admin/event/${eventId}/codes`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ count: 300 }),
    })
    expect(response.status).toBe(201)

    const row = await env.DB.prepare('SELECT count(*) AS n FROM codes WHERE event_id = ?')
      .bind(eventId)
      .first<{ n: number }>()
    expect(Number(row?.n)).toBe(300)
  })

  it('refuses a batch size that is obviously a typo', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)
    for (const count of [0, -5, 99999]) {
      const response = await api(`/api/admin/event/${eventId}/codes`, {
        method: 'POST',
        cookie,
        body: JSON.stringify({ count }),
      })
      expect(response.status).toBe(400)
    }
  })

  it('counts issued, activated and voted separately', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)
    const { codes } = await (
      await api(`/api/admin/event/${eventId}/codes`, {
        method: 'POST',
        cookie,
        body: JSON.stringify({ count: 5 }),
      })
    ).json<{ codes: string[] }>()

    await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })

    // Two people redeem; only one of them votes.
    const cookies = await Promise.all(
      codes.slice(0, 2).map(async (code) => {
        const response = await api('/api/session', {
          method: 'POST',
          body: JSON.stringify({ eventId, code }),
        })
        return `dv_voter=${(response.headers.get('Set-Cookie') ?? '').match(/dv_voter=([^;]+)/)![1]}`
      }),
    )
    const demos = await (
      await api('/api/ballot', { cookie: cookies[0]! })
    ).json<{ demos: { id: string }[] }>()
    await api('/api/vote', {
      method: 'POST',
      cookie: cookies[0]!,
      body: JSON.stringify({ demoId: demos.demos[0]!.id }),
    })

    const results = await (
      await api(`/api/admin/event/${eventId}/results`, { cookie })
    ).json<{ stats: { issued: number; activated: number; voted: number } }>()
    expect(results.stats).toEqual({ issued: 5, activated: 2, voted: 1 })
  })
})

describe('status transitions', () => {
  it('walks draft to open to closed to revealed', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)

    for (const status of ['open', 'closed', 'revealed'] as const) {
      const response = await api(`/api/admin/event/${eventId}/status`, {
        method: 'POST',
        cookie,
        body: JSON.stringify({ status }),
      })
      expect(response.status).toBe(200)
    }
  })

  it('refuses to skip straight from draft to revealed', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)
    const response = await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'revealed' }),
    })
    expect(response.status).toBe(409)
  })

  it('refuses to reopen voting after the reveal', async () => {
    // Reopening would let a latecomer vote knowing the standings.
    const cookie = await login()
    const eventId = await createEvent(cookie)
    for (const status of ['open', 'closed', 'revealed'] as const) {
      await api(`/api/admin/event/${eventId}/status`, {
        method: 'POST',
        cookie,
        body: JSON.stringify({ status }),
      })
    }
    const reopen = await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })
    expect(reopen.status).toBe(409)
  })

  it('freezes the deadline at the moment of opening', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie, { windowSeconds: 120 })
    const before = Date.now()

    const response = await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })
    const { event } = await response.json<{ event: { closesAt: string; openedAt: string } }>()
    const closes = Date.parse(event.closesAt)
    expect(closes).toBeGreaterThanOrEqual(before + 120_000)
    expect(closes).toBeLessThan(before + 130_000)
  })

  it('does not let a later windowSeconds edit extend a running window', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie, { windowSeconds: 120 })
    await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })
    const original = await env.DB.prepare('SELECT closes_at FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ closes_at: string }>()

    await api(`/api/admin/event/${eventId}`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ windowSeconds: 99999 }),
    })

    const after = await env.DB.prepare('SELECT closes_at FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ closes_at: string }>()
    expect(after?.closes_at).toBe(original?.closes_at)
  })

  it('refuses to open an event with no demos', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)
    await env.DB.prepare('DELETE FROM demos WHERE event_id = ?').bind(eventId).run()
    const response = await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('the tally', () => {
  it('includes demos with zero votes and sorts by count then slot', async () => {
    const cookie = await login()
    const eventId = await createEvent(cookie)
    const { codes } = await (
      await api(`/api/admin/event/${eventId}/codes`, {
        method: 'POST',
        cookie,
        body: JSON.stringify({ count: 3 }),
      })
    ).json<{ codes: string[] }>()
    await api(`/api/admin/event/${eventId}/status`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ status: 'open' }),
    })

    const firstVoter = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: codes[0] }),
    })
    const voterCookie = `dv_voter=${(firstVoter.headers.get('Set-Cookie') ?? '').match(/dv_voter=([^;]+)/)![1]}`
    const ballot = await (
      await api('/api/ballot', { cookie: voterCookie })
    ).json<{ demos: { id: string; slot: number }[] }>()
    // Vote for slot 3 so the winner is not also the first by slot order.
    await api('/api/vote', {
      method: 'POST',
      cookie: voterCookie,
      body: JSON.stringify({ demoId: ballot.demos[2]!.id }),
    })

    const results = await (
      await api(`/api/admin/event/${eventId}/results`, { cookie })
    ).json<{ tally: { slot: number; votes: number }[] }>()

    expect(results.tally).toHaveLength(6)
    expect(results.tally[0]).toMatchObject({ slot: 3, votes: 1 })
    // Remaining five are all zero, ordered by slot.
    expect(results.tally.slice(1).map((row) => row.slot)).toEqual([1, 2, 4, 5, 6])
    expect(results.tally.slice(1).every((row) => row.votes === 0)).toBe(true)
  })
})
