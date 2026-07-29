import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { codes, demos, events, votes, type DemoRow, type EventRow } from '../db/schema'

export type Db = DrizzleD1Database<typeof schema>

export function getDb(env: Env): Db {
  return drizzle(env.DB, { schema })
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

// ---------------------------------------------------------------- events

export async function getEvent(db: Db, eventId: string) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  return row ?? null
}

/**
 * The event the landing page sends people to when the URL carries no id.
 *
 * This is the fallback, not the path the room takes. Voters scan a per-event QR
 * encoding /v/<eventId>, and both voting endpoints resolve the event from the
 * session rather than from here, so this only decides what somebody sees after
 * typing the bare address.
 *
 * The ordering still has to be right and is still easy to get wrong. A finished
 * event must rank BELOW one that is merely being set up, or the bare address
 * shows last quarter's results while this quarter's is being prepared. Live
 * first, then the one being prepared, then the most recent leftover so the page
 * can still say something sensible when nothing is scheduled.
 * tests/voting.test.ts guards it.
 *
 * Archived events are excluded outright. Filing an event away is the organiser
 * saying it is finished with, and the bare address returning nothing at all is
 * the correct answer when everything has been filed: the landing page then says
 * there is no event, which is true.
 */
export async function getCurrentEvent(db: Db) {
  const rows = await db
    .select()
    .from(events)
    .where(isNull(events.archivedAt))
    .orderBy(
      sql`case ${events.status}
            when 'open'  then 0
            when 'draft' then 1
            when 'closed' then 2
            else 3
          end`,
      sql`${events.createdAt} desc`,
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Every event, archived ones included.
 *
 * The organiser's own list is the one place archived events still have to be
 * reachable, otherwise filing one away would be indistinguishable from deleting
 * it. The dashboard hides them behind a toggle.
 */
export async function listEvents(db: Db) {
  return db.select().from(events).orderBy(sql`${events.createdAt} desc`)
}

/** Files a finished event away, or takes it back out. */
export async function setArchived(db: Db, eventId: string, archived: boolean) {
  await db
    .update(events)
    .set({ archivedAt: archived ? nowIso() : null })
    .where(eq(events.id, eventId))
}

/**
 * True when a ballot may be cast right now.
 *
 * Both halves matter: `status` is the organiser's explicit control and
 * `closesAt` is the clock. Relying on status alone would keep voting open past
 * the deadline whenever nobody presses the close button, which during a live
 * event is exactly what happens.
 */
export function isVotingLive(event: EventRow, at: Date = new Date()): boolean {
  if (event.status !== 'open') return false
  if (!event.closesAt) return false
  return at.getTime() < Date.parse(event.closesAt)
}

export function secondsRemaining(event: EventRow, at: Date = new Date()): number {
  if (!event.closesAt) return 0
  return Math.max(0, Math.ceil((Date.parse(event.closesAt) - at.getTime()) / 1000))
}

// ----------------------------------------------------------------- demos

export async function listDemos(db: Db, eventId: string) {
  return db.select().from(demos).where(eq(demos.eventId, eventId)).orderBy(asc(demos.slot))
}

// ----------------------------------------------------------------- codes

export async function getCode(db: Db, code: string, eventId: string) {
  const [row] = await db
    .select()
    .from(codes)
    .where(and(eq(codes.code, code), eq(codes.eventId, eventId)))
    .limit(1)
  return row ?? null
}

/** Stamps first redemption. Only ever written once, and never gates a vote. */
export async function markActivated(db: Db, code: string) {
  await db
    .update(codes)
    .set({ activatedAt: nowIso() })
    .where(and(eq(codes.code, code), isNull(codes.activatedAt)))
}

export async function insertCodes(
  db: Db,
  eventId: string,
  batch: string,
  values: string[],
): Promise<void> {
  const createdAt = nowIso()
  const rows = values.map((code) => ({ code, eventId, batch, createdAt }))
  // D1 allows at most 100 bound parameters per statement. Each row binds four
  // columns, so 20 rows leaves headroom while still keeping a 500-slip batch to
  // 25 round trips.
  const ROWS_PER_STATEMENT = 20
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    await db.insert(codes).values(rows.slice(i, i + ROWS_PER_STATEMENT))
  }
}

export async function listCodes(db: Db, eventId: string) {
  return db.select().from(codes).where(eq(codes.eventId, eventId)).orderBy(asc(codes.code))
}

// ----------------------------------------------------------------- votes

export type CastVoteResult = 'recorded' | 'duplicate'

/**
 * Records one ballot.
 *
 * The INSERT and the codes.usedAt stamp go through `db.batch`, which D1 runs as
 * a single transaction: if the UNIQUE index on votes.code rejects the insert,
 * the stamp rolls back with it and the row cannot end up marked used without a
 * matching vote.
 *
 * There is no "check whether this code already voted" step on purpose. Any such
 * check is a read followed by a write, and two concurrent requests can both
 * pass the read. The constraint is what decides, and losing that race returns
 * 'duplicate' rather than throwing.
 */
export async function castVote(
  db: Db,
  input: { eventId: string; demoId: string; code: string },
): Promise<CastVoteResult> {
  const at = nowIso()
  try {
    await db.batch([
      db.insert(votes).values({ ...input, createdAt: at }),
      db.update(codes).set({ usedAt: at }).where(eq(codes.code, input.code)),
    ])
    return 'recorded'
  } catch (error) {
    if (isUniqueViolationMessage(error)) return 'duplicate'
    throw error
  }
}

/**
 * D1 surfaces constraint violations as an opaque Error whose message carries the
 * SQLite text. Losing a race on votes.code is expected behaviour, not a fault,
 * so it has to be distinguishable from a real database failure.
 */
function isUniqueViolationMessage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('UNIQUE constraint failed')
}

export async function hasVoted(db: Db, code: string): Promise<boolean> {
  const [row] = await db.select({ id: votes.id }).from(votes).where(eq(votes.code, code)).limit(1)
  return row !== undefined
}

export type Tally = {
  demoId: string
  slot: number
  name: string
  team: string
  votes: number
}

/**
 * Vote counts for every demo, including demos with zero votes. Sorted by count
 * desc, then slot asc so a tie renders in a stable order instead of shuffling
 * on each dashboard poll.
 */
export async function getTally(db: Db, eventId: string): Promise<Tally[]> {
  const rows = await db
    .select({
      demoId: demos.id,
      slot: demos.slot,
      name: demos.name,
      team: demos.team,
      votes: sql<number>`count(${votes.id})`,
    })
    .from(demos)
    .leftJoin(votes, eq(votes.demoId, demos.id))
    .where(eq(demos.eventId, eventId))
    .groupBy(demos.id)
    .orderBy(sql`count(${votes.id}) desc`, asc(demos.slot))
  return rows.map((row) => ({ ...row, votes: Number(row.votes) }))
}

export type CodeStats = { issued: number; activated: number; voted: number }

/**
 * Demos and code counts for every event in two queries rather than two per
 * event. The dashboard lists the full history, so a per-event loop turns into
 * forty round trips by the twentieth time this tool gets used.
 */
export async function getAllDemosByEvent(db: Db): Promise<Map<string, DemoRow[]>> {
  const rows = await db.select().from(demos).orderBy(asc(demos.slot))
  const grouped = new Map<string, DemoRow[]>()
  for (const row of rows) {
    const bucket = grouped.get(row.eventId)
    if (bucket) bucket.push(row)
    else grouped.set(row.eventId, [row])
  }
  return grouped
}

export async function getAllCodeStatsByEvent(db: Db): Promise<Map<string, CodeStats>> {
  const rows = await db
    .select({
      eventId: codes.eventId,
      issued: sql<number>`count(*)`,
      activated: sql<number>`sum(case when ${codes.activatedAt} is null then 0 else 1 end)`,
      voted: sql<number>`sum(case when ${codes.usedAt} is null then 0 else 1 end)`,
    })
    .from(codes)
    .groupBy(codes.eventId)

  return new Map(
    rows.map((row) => [
      row.eventId,
      {
        issued: Number(row.issued ?? 0),
        activated: Number(row.activated ?? 0),
        voted: Number(row.voted ?? 0),
      },
    ]),
  )
}

export const EMPTY_CODE_STATS: CodeStats = { issued: 0, activated: 0, voted: 0 }

export async function getCodeStats(db: Db, eventId: string): Promise<CodeStats> {
  const [row] = await db
    .select({
      issued: sql<number>`count(*)`,
      activated: sql<number>`sum(case when ${codes.activatedAt} is null then 0 else 1 end)`,
      voted: sql<number>`sum(case when ${codes.usedAt} is null then 0 else 1 end)`,
    })
    .from(codes)
    .where(eq(codes.eventId, eventId))
  return {
    issued: Number(row?.issued ?? 0),
    activated: Number(row?.activated ?? 0),
    voted: Number(row?.voted ?? 0),
  }
}
