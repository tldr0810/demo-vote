import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateCodeBatch } from '../worker/codes'

const ORIGIN = 'https://vote.example.com'

// Each request carries a distinct client IP. The per-IP rate limiters in
// wrangler.toml are real inside miniflare, and sharing one IP across the suite
// would make tests fail on limits rather than on behaviour.
let ipCounter = 0
function freshIp(): string {
  ipCounter += 1
  return `203.0.113.${ipCounter % 250}`
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

/** Pulls a cookie value out of a Set-Cookie response header. */
function cookieFrom(response: Response, name: string): string {
  const header = response.headers.get('Set-Cookie') ?? ''
  const match = header.match(new RegExp(`${name}=([^;]+)`))
  if (!match) throw new Error(`no ${name} cookie in: ${header}`)
  return `${name}=${match[1]}`
}

type Seed = { eventId: string; demoIds: string[]; codes: string[] }

async function seed(
  options: {
    status?: 'draft' | 'open' | 'closed' | 'revealed'
    closesInSeconds?: number
    demoCount?: number
    codeCount?: number
  } = {},
): Promise<Seed> {
  const {
    status = 'open',
    closesInSeconds = 3600,
    demoCount = 6,
    codeCount = 3,
  } = options

  const eventId = `evt_${crypto.randomUUID().slice(0, 8)}`
  const now = new Date()
  const closesAt = new Date(now.getTime() + closesInSeconds * 1000).toISOString()

  await env.DB.prepare(
    `INSERT INTO events (id, name, status, window_seconds, opened_at, closes_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(eventId, 'Demo Day', status, 3600, now.toISOString(), closesAt, now.toISOString())
    .run()

  const demoIds: string[] = []
  for (let slot = 1; slot <= demoCount; slot += 1) {
    const id = `dmo_${crypto.randomUUID().slice(0, 8)}`
    demoIds.push(id)
    await env.DB.prepare(
      `INSERT INTO demos (id, event_id, slot, name, team, blurb) VALUES (?, ?, ?, ?, '', '')`,
    )
      .bind(id, eventId, slot, `Demo ${slot}`)
      .run()
  }

  const codes = generateCodeBatch(codeCount)
  for (const code of codes) {
    await env.DB.prepare(
      `INSERT INTO codes (code, event_id, batch, created_at) VALUES (?, ?, 'b1', ?)`,
    )
      .bind(code, eventId, now.toISOString())
      .run()
  }

  return { eventId, demoIds, codes }
}

async function redeem(eventId: string, code: string): Promise<string> {
  const response = await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ eventId, code }),
  })
  expect(response.status).toBe(200)
  return cookieFrom(response, 'dv_voter')
}

async function countVotes(eventId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM votes WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM votes'),
    env.DB.prepare('DELETE FROM codes'),
    env.DB.prepare('DELETE FROM demos'),
    env.DB.prepare('DELETE FROM events'),
  ])
})

// ---------------------------------------------------------------------------

describe('one code, one vote', () => {
  it('records a single vote and rejects the second attempt', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    const first = await api('/api/vote', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: demoIds[0] }),
    })
    expect(first.status).toBe(200)

    const second = await api('/api/vote', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: demoIds[1] }),
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: 'ALREADY_VOTED' })

    expect(await countVotes(eventId)).toBe(1)
  })

  /**
   * The reason this project uses D1 rather than KV.
   *
   * Twenty ballots for the same code are dispatched before any of them
   * finishes, so every request observes codes.used_at as NULL. An
   * implementation that checked "has this code voted?" and then inserted would
   * write many rows here and pass every other test in this file.
   */
  it('survives twenty simultaneous ballots from one code', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        api('/api/vote', {
          method: 'POST',
          cookie,
          body: JSON.stringify({ demoId: demoIds[index % demoIds.length] }),
        }),
      ),
    )

    const accepted = responses.filter((response) => response.status === 200)
    const rejected = responses.filter((response) => response.status === 409)

    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(19)
    expect(await countVotes(eventId)).toBe(1)
  })

  /**
   * The limiter is keyed on the code, not on the caller's address: a venue puts
   * the whole room behind one NAT address. It is a ceiling on database work and
   * nothing more, and it deliberately sits above the burst the test above needs,
   * so that test keeps reaching the constraint that actually guarantees one vote.
   */
  it('caps one code hammering the vote endpoint', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        api('/api/vote', {
          method: 'POST',
          cookie,
          body: JSON.stringify({ demoId: demoIds[index % demoIds.length] }),
        }),
      ),
    )

    const statuses = responses.map((response) => response.status)
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
    // The refusals are still refusals, whichever layer produced them.
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(await countVotes(eventId)).toBe(1)
  })

  it('rejects a duplicate insert at the database level', async () => {
    // Proves the guarantee is the UNIQUE index itself, independent of any
    // application logic that might later be refactored around it.
    const { eventId, demoIds, codes } = await seed()
    const code = codes[0]!

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        env.DB.prepare(
          `INSERT INTO votes (event_id, demo_id, code, created_at) VALUES (?, ?, ?, ?)`,
        )
          .bind(eventId, demoIds[index % demoIds.length], code, new Date().toISOString())
          .run(),
      ),
    )

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await countVotes(eventId)).toBe(1)
  })

  it('will not issue a new session for a code that already voted', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)
    await api('/api/vote', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: demoIds[0] }),
    })

    const retry = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: codes[0] }),
    })
    expect(retry.status).toBe(409)
    expect(await retry.json()).toMatchObject({ error: 'CODE_ALREADY_USED' })
  })
})

describe('code redemption', () => {
  it('lets an unused code be redeemed twice, so a closed tab is recoverable', async () => {
    const { eventId, codes } = await seed()
    await redeem(eventId, codes[0]!)
    await redeem(eventId, codes[0]!)
  })

  it('accepts codes typed with spaces, dashes and lowercase', async () => {
    const { eventId, codes } = await seed()
    const messy = ` ${codes[0]!.slice(0, 4).toLowerCase()}-${codes[0]!.slice(4).toLowerCase()} `
    const response = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: messy }),
    })
    expect(response.status).toBe(200)
  })

  it('gives the same answer for a malformed code and an unknown one', async () => {
    const { eventId } = await seed()
    const malformed = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: 'OOOOOOOO' }),
    })
    const unknown = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: 'K7M29XYZ' }),
    })
    expect(malformed.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await malformed.json()).toEqual(await unknown.json())
  })

  it("rejects a code belonging to a different event", async () => {
    const other = await seed()
    const target = await seed()
    const response = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId: target.eventId, code: other.codes[0] }),
    })
    expect(response.status).toBe(401)
  })
})

describe('the voting window', () => {
  it('refuses redemption before the organiser opens voting', async () => {
    const { eventId, codes } = await seed({ status: 'draft' })
    const response = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: codes[0] }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'VOTING_NOT_OPEN' })
  })

  it('refuses redemption once the deadline has passed, even while status is open', async () => {
    // The clock closes the window, not the button. During a live event nobody
    // remembers to press close on time.
    const { eventId, codes } = await seed({ closesInSeconds: -1 })
    const response = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId, code: codes[0] }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'VOTING_CLOSED' })
  })

  it('refuses a vote from a session that outlived the window', async () => {
    const { eventId, demoIds, codes } = await seed({ closesInSeconds: 2 })
    const cookie = await redeem(eventId, codes[0]!)

    // The organiser closes early, after the cookie was handed out.
    await env.DB.prepare(`UPDATE events SET status = 'closed' WHERE id = ?`).bind(eventId).run()

    const response = await api('/api/vote', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: demoIds[0] }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'VOTING_CLOSED' })
    expect(await countVotes(eventId)).toBe(0)
  })
})

describe('authorisation', () => {
  it('rejects a vote with no session cookie', async () => {
    const { demoIds } = await seed()
    const response = await api('/api/vote', {
      method: 'POST',
      body: JSON.stringify({ demoId: demoIds[0] }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'NO_SESSION' })
  })

  it('rejects a forged session cookie', async () => {
    const { eventId, demoIds } = await seed()
    const response = await api('/api/vote', {
      method: 'POST',
      cookie: 'dv_voter=eyJ0IjoidiJ9.not-a-real-signature',
      body: JSON.stringify({ demoId: demoIds[0] }),
    })
    expect(response.status).toBe(401)
    expect(await countVotes(eventId)).toBe(0)
  })

  it('rejects a vote for a demo from another event', async () => {
    const other = await seed()
    const target = await seed()
    const cookie = await redeem(target.eventId, target.codes[0]!)

    const response = await api('/api/vote', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: other.demoIds[0] }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'UNKNOWN_DEMO' })
    expect(await countVotes(other.eventId)).toBe(0)
  })
})

describe('the tally never leaks to a voter', () => {
  it('keeps counts out of every voter-facing payload', async () => {
    const { eventId, demoIds, codes } = await seed({ codeCount: 2 })

    // Put a real vote on the board so a leak would have something to show.
    const firstCookie = await redeem(eventId, codes[0]!)
    await api('/api/vote', {
      method: 'POST',
      cookie: firstCookie,
      body: JSON.stringify({ demoId: demoIds[0] }),
    })

    const cookie = await redeem(eventId, codes[1]!)
    const payloads = [
      await (await api('/api/ballot', { cookie })).text(),
      await (
        await api('/api/vote', {
          method: 'POST',
          cookie,
          body: JSON.stringify({ demoId: demoIds[0] }),
        })
      ).text(),
      await (await api(`/api/event/${eventId}`)).text(),
    ]

    for (const payload of payloads) {
      expect(payload).not.toContain('tally')
      expect(payload).not.toContain('votes')
      expect(payload).not.toContain('count')
    }
  })

  it('refuses the public results endpoint until the organiser reveals', async () => {
    const { eventId } = await seed()
    expect((await api(`/api/results/${eventId}`)).status).toBe(403)

    await env.DB.prepare(`UPDATE events SET status = 'revealed' WHERE id = ?`).bind(eventId).run()
    expect((await api(`/api/results/${eventId}`)).status).toBe(200)
  })

  it('refuses the admin tally without an admin cookie', async () => {
    const { eventId } = await seed()
    const response = await api(`/api/admin/event/${eventId}/results`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'ADMIN_REQUIRED' })
  })
})

describe('one printed QR code, reused across events', () => {
  // The sign on the wall encodes "/" and nothing else. These tests are what
  // let it stay on the wall from one event to the next.

  async function seedEventOnly(
    id: string,
    status: 'draft' | 'open' | 'closed' | 'revealed',
    createdAt: string,
  ) {
    const closesAt = new Date(Date.now() + 3600_000).toISOString()
    await env.DB.prepare(
      `INSERT INTO events (id, name, status, window_seconds, opened_at, closes_at, created_at)
       VALUES (?, ?, ?, 3600, ?, ?, ?)`,
    )
      .bind(id, `Event ${id}`, status, createdAt, closesAt, createdAt)
      .run()
  }

  async function currentEventId(): Promise<string> {
    const response = await api('/api/current-event')
    const body = await response.json<{ id: string }>()
    return body.id
  }

  it('sends people to the live event when one is running', async () => {
    await seedEventOnly('evt_old', 'revealed', '2026-01-01T00:00:00.000Z')
    await seedEventOnly('evt_now', 'open', '2026-02-01T00:00:00.000Z')
    expect(await currentEventId()).toBe('evt_now')
  })

  it('prefers the event being set up over one that already finished', async () => {
    // The regression that makes a permanent QR code useless: a revealed event
    // outranking the draft for the evening's session means the sign points at
    // last quarter's results while the room waits to vote.
    await seedEventOnly('evt_finished', 'revealed', '2026-01-01T00:00:00.000Z')
    await seedEventOnly('evt_tonight', 'draft', '2026-02-01T00:00:00.000Z')
    expect(await currentEventId()).toBe('evt_tonight')
  })

  it('prefers a draft over a closed-but-unrevealed event', async () => {
    await seedEventOnly('evt_closed', 'closed', '2026-01-01T00:00:00.000Z')
    await seedEventOnly('evt_tonight', 'draft', '2026-02-01T00:00:00.000Z')
    expect(await currentEventId()).toBe('evt_tonight')
  })

  it('picks the newest when several are in the same state', async () => {
    await seedEventOnly('evt_older', 'draft', '2026-01-01T00:00:00.000Z')
    await seedEventOnly('evt_newer', 'draft', '2026-03-01T00:00:00.000Z')
    expect(await currentEventId()).toBe('evt_newer')
  })

  it('still resolves to the last event when nothing is scheduled', async () => {
    // So the page can say "voting has closed" rather than "no such event".
    await seedEventOnly('evt_only', 'revealed', '2026-01-01T00:00:00.000Z')
    expect(await currentEventId()).toBe('evt_only')
  })

  it('keeps a code from a previous event out of the current one', async () => {
    const past = await seed({ status: 'revealed' })
    const tonight = await seed({ status: 'open' })
    const response = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ eventId: tonight.eventId, code: past.codes[0] }),
    })
    expect(response.status).toBe(401)
  })
})

describe('the ballot', () => {
  it('lists demos in slot order and reports remaining time', async () => {
    const { eventId, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)
    const body = await (await api('/api/ballot', { cookie })).json<{
      demos: { slot: number; name: string }[]
      secondsRemaining: number
      hasVoted: boolean
      votingLive: boolean
    }>()

    expect(body.demos.map((demo) => demo.slot)).toEqual([1, 2, 3, 4, 5, 6])
    expect(body.votingLive).toBe(true)
    expect(body.hasVoted).toBe(false)
    expect(body.secondsRemaining).toBeGreaterThan(3500)
  })

  it('reports hasVoted after the ballot is cast, so a reload shows the thanks screen', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)
    await api('/api/vote', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: demoIds[0] }),
    })

    const body = await (await api('/api/ballot', { cookie })).json<{ hasVoted: boolean }>()
    expect(body.hasVoted).toBe(true)
  })
})

// ---------------------------------------------------------------------------

/**
 * Two events can be open at once, which is what a multi-track day needs. What
 * makes it work is that a session belongs to one event and cannot answer for
 * another: the ballot is asked for by event, and a cookie issued elsewhere is
 * treated as no cookie at all.
 *
 * Without this, somebody holding a live session for one event who scans the
 * other event's QR is silently dropped back into the first: the ballot endpoint
 * resolves the event from the cookie, so they are shown their existing receipt
 * and never get to vote in the event actually in front of them.
 */
describe('two events running at once', () => {
  it("refuses to serve one event's ballot to a session from another", async () => {
    const first = await seed()
    const second = await seed()
    const cookie = await redeem(first.eventId, first.codes[0]!)

    const own = await api(`/api/ballot?eventId=${first.eventId}`, { cookie })
    expect(own.status).toBe(200)

    const other = await api(`/api/ballot?eventId=${second.eventId}`, { cookie })
    expect(other.status).toBe(401)
    expect((await other.json<{ error: string }>()).error).toBe('NO_SESSION')
  })

  it('lets somebody who voted in one event vote once in the other', async () => {
    const first = await seed()
    const second = await seed()

    const firstCookie = await redeem(first.eventId, first.codes[0]!)
    await api('/api/vote', {
      method: 'POST',
      cookie: firstCookie,
      body: JSON.stringify({ demoId: first.demoIds[0] }),
    })

    // Scanning the other event's QR while still holding the first session must
    // not hand back the receipt for the vote just cast.
    const stale = await api(`/api/ballot?eventId=${second.eventId}`, { cookie: firstCookie })
    expect(stale.status).toBe(401)

    const secondCookie = await redeem(second.eventId, second.codes[0]!)
    const cast = await api('/api/vote', {
      method: 'POST',
      cookie: secondCookie,
      body: JSON.stringify({ demoId: second.demoIds[0] }),
    })
    expect(cast.status).toBe(200)

    expect(await countVotes(first.eventId)).toBe(1)
    expect(await countVotes(second.eventId)).toBe(1)
  })
})
