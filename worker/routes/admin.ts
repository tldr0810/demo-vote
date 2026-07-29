import { eq } from 'drizzle-orm'
import { demos, events } from '../../db/schema'
import {
  ADMIN_COOKIE,
  buildCookie,
  checkAdminPassword,
  clearCookie,
  isSecureRequest,
  readCookie,
  signSession,
  verifySession,
  type AdminSession,
} from '../auth'
import { codesToCsv, generateCodeBatch } from '../codes'
import {
  EMPTY_CODE_STATS,
  getAllCodeStatsByEvent,
  getAllDemosByEvent,
  getCodeStats,
  getDb,
  getEvent,
  getTally,
  insertCodes,
  isVotingLive,
  listCodes,
  listDemos,
  listEvents,
  newId,
  nowIso,
  secondsRemaining,
  type Db,
} from '../data'
import { clientIp, fail, json, readJson } from '../http'

const ADMIN_SESSION_SECONDS = 12 * 60 * 60 // one long event day

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.VOTE_HMAC_KEY) return fail('NOT_CONFIGURED', 503)
  const session = await verifySession<AdminSession>(
    readCookie(request, ADMIN_COOKIE),
    env.VOTE_HMAC_KEY,
    'a',
  )
  return session ? null : fail('ADMIN_REQUIRED', 401)
}

export async function postAdminSession(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD || !env.VOTE_HMAC_KEY) return fail('NOT_CONFIGURED', 503)

  const allowed = await env.ADMIN_RATE_LIMITER.limit({ key: clientIp(request) })
  if (!allowed.success) return fail('RATE_LIMITED', 429)

  const body = await readJson<{ password?: string }>(request)
  if (typeof body?.password !== 'string') return fail('BAD_REQUEST', 400)
  if (!(await checkAdminPassword(body.password, env.ADMIN_PASSWORD))) {
    return fail('BAD_PASSWORD', 401)
  }

  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS
  const token = await signSession({ t: 'a', exp }, env.VOTE_HMAC_KEY)
  return json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': buildCookie(
          ADMIN_COOKIE,
          token,
          ADMIN_SESSION_SECONDS,
          isSecureRequest(request),
        ),
      },
    },
  )
}

export function deleteAdminSession(request: Request): Response {
  return json(
    { ok: true },
    { headers: { 'Set-Cookie': clearCookie(ADMIN_COOKIE, isSecureRequest(request)) } },
  )
}

/** GET /api/admin/state — everything the dashboard shell needs on load. */
export async function getAdminState(request: Request, env: Env): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const db = getDb(env)
  // Three queries total, whatever the event count.
  const [rows, demosByEvent, statsByEvent] = await Promise.all([
    listEvents(db),
    getAllDemosByEvent(db),
    getAllCodeStatsByEvent(db),
  ])

  return json({
    ok: true,
    events: rows.map((event) => ({
      ...event,
      votingLive: isVotingLive(event),
      secondsRemaining: secondsRemaining(event),
      demos: demosByEvent.get(event.id) ?? [],
      stats: statsByEvent.get(event.id) ?? EMPTY_CODE_STATS,
    })),
  })
}

type DemoInput = { slot: number; name: string; team?: string; blurb?: string }

function parseDemoInputs(raw: unknown): DemoInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: DemoInput[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const { slot, name, team, blurb } = item as Record<string, unknown>
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1) return null
    if (typeof name !== 'string' || name.trim() === '') return null
    out.push({
      slot,
      name: name.trim(),
      team: typeof team === 'string' ? team.trim() : '',
      blurb: typeof blurb === 'string' ? blurb.trim() : '',
    })
  }
  if (new Set(out.map((demo) => demo.slot)).size !== out.length) return null
  return out
}

async function replaceDemos(db: Db, eventId: string, inputs: DemoInput[]) {
  await db.delete(demos).where(eq(demos.eventId, eventId))
  await db.insert(demos).values(
    inputs.map((input) => ({
      id: newId('dmo'),
      eventId,
      slot: input.slot,
      name: input.name,
      team: input.team ?? '',
      blurb: input.blurb ?? '',
    })),
  )
}

export async function postAdminEvent(request: Request, env: Env): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const body = await readJson<{ name?: string; windowSeconds?: number; demos?: unknown }>(request)
  if (typeof body?.name !== 'string' || body.name.trim() === '') return fail('BAD_REQUEST', 400)

  const demoInputs = parseDemoInputs(body.demos)
  if (!demoInputs) return fail('BAD_REQUEST', 400)

  const windowSeconds =
    typeof body.windowSeconds === 'number' && body.windowSeconds > 0
      ? Math.floor(body.windowSeconds)
      : 3600

  const db = getDb(env)
  const id = newId('evt')
  await db.insert(events).values({
    id,
    name: body.name.trim(),
    status: 'draft',
    windowSeconds,
    createdAt: nowIso(),
  })
  await replaceDemos(db, id, demoInputs)

  return json({ ok: true, eventId: id }, { status: 201 })
}

export async function putAdminEvent(
  request: Request,
  env: Env,
  eventId: string,
): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const db = getDb(env)
  const event = await getEvent(db, eventId)
  if (!event) return fail('EVENT_NOT_FOUND', 404)

  const body = await readJson<{ name?: string; windowSeconds?: number; demos?: unknown }>(request)
  if (!body) return fail('BAD_REQUEST', 400)

  const patch: Partial<typeof events.$inferInsert> = {}
  if (typeof body.name === 'string' && body.name.trim() !== '') patch.name = body.name.trim()
  if (typeof body.windowSeconds === 'number' && body.windowSeconds > 0) {
    // Only meaningful before opening. closesAt is frozen at open time, so this
    // cannot extend a window that is already running.
    patch.windowSeconds = Math.floor(body.windowSeconds)
  }
  if (Object.keys(patch).length > 0) {
    await db.update(events).set(patch).where(eq(events.id, eventId))
  }

  if (body.demos !== undefined) {
    // Renaming a demo after votes exist would silently relabel ballots people
    // already cast, so the roster is frozen once voting starts.
    if (event.status !== 'draft') return fail('INVALID_TRANSITION', 409)
    const demoInputs = parseDemoInputs(body.demos)
    if (!demoInputs) return fail('BAD_REQUEST', 400)
    await replaceDemos(db, eventId, demoInputs)
  }

  return json({ ok: true })
}

export async function postCodes(request: Request, env: Env, eventId: string): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const db = getDb(env)
  const event = await getEvent(db, eventId)
  if (!event) return fail('EVENT_NOT_FOUND', 404)

  const body = await readJson<{ count?: number }>(request)
  const count = typeof body?.count === 'number' ? Math.floor(body.count) : 0
  // No default batch size: the organiser knows their attendee count and an
  // accidental extra zero would print 5000 slips.
  if (count < 1 || count > 5000) return fail('BAD_REQUEST', 400)

  const batch = `b${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`
  const generated = generateCodeBatch(count)
  await insertCodes(db, eventId, batch, generated)

  return json({ ok: true, batch, count: generated.length, codes: generated }, { status: 201 })
}

export async function getCodesCsv(request: Request, env: Env, eventId: string): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const rows = await listCodes(getDb(env), eventId)
  return new Response(codesToCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="codes-${eventId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: ['revealed'],
  // Terminal. Re-opening after a reveal would let someone vote knowing the
  // standings.
  revealed: [],
}

export async function postAdminStatus(
  request: Request,
  env: Env,
  eventId: string,
): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const body = await readJson<{ status?: string }>(request)
  const next = body?.status
  if (next !== 'open' && next !== 'closed' && next !== 'revealed') return fail('BAD_REQUEST', 400)

  const db = getDb(env)
  const event = await getEvent(db, eventId)
  if (!event) return fail('EVENT_NOT_FOUND', 404)
  if (!ALLOWED_TRANSITIONS[event.status]?.includes(next)) return fail('INVALID_TRANSITION', 409)

  if (next === 'open') {
    const demoRows = await listDemos(db, eventId)
    if (demoRows.length === 0) return fail('BAD_REQUEST', 400)
    const openedAt = new Date()
    const closesAt = new Date(openedAt.getTime() + event.windowSeconds * 1000)
    await db
      .update(events)
      .set({
        status: 'open',
        openedAt: openedAt.toISOString(),
        // Frozen now. Everything downstream compares against this instant, so
        // the deadline cannot drift once the room starts voting.
        closesAt: closesAt.toISOString(),
      })
      .where(eq(events.id, eventId))
  } else {
    await db.update(events).set({ status: next }).where(eq(events.id, eventId))
  }

  const updated = await getEvent(db, eventId)
  return json({ ok: true, event: updated })
}

export async function getAdminResults(
  request: Request,
  env: Env,
  eventId: string,
): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const db = getDb(env)
  const event = await getEvent(db, eventId)
  if (!event) return fail('EVENT_NOT_FOUND', 404)

  const [tally, stats] = await Promise.all([getTally(db, eventId), getCodeStats(db, eventId)])
  return json({
    ok: true,
    event: { id: event.id, name: event.name, status: event.status },
    votingLive: isVotingLive(event),
    secondsRemaining: secondsRemaining(event),
    stats,
    tally,
  })
}

/**
 * GET /api/results/:id — the big screen.
 *
 * Same tally, no cookie required, but only after the organiser presses reveal.
 * Before that this is a 403, which is what keeps the standings off an
 * attendee's phone while voting is still running.
 */
export async function getPublicResults(env: Env, eventId: string): Promise<Response> {
  const db = getDb(env)
  const event = await getEvent(db, eventId)
  if (!event) return fail('EVENT_NOT_FOUND', 404)
  if (event.status !== 'revealed') return fail('ADMIN_REQUIRED', 403)

  return json({
    ok: true,
    event: { id: event.id, name: event.name, status: event.status },
    tally: await getTally(db, eventId),
  })
}
