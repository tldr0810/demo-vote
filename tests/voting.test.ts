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

function score(cookie: string, demoId: string, value: number): Promise<Response> {
  return api('/api/score', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ demoId, score: value }),
  })
}

/** Fills in a whole ballot, which is what makes it count towards the tally. */
async function scoreAll(cookie: string, demoIds: string[], value = 3): Promise<void> {
  for (const demoId of demoIds) {
    const response = await score(cookie, demoId, value)
    expect(response.status).toBe(200)
  }
}

async function countScores(eventId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM votes WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

async function storedScore(code: string, demoId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT score FROM votes WHERE code = ? AND demo_id = ?')
    .bind(code, demoId)
    .first<{ score: number }>()
  return row ? Number(row.score) : null
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

describe('scoring a ballot', () => {
  it('records one score per demo and reports progress as it goes', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    const first = await score(cookie, demoIds[0]!, 4)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      demoId: demoIds[0],
      score: 4,
      scored: 1,
      total: 6,
      complete: false,
    })

    for (const demoId of demoIds.slice(1)) await score(cookie, demoId, 2)

    const last = await score(cookie, demoIds[5]!, 5)
    expect(await last.json()).toMatchObject({ scored: 6, total: 6, complete: true })
    expect(await countScores(eventId)).toBe(6)
  })

  it('replaces a score rather than adding a second one', async () => {
    // The whole point of the change: a voter can keep adjusting until the
    // organiser closes voting, and adjusting must not accumulate rows.
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    await score(cookie, demoIds[0]!, 1)
    await score(cookie, demoIds[0]!, 5)
    await score(cookie, demoIds[0]!, 3)

    expect(await countScores(eventId)).toBe(1)
    expect(await storedScore(codes[0]!, demoIds[0]!)).toBe(3)
  })

  it('refuses a score outside 1-5, and anything that is not a whole number', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    for (const bad of [0, 6, -1, 2.5, Number.NaN]) {
      const response = await score(cookie, demoIds[0]!, bad)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'BAD_SCORE' })
    }

    // A missing score is refused for the same reason: defaulting it would put a
    // number nobody chose into somebody's ballot.
    const missing = await api('/api/score', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ demoId: demoIds[0] }),
    })
    expect(missing.status).toBe(400)
    expect(await countScores(eventId)).toBe(0)
  })

  /**
   * The reason this project uses D1 rather than KV.
   *
   * Twenty writes for the same demo are dispatched before any of them finishes,
   * so every request observes no existing row. An implementation that checked
   * "has this code scored this demo?" and then inserted would write many rows
   * here and pass every other test in this file. UNIQUE(code, demo_id) is what
   * turns all but one of them into an update.
   */
  it('survives twenty simultaneous writes for one demo', async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => score(cookie, demoIds[0]!, 4)),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(await countScores(eventId)).toBe(1)
    expect(await storedScore(codes[0]!, demoIds[0]!)).toBe(4)
  })

  it('rejects a duplicate insert at the database level', async () => {
    // Proves the guarantee is the UNIQUE index itself, independent of any
    // application logic that might later be refactored around it.
    const { eventId, demoIds, codes } = await seed()
    const code = codes[0]!
    const at = new Date().toISOString()

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        env.DB.prepare(
          `INSERT INTO votes (event_id, demo_id, code, score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(eventId, demoIds[0], code, 3, at, at)
          .run(),
      ),
    )

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await countScores(eventId)).toBe(1)
  })

  it('refuses a score below 1 or above 5 at the database level', async () => {
    // The Worker validates first; this is the backstop for anything that
    // reaches the table another way.
    const { eventId, demoIds, codes } = await seed()
    const at = new Date().toISOString()

    await expect(
      env.DB.prepare(
        `INSERT INTO votes (event_id, demo_id, code, score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(eventId, demoIds[0], codes[0], 9, at, at)
        .run(),
    ).rejects.toThrow()
    expect(await countScores(eventId)).toBe(0)
  })

  /**
   * The limiter is keyed on the code, not on the caller's address: a venue puts
   * the whole room behind one NAT address. It is a ceiling on database work and
   * nothing more, and it sits well above what an indecisive voter produces, so
   * the burst test above keeps reaching the constraint rather than the limit.
   */
  // Given a generous timeout rather than a smaller burst: proving the ceiling
  // exists means clearing it, and the ceiling is 200 a minute.
  it('caps one code hammering the score endpoint', { timeout: 60_000 }, async () => {
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)

    // Twenty at a time rather than 260 at once. The point is to clear the
    // ceiling inside one window, not to see how many sockets miniflare will open
    // before it drops the connection out from under the test.
    const statuses: number[] = []
    for (let sent = 0; sent < 260; sent += 20) {
      const batch = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          score(cookie, demoIds[(sent + index) % demoIds.length]!, ((sent + index) % 5) + 1),
        ),
      )
      statuses.push(...batch.map((response) => response.status))
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
    // However many were refused, the ballot cannot hold more rows than it has
    // demos: the constraint, not the limiter, is what decides that.
    expect(await countScores(eventId)).toBeLessThanOrEqual(demoIds.length)
  })
})

describe('code redemption', () => {
  it('still issues a session to a code that has already scored', async () => {
    // Under one-vote-each this was refused, because the code had spent its
    // vote. A ballot is now editable for the whole window, so refusing here
    // would lock somebody out of scores they are still entitled to change —
    // a dropped cookie would cost them their ballot.
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)
    await scoreAll(cookie, demoIds, 4)

    const again = await redeem(eventId, codes[0]!)
    const ballot = await (await api('/api/ballot', { cookie: again })).json<{
      scored: number
      complete: boolean
    }>()
    expect(ballot).toMatchObject({ scored: 6, complete: true })
  })

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

  it('freezes scores when the organiser closes early', async () => {
    // Closing is what makes a score final. Up to that moment every score on the
    // ballot is provisional, so this is the only line that ends the editing.
    const { eventId, demoIds, codes } = await seed({ closesInSeconds: 2 })
    const cookie = await redeem(eventId, codes[0]!)
    await score(cookie, demoIds[0]!, 2)

    await env.DB.prepare(`UPDATE events SET status = 'closed' WHERE id = ?`).bind(eventId).run()

    const response = await score(cookie, demoIds[0]!, 5)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'VOTING_CLOSED' })
    // The score set while the window was open survives untouched.
    expect(await storedScore(codes[0]!, demoIds[0]!)).toBe(2)
  })
})

describe('authorisation', () => {
  it('rejects a score with no session cookie', async () => {
    const { demoIds } = await seed()
    const response = await api('/api/score', {
      method: 'POST',
      body: JSON.stringify({ demoId: demoIds[0], score: 3 }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'NO_SESSION' })
  })

  it('rejects a forged session cookie', async () => {
    const { eventId, demoIds } = await seed()
    const response = await api('/api/score', {
      method: 'POST',
      cookie: 'dv_voter=eyJ0IjoidiJ9.not-a-real-signature',
      body: JSON.stringify({ demoId: demoIds[0], score: 3 }),
    })
    expect(response.status).toBe(401)
    expect(await countScores(eventId)).toBe(0)
  })

  it('rejects a score for a demo from another event', async () => {
    const other = await seed()
    const target = await seed()
    const cookie = await redeem(target.eventId, target.codes[0]!)

    const response = await score(cookie, other.demoIds[0]!, 4)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'UNKNOWN_DEMO' })
    expect(await countScores(other.eventId)).toBe(0)
  })
})

describe('the tally never leaks to a voter', () => {
  it('keeps everybody else out of every voter-facing payload', async () => {
    const { eventId, demoIds, codes } = await seed({ codeCount: 2 })

    // Put a real ballot on the board so a leak would have something to show.
    const firstCookie = await redeem(eventId, codes[0]!)
    await scoreAll(firstCookie, demoIds, 5)

    const cookie = await redeem(eventId, codes[1]!)
    const payloads = [
      await (await api('/api/ballot', { cookie })).text(),
      await (await score(cookie, demoIds[0]!, 1)).text(),
      await (await api(`/api/event/${eventId}`)).text(),
    ]

    for (const payload of payloads) {
      expect(payload).not.toContain('tally')
      expect(payload).not.toContain('average')
      expect(payload).not.toContain('ballots')
    }

    // The ballot does carry scores — this voter's own, and only theirs. The
    // other ballot scored everything 5 and this one has nothing above 1.
    const own = await (await api('/api/ballot', { cookie })).json<{
      myScores: Record<string, number>
    }>()
    expect(Object.values(own.myScores)).toEqual([1])
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

/**
 * A ballot counts only once it has scored every demo.
 *
 * Scores are saved one at a time as the voter sets them, so a half-finished
 * ballot is the normal state of affairs for most of the window and the database
 * is full of them. Counting those partial rows would hand whichever demos
 * somebody happened to reach before putting their phone away an advantage over
 * the ones they never got to.
 */
describe('only complete ballots count', () => {
  async function revealedTally(eventId: string) {
    await env.DB.prepare(`UPDATE events SET status = 'revealed' WHERE id = ?`).bind(eventId).run()
    return (await api(`/api/results/${eventId}`)).json<{
      ballots: number
      tally: { slot: number; score: number; average: number }[]
    }>()
  }

  it('leaves a partial ballot out of the totals entirely', async () => {
    const { eventId, demoIds, codes } = await seed({ codeCount: 2 })

    const complete = await redeem(eventId, codes[0]!)
    await scoreAll(complete, demoIds, 3)

    // Scores two demos and stops, which is what walking out mid-session looks
    // like from the database's side.
    const partial = await redeem(eventId, codes[1]!)
    await score(partial, demoIds[0]!, 5)
    await score(partial, demoIds[1]!, 5)

    const results = await revealedTally(eventId)
    expect(results.ballots).toBe(1)
    // Not 8. The abandoned 5s would otherwise put demo 1 top on the strength of
    // a ballot that never scored the other four.
    expect(results.tally.every((row) => row.score === 3)).toBe(true)
  })

  it('counts a ballot the moment its last demo is scored', async () => {
    const { eventId, demoIds, codes } = await seed({ codeCount: 1 })
    const cookie = await redeem(eventId, codes[0]!)

    for (const demoId of demoIds.slice(0, 5)) await score(cookie, demoId, 4)
    let results = await revealedTally(eventId)
    expect(results.ballots).toBe(0)
    expect(results.tally.every((row) => row.score === 0)).toBe(true)

    await env.DB.prepare(`UPDATE events SET status = 'open' WHERE id = ?`).bind(eventId).run()
    await score(cookie, demoIds[5]!, 4)

    results = await revealedTally(eventId)
    expect(results.ballots).toBe(1)
    expect(results.tally.every((row) => row.score === 4)).toBe(true)
  })

  it('ranks by total and reports the average alongside it', async () => {
    const { eventId, demoIds, codes } = await seed({ codeCount: 2 })

    for (const code of codes.slice(0, 2)) {
      const cookie = await redeem(eventId, code)
      for (const [index, demoId] of demoIds.entries()) {
        // Demo 1 gets 5s, demo 2 gets 4s, and so on down to demo 5; demo 6
        // shares demo 5's score so there is a tie to place.
        await score(cookie, demoId, Math.max(1, 5 - index))
      }
    }

    const results = await revealedTally(eventId)
    expect(results.ballots).toBe(2)
    expect(results.tally.map((row) => row.slot)).toEqual([1, 2, 3, 4, 5, 6])
    expect(results.tally.map((row) => row.score)).toEqual([10, 8, 6, 4, 2, 2])
    // Two ballots each, so every average is its total halved.
    expect(results.tally.map((row) => row.average)).toEqual([5, 4, 3, 2, 1, 1])
  })
})

describe('one printed QR code, reused across events', () => {
  // The sign on the wall encodes "/" and nothing else. These tests are what
  // let it stay on the wall from one event to the next.

  async function seedEventOnly(
    id: string,
    status: 'draft' | 'open' | 'closed' | 'revealed',
    createdAt: string,
    archived = false,
  ) {
    const closesAt = new Date(Date.now() + 3600_000).toISOString()
    await env.DB.prepare(
      `INSERT INTO events (id, name, status, window_seconds, opened_at, closes_at, created_at, archived_at)
       VALUES (?, ?, ?, 3600, ?, ?, ?, ?)`,
    )
      .bind(id, `Event ${id}`, status, createdAt, closesAt, createdAt, archived ? createdAt : null)
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

  it('skips an archived event even when it would otherwise win', async () => {
    // Archiving is what stops the bare address resolving to last quarter's
    // results forever, and it has to beat the status ordering to do it.
    await seedEventOnly('evt_filed', 'revealed', '2026-03-01T00:00:00.000Z', true)
    await seedEventOnly('evt_kept', 'revealed', '2026-01-01T00:00:00.000Z')
    expect(await currentEventId()).toBe('evt_kept')
  })

  it('resolves to nothing at all when every event is archived', async () => {
    // The landing page then says there is no event, which is true. Falling back
    // to an archived one would undo the filing.
    await seedEventOnly('evt_filed', 'revealed', '2026-01-01T00:00:00.000Z', true)
    const response = await api('/api/current-event')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'EVENT_NOT_FOUND' })
  })

  it('brings an unarchived event back into the reckoning', async () => {
    await seedEventOnly('evt_filed', 'draft', '2026-01-01T00:00:00.000Z', true)
    await env.DB.prepare('UPDATE events SET archived_at = NULL WHERE id = ?')
      .bind('evt_filed')
      .run()
    expect(await currentEventId()).toBe('evt_filed')
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
      scored: number
      complete: boolean
      minScore: number
      maxScore: number
      votingLive: boolean
    }>()

    expect(body.demos.map((demo) => demo.slot)).toEqual([1, 2, 3, 4, 5, 6])
    expect(body.votingLive).toBe(true)
    expect(body.scored).toBe(0)
    expect(body.complete).toBe(false)
    expect([body.minScore, body.maxScore]).toEqual([1, 5])
    expect(body.secondsRemaining).toBeGreaterThan(3500)
  })

  it('hands back the scores already set, so a reload resumes the ballot', async () => {
    // Without this a voter who reloads sees an empty ballot and has no way to
    // tell whether their scores were saved or lost.
    const { eventId, demoIds, codes } = await seed()
    const cookie = await redeem(eventId, codes[0]!)
    await score(cookie, demoIds[0]!, 5)
    await score(cookie, demoIds[2]!, 2)

    const body = await (await api('/api/ballot', { cookie })).json<{
      myScores: Record<string, number>
      scored: number
      complete: boolean
    }>()

    expect(body.myScores).toEqual({ [demoIds[0]!]: 5, [demoIds[2]!]: 2 })
    expect(body).toMatchObject({ scored: 2, complete: false })
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
 * resolves the event from the cookie, so they are shown the ballot they have
 * already filled in and never get to score the event in front of them.
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

  it('lets somebody who scored one event score the other', async () => {
    const first = await seed()
    const second = await seed()

    const firstCookie = await redeem(first.eventId, first.codes[0]!)
    await scoreAll(firstCookie, first.demoIds, 3)

    // Scanning the other event's QR while still holding the first session must
    // not hand back the ballot just filled in.
    const stale = await api(`/api/ballot?eventId=${second.eventId}`, { cookie: firstCookie })
    expect(stale.status).toBe(401)

    const secondCookie = await redeem(second.eventId, second.codes[0]!)
    await scoreAll(secondCookie, second.demoIds, 5)

    expect(await countScores(first.eventId)).toBe(6)
    expect(await countScores(second.eventId)).toBe(6)
  })
})
