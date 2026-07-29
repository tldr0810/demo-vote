# Demo Vote 🗳️

Live audience voting for demo days and pitch sessions. Attendees scan a QR code,
redeem the one-time code printed on their check-in slip, and cast a single
ballot. Organisers watch a live tally and reveal the standings on a projector.
Runs on Cloudflare Workers with D1.

MIT licensed. Fork it and run your own event.

## There is no LLM in here

Issuing codes, redeeming them, recording ballots and counting them are all plain
CRUD. Not one step calls a model. **No agent binding, no API token, no inference
cost**, for us or for anyone who forks this. That is why there is no spend gate
and no per-user credential to configure.

## The anti-fraud mechanism is one line of SQL

```sql
votes.code TEXT NOT NULL UNIQUE
```

That constraint is the whole of "one code, one vote".

Checking `used_at` before inserting is **not enough**: two requests arriving
together both read "unused" and both write a ballot. The second INSERT has to be
the thing that fails, and only a uniqueness constraint can do that. It is also
why this stores votes in D1 rather than KV, where eventual consistency would
quietly miscount.

`tests/voting.test.ts` fires twenty simultaneous ballots from a single code and
asserts the database ends up with exactly one row.

## Running an event

1. **Beforehand.** Open `/admin`, create the event, enter the demo line-up, set
   the voting window (60 minutes by default).
2. **Generate codes.** Enter how many you need and generate, or download the CSV
   to print from. Codes are 8 characters from an alphabet that deliberately
   omits `I L O U 0 1`, so nothing on a printed slip can be misread.
3. **Make the QR code.** `/admin` renders the QR for the event you are setting up
   and offers it as an SVG download. It encodes `/v/<eventId>`, so it belongs to
   that event and to nothing else. Put it on the slips, the running order or a
   slide.
4. **Check-in.** One slip per person.
5. **After the demos.** Press "Open voting". The countdown starts at that moment.
6. **While voting.** The dashboard refreshes every two seconds and shows codes
   issued, redeemed and voted.
7. **Time up.** It closes itself, or press "Close now" to finish early.
8. **Reveal.** Press "Reveal results" and put `/screen/<eventId>` on the
   projector.

Nobody but the organiser can see the tally before the reveal. Voter-facing API
responses contain no counts at all, so there is nothing to find in the network
tab either.

## Local development

Needs Node 22.13 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in ADMIN_PASSWORD and VOTE_HMAC_KEY
npm run db:migrate:local
npm run dev                      # http://localhost:5273
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server: front-end HMR plus the Worker running in workerd |
| `npm test` | Test suite, including the concurrency test against a real local D1 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Typecheck, tests and build |
| `npm run check:worker` | Bundle the Worker with Wrangler without publishing |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.toml` |
| `npm run db:generate` | Generate a migration after editing `db/schema.ts` |
| `npm run smoke` | Post-deploy checks against localhost or a given URL |

### Testing the full flow from a phone

The dev server listens on all interfaces, so a phone on the same wifi can reach
it. Print the LAN address and turn it into a QR code:

```bash
npm run qr
```

That prints a scannable QR block in your terminal pointing at
`http://<your-lan-ip>:5273/`, which resolves to whichever event is currently
open. Scan it, redeem a code from `/admin`, and walk the real path end to end.

## Running it again, and again

The tool is built to be reused. Create a new event for each session; the old
ones stay in the dropdown with their results intact.

**Each event gets its own QR code.** The one `/admin` renders encodes
`/v/<eventId>`, so a scan can only ever land on the event it was made for. There
is no precedence to reason about and nothing to get wrong. It also means two
events can run at once, which is the only way a multi-track day works: a session
belongs to one event, the ballot is asked for by event, and a cookie issued for
another is refused rather than answered. Both halves matter, and
`tests/voting.test.ts` covers them. Without the refusal, somebody holding a live
session for one event who scans the other's QR is handed their existing receipt
and can never reach the vote in front of them.

The neatest place for that QR is the printed slip itself. Codes are reprinted for
every event anyway, so putting the QR on the same sheet costs nothing, removes
the question of whether anybody remembered to swap a sign on the wall, and makes
a mismatch impossible: the slip and the QR come off the same page, so they always
belong to the same event.

`/` with no event id still resolves to something sensible for anyone who types
the bare address: the live event if one is running, otherwise the one being set
up, otherwise the most recent. That ordering must rank a finished event *below* a
draft, and `tests/voting.test.ts` guards it. It is a convenience for a mistyped
address, not the path the room is meant to take.

What is **not** reusable is the printed slips. Codes are bound to one event, so
a slip from the last session is rejected at the next one. That is deliberate:
it stops someone who kept a slip from voting without turning up. It does mean a
fresh print run each time.

The cycle each time:

1. `/admin` → **New event** → name it, enter the line-up, set the window
2. Generate codes, download the CSV and the QR, print the slips
3. Run the event (open, vote, close, reveal)
4. Leave it. The next event starts at step 1 with a QR code of its own

## Fork it for your own event

1. Fork this repository.
2. Get a Cloudflare account.
3. Add four secrets to the GitHub `production` environment:

   | Secret | Purpose |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Workers deploy permission |
   | `CLOUDFLARE_ACCOUNT_ID` | Your account id |
   | `ADMIN_PASSWORD` | Unlocks `/admin` |
   | `VOTE_HMAC_KEY` | Signs session cookies. At least 32 random characters, different from the password |

4. Push to `main`. The workflow creates the D1 database, applies migrations,
   deploys and runs the smoke test.
5. Open your own `/admin` and set up your event.

Optionally set a `PRODUCTION_URL` repository variable so the smoke test hits
your real workers.dev subdomain.

No Manyfold configuration, no model provider key, nothing to edit before your
first deploy. The `database_id` in `wrangler.toml` is a placeholder that
`scripts/set-d1-database-id.mjs` rewrites at deploy time with the database in
your own account.

## How it fits together

```
scan QR ─▶ /v/:eventId ─▶ enter code ─▶ POST /api/session ─▶ signed cookie
                                                                  │
                             pick a demo ─▶ POST /api/vote ───────┤
                                                                  ▼
                                              votes.code UNIQUE ─▶ one ballot
organiser ─▶ /admin ─▶ polls every 2s ─▶ ranked bars
                    └─ open / close / reveal
projector ─▶ /screen/:eventId  (readable only after the reveal)
```

| Path | Contents |
|---|---|
| `worker/index.ts` | Worker entry point and route dispatch |
| `worker/routes/voter.ts` | Code redemption, ballot, vote |
| `worker/routes/admin.ts` | Sign-in, event setup, code batches, status, tally |
| `worker/auth.ts` | HMAC-signed sessions, shared by voters and organisers |
| `worker/codes.ts` | Code generator and alphabet |
| `worker/data.ts` | D1 queries, including the atomic write in `castVote` |
| `db/schema.ts` | Four tables: events, demos, codes, votes |
| `app/` | React front end, five screens |
| `app/motion.ts` | GSAP setup and the reduced-motion check |

### Event states

`draft → open → closed → revealed`, one way only. Voting cannot reopen after a
reveal, otherwise a latecomer could vote already knowing the standings.

A ballot needs two things to be true: the event is `open`, and the current time
is before `closes_at`. The clock closes the window, not the button, because
during a live event nobody remembers to press close on time. `closes_at` is
frozen the instant voting opens, so editing the window afterwards cannot extend
one that is already running.

## Design notes

The visual language is a scoreboard, not a landing page. There is not a single
icon anywhere: a demo needs a number, a name and a count, and type handles all
three better than glyphs would.

The typeface is the system stack, deliberately. Two hundred phones joining
congested venue wifi at the same moment is the real constraint, and a webfont is
a render-blocking request that can leave someone staring at a blank screen while
the window runs down.

There is one accent colour, emerald, for everything the voter does. Amber and
red are reserved for time pressure alone, so a colour change on screen always
means the clock and never decoration.

Motion is GSAP, all of it behind `motionOk()`, and none of it runs under
`prefers-reduced-motion: reduce`. No element starts hidden in CSS, so the page
is complete even if the JavaScript never runs.

## What the tests cover

```bash
npm run check
```

- **Concurrency**: twenty simultaneous ballots from one code produce one row.
  This is the important one.
- **Database level**: concurrent INSERTs straight against D1, proving the
  guarantee comes from the constraint itself rather than application logic.
- Code format and normalisation (lowercase and dashes can be pasted), and that
  characters outside the alphabet are never guessed at on the voter's behalf.
- Window boundaries: before opening, inside, after closing, and a session that
  outlives the window.
- No tally leakage: every voter-facing response is asserted to contain no counts.
- State transitions: no skipping steps, no reopening after a reveal, no editing
  the line-up once voting has started.
- HMAC: tampering, expiry, wrong secret, and a voter cookie being offered as an
  organiser one.

## Licence

MIT. See [LICENSE](./LICENSE).
