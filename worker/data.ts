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

// ---------------------------------------------------------------- scores

export const MIN_SCORE = 1
export const MAX_SCORE = 5

export function isValidScore(candidate: unknown): candidate is number {
  return (
    typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= MIN_SCORE &&
    candidate <= MAX_SCORE
  )
}

export type SaveScoreResult = { scored: number; total: number; complete: boolean }

/**
 * Writes one demo's score for one ballot, and reports how far along that ballot
 * now is.
 *
 * An UPSERT rather than an INSERT, because a score is revisable: the voter can
 * drag it up and down until the organiser closes voting, and every one of those
 * changes lands here. UNIQUE(code, demo_id) is what turns the second write into
 * an update instead of a second row, which also means a double-tapped button
 * cannot score the same demo twice.
 *
 * The codes.usedAt stamp that follows is deliberately not in a transaction with
 * the write. It is only a dashboard counter, and what decides whether this
 * ballot counts towards the tally is recomputed in getTally from the votes rows
 * themselves — so a stamp that fails to land costs the organiser one number on a
 * screen that refreshes every two seconds, and costs the voter nothing.
 */
export async function saveScore(
  db: Db,
  input: { eventId: string; demoId: string; code: string; score: number },
  demoCount: number,
): Promise<SaveScoreResult> {
  const at = nowIso()

  await db
    .insert(votes)
    .values({ ...input, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: [votes.code, votes.demoId],
      set: { score: input.score, updatedAt: at },
    })

  const scored = await countScored(db, input.code)
  const complete = scored >= demoCount

  // Stamped every time the ballot is complete, not only the first: the value is
  // read as "when this person last touched a finished ballot", which is the more
  // useful of the two for an organiser watching the room.
  await db
    .update(codes)
    .set({ usedAt: complete ? at : null })
    .where(eq(codes.code, input.code))

  return { scored, total: demoCount, complete }
}

export async function countScored(db: Db, code: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(votes)
    .where(eq(votes.code, code))
  return Number(row?.n ?? 0)
}

/** This ballot's own scores, keyed by demo. Never anybody else's. */
export async function getScores(db: Db, code: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ demoId: votes.demoId, score: votes.score })
    .from(votes)
    .where(eq(votes.code, code))
  return Object.fromEntries(rows.map((row) => [row.demoId, Number(row.score)]))
}

// ----------------------------------------------------------------- tally

export type Tally = {
  demoId: string
  slot: number
  name: string
  team: string
  /** Sum of the scores this demo received, over complete ballots only. */
  score: number
  /** Average out of 5, to one decimal place. Zero when nothing counted yet. */
  average: number
}

export type TallyResult = { rows: Tally[]; ballots: number }

/**
 * The standings, counting only ballots that scored every demo.
 *
 * Partial ballots are stored — the voter's phone saves each score as they set
 * it, so a half-finished ballot is the normal state of affairs for most of the
 * voting window — but they must not be counted. Someone who scored two demos
 * and put their phone away would otherwise hand those two an advantage over the
 * four they never reached, which is the one way a sum can be unfair here.
 *
 * Because every counted ballot scored every demo, each demo has exactly the same
 * number of raters, so ranking by sum and ranking by average give the same
 * order. The sum is the headline and the average is the readable one; both are
 * returned so no screen has to derive one from the other and get it wrong.
 */
export async function getTally(
  db: Db,
  eventId: string,
  demoCount: number,
): Promise<TallyResult> {
  // Recomputed here rather than read from codes.usedAt. The stamp is written by
  // the request that completed a ballot; this is derived from the rows
  // themselves, so a tally can never be thrown off by a stamp that failed to
  // land or by a demo roster that changed underneath one.
  const completeBallots = sql`(
    select ${votes.code} from ${votes}
    where ${votes.eventId} = ${eventId}
    group by ${votes.code}
    having count(*) >= ${demoCount}
  )`

  const rows = await db
    .select({
      demoId: demos.id,
      slot: demos.slot,
      name: demos.name,
      team: demos.team,
      score: sql<number>`coalesce(sum(${votes.score}), 0)`,
      raters: sql<number>`count(${votes.id})`,
    })
    .from(demos)
    .leftJoin(
      votes,
      and(eq(votes.demoId, demos.id), sql`${votes.code} in ${completeBallots}`),
    )
    .where(eq(demos.eventId, eventId))
    .groupBy(demos.id)
    // Sorted by score desc then slot asc so a tie renders in a stable order
    // instead of shuffling on each dashboard poll. That makes the order a total
    // one, which is right for laying rows out and wrong for labelling them —
    // see app/ranking.ts.
    .orderBy(sql`coalesce(sum(${votes.score}), 0) desc`, asc(demos.slot))

  // Identical across rows by construction, but taken as the max rather than
  // from rows[0] so an event with no demos still answers zero.
  const ballots = rows.reduce((most, row) => Math.max(most, Number(row.raters)), 0)

  return {
    ballots,
    rows: rows.map((row) => {
      const score = Number(row.score)
      const raters = Number(row.raters)
      return {
        demoId: row.demoId,
        slot: row.slot,
        name: row.name,
        team: row.team,
        score,
        average: raters > 0 ? Math.round((score / raters) * 10) / 10 : 0,
      }
    }),
  }
}

/**
 * `scored` counts complete ballots — codes carrying a score for every demo.
 * The gap between `activated` and `scored` is the number of people who scanned
 * in, started scoring, and did not finish, which is the one number an organiser
 * can still act on while the window is open.
 */
export type CodeStats = { issued: number; activated: number; scored: number }

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
      scored: sql<number>`sum(case when ${codes.usedAt} is null then 0 else 1 end)`,
    })
    .from(codes)
    .groupBy(codes.eventId)

  return new Map(
    rows.map((row) => [
      row.eventId,
      {
        issued: Number(row.issued ?? 0),
        activated: Number(row.activated ?? 0),
        scored: Number(row.scored ?? 0),
      },
    ]),
  )
}

export const EMPTY_CODE_STATS: CodeStats = { issued: 0, activated: 0, scored: 0 }

export async function getCodeStats(db: Db, eventId: string): Promise<CodeStats> {
  const [row] = await db
    .select({
      issued: sql<number>`count(*)`,
      activated: sql<number>`sum(case when ${codes.activatedAt} is null then 0 else 1 end)`,
      scored: sql<number>`sum(case when ${codes.usedAt} is null then 0 else 1 end)`,
    })
    .from(codes)
    .where(eq(codes.eventId, eventId))
  return {
    issued: Number(row?.issued ?? 0),
    activated: Number(row?.activated ?? 0),
    scored: Number(row?.scored ?? 0),
  }
}
