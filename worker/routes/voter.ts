import {
  VOTER_COOKIE,
  buildCookie,
  isSecureRequest,
  readCookie,
  signSession,
  verifySession,
  type VoterSession,
} from '../auth'
import { isValidCodeFormat, normalizeCode } from '../codes'
import {
  castVote,
  getCode,
  getCurrentEvent,
  getDb,
  getEvent,
  hasVoted,
  isVotingLive,
  listDemos,
  markActivated,
  secondsRemaining,
} from '../data'
import { clientIp, fail, json, readJson } from '../http'

/** Resolves the signed voter session, or null. */
async function currentVoter(request: Request, secret: string): Promise<VoterSession | null> {
  return verifySession<VoterSession>(readCookie(request, VOTER_COOKIE), secret, 'v')
}

/**
 * GET /api/event/:id and GET /api/current-event — the little that an attendee
 * may see before redeeming a code: which event this is, and whether it is
 * accepting votes. No demo list, no counts.
 *
 * `/api/current-event` exists so a QR code can point at the bare origin and
 * still reach the right ballot, which matters when the code is printed before
 * the event id is known.
 */
export async function getPublicEvent(
  _request: Request,
  env: Env,
  eventId?: string,
): Promise<Response> {
  const db = getDb(env)
  const event = eventId ? await getEvent(db, eventId) : await getCurrentEvent(db)
  if (!event) return fail('EVENT_NOT_FOUND', 404)

  return json({
    id: event.id,
    name: event.name,
    status: event.status,
    votingLive: isVotingLive(event),
    secondsRemaining: secondsRemaining(event),
  })
}

/**
 * POST /api/session — redeem a printed code for a voting session.
 *
 * Redeeming is idempotent while the code is unused: someone who closes the tab
 * can re-enter the same code and get a fresh cookie. It stops working the
 * moment a vote is recorded.
 */
export async function postSession(request: Request, env: Env): Promise<Response> {
  const secret = env.VOTE_HMAC_KEY
  if (!secret) return fail('NOT_CONFIGURED', 503)

  const allowed = await env.SESSION_RATE_LIMITER.limit({ key: clientIp(request) })
  if (!allowed.success) return fail('RATE_LIMITED', 429)

  const body = await readJson<{ eventId?: string; code?: string }>(request)
  if (!body?.eventId || typeof body.code !== 'string') return fail('BAD_REQUEST', 400)

  const code = normalizeCode(body.code)
  // A malformed code and an unknown code return the same thing. Distinguishing
  // them would let someone probe which codes exist without redeeming any.
  if (!isValidCodeFormat(code)) return fail('INVALID_CODE', 401)

  const db = getDb(env)
  const event = await getEvent(db, body.eventId)
  if (!event) return fail('EVENT_NOT_FOUND', 404)
  if (event.status === 'draft') return fail('VOTING_NOT_OPEN', 409)
  if (!isVotingLive(event)) return fail('VOTING_CLOSED', 409)

  const row = await getCode(db, code, event.id)
  if (!row) return fail('INVALID_CODE', 401)
  if (row.usedAt) return fail('CODE_ALREADY_USED', 409)

  await markActivated(db, code)

  // The session dies with the voting window, never after it. A cookie cannot
  // outlive the deadline it was issued under.
  const expiresAt = Math.floor(Date.parse(event.closesAt!) / 1000)
  const token = await signSession({ t: 'v', c: code, e: event.id, exp: expiresAt }, secret)
  const maxAge = Math.max(1, expiresAt - Math.floor(Date.now() / 1000))

  return json(
    { ok: true, eventId: event.id, closesAt: event.closesAt },
    {
      headers: {
        'Set-Cookie': buildCookie(VOTER_COOKIE, token, maxAge, isSecureRequest(request)),
      },
    },
  )
}

/**
 * GET /api/ballot — what this voter is allowed to see.
 *
 * Carries no vote counts of any kind. The tally is organiser-only until the
 * reveal, and leaving it out of this payload is what makes that true: a
 * curious attendee reading the network tab finds nothing to read.
 */
export async function getBallot(request: Request, env: Env): Promise<Response> {
  const secret = env.VOTE_HMAC_KEY
  if (!secret) return fail('NOT_CONFIGURED', 503)

  const session = await currentVoter(request, secret)
  if (!session) return fail('NO_SESSION', 401)

  const db = getDb(env)
  const event = await getEvent(db, session.e)
  if (!event) return fail('EVENT_NOT_FOUND', 404)

  const [demos, voted] = await Promise.all([listDemos(db, event.id), hasVoted(db, session.c)])

  return json({
    event: { id: event.id, name: event.name, status: event.status },
    votingLive: isVotingLive(event),
    closesAt: event.closesAt,
    secondsRemaining: secondsRemaining(event),
    hasVoted: voted,
    demos: demos.map((demo) => ({
      id: demo.id,
      slot: demo.slot,
      name: demo.name,
      team: demo.team,
      blurb: demo.blurb,
    })),
  })
}

/** POST /api/vote — cast the one ballot this code is entitled to. */
export async function postVote(request: Request, env: Env): Promise<Response> {
  const secret = env.VOTE_HMAC_KEY
  if (!secret) return fail('NOT_CONFIGURED', 503)

  const session = await currentVoter(request, secret)
  if (!session) return fail('NO_SESSION', 401)

  const body = await readJson<{ demoId?: string }>(request)
  if (!body?.demoId) return fail('BAD_REQUEST', 400)

  const db = getDb(env)
  const event = await getEvent(db, session.e)
  if (!event) return fail('EVENT_NOT_FOUND', 404)
  // Re-checked here rather than trusted from the cookie: the organiser may have
  // closed voting early, after this session was issued.
  if (!isVotingLive(event)) return fail('VOTING_CLOSED', 409)

  const demos = await listDemos(db, event.id)
  const demo = demos.find((candidate) => candidate.id === body.demoId)
  if (!demo) return fail('UNKNOWN_DEMO', 400)

  const result = await castVote(db, { eventId: event.id, demoId: demo.id, code: session.c })
  if (result === 'duplicate') return fail('ALREADY_VOTED', 409)

  // Confirms the choice back to the voter and nothing else — still no counts.
  return json({ ok: true, demoId: demo.id, demoName: demo.name })
}
