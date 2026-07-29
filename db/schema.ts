import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Timestamps are ISO-8601 UTC strings. SQLite has no native date type and
// string comparison on ISO-8601 is chronological, so window checks can happen
// in SQL as well as in JS.

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),

  // draft    — being set up, codes can be generated, nobody can vote
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

    // Set the first time the code is redeemed for a session. Never gates a
    // vote — it only feeds the issued/activated/voted counters on the
    // dashboard, so the organiser can see how many people took a slip but
    // never voted.
    activatedAt: text('activated_at'),
    usedAt: text('used_at'),

    createdAt: text('created_at').notNull(),
  },
  (table) => [index('codes_event_idx').on(table.eventId)],
)

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

    // This UNIQUE constraint is the entire anti-double-vote mechanism.
    // Checking codes.usedAt before inserting is not enough: two concurrent
    // requests can both read NULL and both proceed. The second INSERT has to
    // be the thing that fails, and it does.
    code: text('code')
      .notNull()
      .unique()
      .references(() => codes.code, { onDelete: 'cascade' }),

    createdAt: text('created_at').notNull(),
  },
  (table) => [index('votes_event_demo_idx').on(table.eventId, table.demoId)],
)

// Only the two the Worker actually names. `codes` and `votes` rows are always
// handled through the query helpers in worker/data.ts, which infer their own
// shapes, so a row alias for them would be an export with no reader.
export type EventRow = typeof events.$inferSelect
export type DemoRow = typeof demos.$inferSelect
