import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Timestamps are ISO-8601 UTC strings. SQLite has no native date type and
// string comparison on ISO-8601 is chronological, so window checks can happen
// in SQL as well as in JS.

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),

  // draft    — being set up, codes can be generated, nobody can vote. Not a
  //            private state: attendees are handed slips and open their page
  //            during it, and their phones watch this column so that opening
  //            takes them to the ballot without a refresh (app/voteWatch.ts).
  // open     — voting window is live
  // closed   — window ended, organiser can still see the tally
  // revealed — results are readable on the big screen without an admin cookie
  status: text('status', { enum: ['draft', 'open', 'closed', 'revealed'] })
    .notNull()
    .default('draft'),

  // Length of the voting window. Set before opening; the deadline itself is
  // frozen into closesAt the moment the organiser opens voting, so editing
  // this afterwards cannot extend a window that is already running.
  windowSeconds: integer('window_seconds').notNull().default(3600),
  openedAt: text('opened_at'),
  closesAt: text('closes_at'),

  // Set when the organiser files a finished event away, and cleared when they
  // change their mind. Deliberately its own nullable column rather than a fifth
  // status value: status is a one-way machine that getCurrentEvent sorts on, and
  // an 'archived' value would both gamble that ordering and destroy the record of
  // whether the event ended closed or revealed.
  archivedAt: text('archived_at'),

  createdAt: text('created_at').notNull(),
})

export const demos = sqliteTable(
  'demos',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    name: text('name').notNull(),
    team: text('team').notNull().default(''),
    blurb: text('blurb').notNull().default(''),
  },
  (table) => [uniqueIndex('demos_event_slot_unique').on(table.eventId, table.slot)],
)

export const codes = sqliteTable(
  'codes',
  {
    // The printed slip handed out at check-in. Stored in plaintext: the threat
    // model is a dropped piece of paper, not a database leak, and the organiser
    // needs to be able to look a code up when someone misreads their slip.
    code: text('code').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    batch: text('batch').notNull(),

    // Set the first time the code is redeemed for a session. Never gates
    // anything — it only feeds the issued/activated/scored counters on the
    // dashboard, so the organiser can see how many people took a slip but
    // never scored.
    activatedAt: text('activated_at'),

    // Set when this ballot last became complete — a score for every demo in the
    // event. Also purely a dashboard counter: what makes a ballot count towards
    // the tally is recomputed from the votes table itself (see getTally), never
    // read from here. A stamp is allowed to be stale; a tally is not.
    usedAt: text('used_at'),

    createdAt: text('created_at').notNull(),
  },
  (table) => [index('codes_event_idx').on(table.eventId)],
)

/**
 * One row per (code, demo): the score this ballot gives that demo.
 *
 * Six demos means six rows for one attendee, not one. Scores are revisable
 * right up until the organiser closes voting, so a row is written by UPSERT
 * rather than INSERT and the row count for a code only ever grows to the number
 * of demos in the event.
 */
export const votes = sqliteTable(
  'votes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    demoId: text('demo_id')
      .notNull()
      .references(() => demos.id, { onDelete: 'cascade' }),

    // UNIQUE(code, demo_id) — one score per demo per ballot. This is what the
    // upsert in saveScore conflicts against, and it is what stops a phone that
    // fires the same tap twice from writing two scores for one demo. Checking
    // "has this code scored this demo?" first would not do it: two concurrent
    // requests can both read nothing and both proceed.
    code: text('code')
      .notNull()
      .references(() => codes.code, { onDelete: 'cascade' }),

    // 1–5. The Worker validates before writing; this is the backstop for
    // anything that reaches the database another way.
    score: integer('score').notNull(),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('votes_code_demo_unique').on(table.code, table.demoId),
    index('votes_event_demo_idx').on(table.eventId, table.demoId),
    check('votes_score_range', sql`${table.score} between 1 and 5`),
  ],
)

// Only the two the Worker actually names. `codes` and `votes` rows are always
// handled through the query helpers in worker/data.ts, which infer their own
// shapes, so a row alias for them would be an export with no reader.
export type EventRow = typeof events.$inferSelect
export type DemoRow = typeof demos.$inferSelect
