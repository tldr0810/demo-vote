import {
  deleteAdminSession,
  getAdminResults,
  getAdminState,
  getCodesCsv,
  getPublicResults,
  postAdminArchive,
  postAdminEvent,
  postAdminSession,
  postAdminStatus,
  postCodes,
  putAdminEvent,
} from './routes/admin'
import { getBallot, getPublicEvent, postSession, postVote } from './routes/voter'
import { fail, json } from './http'

/**
 * Demo Vote — live audience voting.
 *
 * The Worker owns every /api/* path; everything else is the React SPA, served
 * by the ASSETS binding with single-page-application not-found handling so a
 * refresh on /admin or /v/<id> still resolves.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    try {
      // Routes reject unauthenticated requests before parsing their body, on
      // purpose: untrusted input should not be deserialised ahead of the auth
      // check. workerd logs an info-level notice for a request body left
      // unread, which is the expected shape of a 401 here.
      return await route(request, env, url)
    } catch (error) {
      // Never leak a stack trace or SQL text to a browser mid-event.
      console.error('unhandled', error)
      return fail('INTERNAL', 500)
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method

  if (pathname === '/api/health' && method === 'GET') {
    // Actually asks the database. A health check that only reads its own
    // configuration answers "ok" from a deployment whose D1 binding points at
    // nothing, which is the one failure that cannot be discovered later: by the
    // time anybody notices, the room is holding printed slips for an event that
    // cannot be created. The query is the cheapest one that proves a round trip.
    let database = false
    try {
      await env.DB.prepare('select 1').first()
      database = true
    } catch (error) {
      console.error('health: database unreachable', error)
    }

    return json({
      ok: database && Boolean(env.ADMIN_PASSWORD) && Boolean(env.VOTE_HMAC_KEY),
      database,
      // Surfaced so a fresh deployment can tell "misconfigured" from "broken"
      // without exposing the values themselves.
      configured: { adminPassword: Boolean(env.ADMIN_PASSWORD), hmacKey: Boolean(env.VOTE_HMAC_KEY) },
    })
  }

  // ---- voter ----
  if (pathname === '/api/current-event' && method === 'GET') return getPublicEvent(request, env)
  if (pathname === '/api/session' && method === 'POST') return postSession(request, env)
  if (pathname === '/api/ballot' && method === 'GET') return getBallot(request, env)
  if (pathname === '/api/vote' && method === 'POST') return postVote(request, env)

  const publicEvent = match(pathname, '/api/event/')
  if (publicEvent && method === 'GET') return getPublicEvent(request, env, publicEvent)

  // Readable without an admin cookie, but only once the organiser has pressed
  // reveal. This is what the big screen uses.
  const publicResults = match(pathname, '/api/results/')
  if (publicResults && method === 'GET') return getPublicResults(env, publicResults)

  // ---- organiser ----
  if (pathname === '/api/admin/session') {
    if (method === 'POST') return postAdminSession(request, env)
    if (method === 'DELETE') return deleteAdminSession(request)
  }
  if (pathname === '/api/admin/state' && method === 'GET') return getAdminState(request, env)
  if (pathname === '/api/admin/event' && method === 'POST') return postAdminEvent(request, env)

  const adminEvent = match(pathname, '/api/admin/event/')
  if (adminEvent) {
    const [eventId, action] = adminEvent.split('/')
    if (!eventId) return fail('NOT_FOUND', 404)
    if (!action && method === 'PUT') return putAdminEvent(request, env, eventId)
    if (action === 'codes' && method === 'POST') return postCodes(request, env, eventId)
    if (action === 'codes.csv' && method === 'GET') return getCodesCsv(request, env, eventId)
    if (action === 'status' && method === 'POST') return postAdminStatus(request, env, eventId)
    if (action === 'archive' && method === 'POST') return postAdminArchive(request, env, eventId)
    if (action === 'results' && method === 'GET') return getAdminResults(request, env, eventId)
  }

  return fail('NOT_FOUND', 404)
}

/** Returns the remainder after `prefix`, or null when the path does not match. */
function match(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  return rest.length > 0 ? rest : null
}
