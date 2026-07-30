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
  MAX_SCORE,
  MIN_SCORE,
  getCode,
  getCurrentEvent,
  getDb,
  getEvent,
  getScores,
  isValidScore,
  isVotingLive,
  listDemos,
  markActivated,
  saveScore,
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
 *
 * This is also the busiest endpoint of the event, and the reason it has to stay
 * this cheap. Every phone on the vote page polls it for the whole time it is
 * open — including while the event is still a draft, because being opened is the
 * transition somebody waiting at check-in is waiting for. Two hundred phones on
 * one venue wifi is what sets the intervals in app/voteWatch.ts, and one indexed
 * row lookup with no joins and no counting is what makes those intervals
 * affordable. Nothing that scales with the size of the room belongs here.
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
 * POST /api/session — redeem a printed code for a scoring session.
 *
 * Redeeming stays available for the whole voting window, however far along the
 * ballot is. It used to be refused once the code had voted, which made sense
 * when a vote was a single irreversible act; now that scores can be revised
 * until the organiser closes voting, that rule would strand anyone whose phone
 * dropped the cookie — they would be locked out of a ballot they are still
 * entitled to change. Nothing is spent by redeeming twice: the code addresses
 * one set of scores, and a second session overwrites rather than adds.
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
 * GET /api/ballot?eventId=<id> — what this voter is allowed to see.
 *
 * Carries no vote counts of any kind. The tally is organiser-only until the
 * reveal, and leaving it out of this payload is what makes that true: a
 * curious attendee reading the network tab finds nothing to read.
 *
 * `eventId` is the event the caller is actually looking at. It is optional so
 * that an older client still works, but the front end always sends it.
 */
export async function getBallot(request: Request, env: Env): Promise<Response> {
  const secret = env.VOTE_HMAC_KEY
  if (!secret) return fail('NOT_CONFIGURED', 503)

  const session = await currentVoter(request, secret)
  if (!session) return fail('NO_SESSION', 401)

  // A session speaks for exactly one event, so a cookie issued for a different
  // one counts as no cookie at all. Answering it anyway would resolve the event
  // from the cookie and hand somebody who just scanned this event's QR the
  // receipt for a vote they cast in another, with no way to reach this ballot.
  // Two events can be open at the same time; this is what keeps them apart.
  const asked = new URL(request.url).searchParams.get('eventId')
  if (asked && asked !== session.e) return fail('NO_SESSION', 401)

  const db = getDb(env)
  const event = await getEvent(db, session.e)
  if (!event) return fail('EVENT_NOT_FOUND', 404)

  const [demos, myScores] = await Promise.all([listDemos(db, event.id), getScores(db, session.c)])
  const scored = Object.keys(myScores).length

  return json({
    event: { id: event.id, name: event.name, status: event.status },
    votingLive: isVotingLive(event),
    closesAt: event.closesAt,
    secondsRemaining: secondsRemaining(event),
    minScore: MIN_SCORE,
    maxScore: MAX_SCORE,
    // This voter's own scores, so a phone that reloads mid-ballot comes back
    // showing what they already set rather than an empty one.
    myScores,
    scored,
    // A ballot only counts once every demo has a score, so the phone needs to
    // know both halves of that fraction to say so.
    complete: scored >= demos.length,
    demos: demos.map((demo) => ({
      id: demo.id,
      slot: demo.slot,
      name: demo.name,
      team: demo.team,
      blurb: demo.blurb,
    })),
  })
}

/**
 * POST /api/score — set this ballot's score for one demo.
 *
 * Called once per adjustment rather than once per ballot: the phone saves each
 * score as the voter sets it, and sends the same demo again whenever they change
 * their mind. Writing is therefore idempotent by design, and the response
 * carries the ballot's progress so the phone can show how many demos are left
 * without asking a second question.
 */
export async function postScore(request: Request, env: Env): Promise<Response> {
  const secret = env.VOTE_HMAC_KEY
  if (!secret) return fail('NOT_CONFIGURED', 503)

  const session = await currentVoter(request, secret)
  if (!session) return fail('NO_SESSION', 401)

  // Keyed on the code rather than the address it arrived from: the whole room is
  // behind one venue IP. See wrangler.toml — the ceiling is sized for a person
  // changing their mind, not for a person voting once.
  const allowed = await env.VOTE_RATE_LIMITER.limit({ key: session.c })
  if (!allowed.success) return fail('RATE_LIMITED', 429)

  const body = await readJson<{ demoId?: string; score?: number }>(request)
  if (!body?.demoId) return fail('BAD_REQUEST', 400)
  if (!isValidScore(body.score)) return fail('BAD_SCORE', 400)

  const db = getDb(env)
  const event = await getEvent(db, session.e)
  if (!event) return fail('EVENT_NOT_FOUND', 404)
  // Re-checked here rather than trusted from the cookie: the organiser may have
  // closed voting early, after this session was issued. This is also the line
  // that makes scores final — up to it they are revisable, past it they are not.
  if (!isVotingLive(event)) return fail('VOTING_CLOSED', 409)

  const demos = await listDemos(db, event.id)
  const demo = demos.find((candidate) => candidate.id === body.demoId)
  if (!demo) return fail('UNKNOWN_DEMO', 400)

  const progress = await saveScore(
    db,
    { eventId: event.id, demoId: demo.id, code: session.c, score: body.score },
    demos.length,
  )

  // The voter's own score and their own progress. Still nothing about anybody
  // else's ballot, and still no tally.
  return json({ ok: true, demoId: demo.id, score: body.score, ...progress })
}
