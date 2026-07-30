# Demo Vote 🗳️

Live audience scoring for demo days and pitch sessions. Attendees scan the QR
code on their check-in slip, land straight on the ballot with nothing to type,
and give every demo a score from 1 to 5, adjusting as often as they like until
voting closes. Organisers watch a
live tally, then reveal the standings on the projector and on every phone in the
room at the same time. Runs on Cloudflare Workers with D1.

MIT licensed. Fork it and run your own event.

## There is no LLM in here

Issuing codes, redeeming them, recording ballots and counting them are all plain
CRUD. Not one step calls a model. **No agent binding, no API token, no inference
cost**, for us or for anyone who forks this. That is why there is no spend gate
and no per-user credential to configure.

## The anti-fraud mechanism is one line of SQL

```sql
UNIQUE (votes.code, votes.demo_id)
```

That constraint is the whole of "one score per demo per ballot". A code addresses
one row per demo and can only ever overwrite it, so a phone that fires the same
tap twice, or a script pointed at the endpoint with a valid cookie, changes a
number rather than adding one.

Checking whether a score already exists before inserting is **not enough**: two
requests arriving together both read nothing and both write a row, and that demo
is then counted twice in the sum. The second INSERT has to be the thing that
turns into an update, and only a uniqueness constraint can do that. It is also
why this stores scores in D1 rather than KV, where eventual consistency would
quietly miscount.

`tests/voting.test.ts` fires twenty simultaneous writes for one demo and asserts
the database ends up with exactly one row.

## A ballot counts only when it is complete

Scores are saved one at a time, as the voter sets them — there is no submit
button, because a ballot stays editable for the whole window and a button that
has to be pressed again after every change is a button people forget. That means
half-finished ballots are the normal state of the table for most of an event.

They are excluded from the tally. `getTally` counts only codes carrying a score
for every demo in the event, recomputed from the rows themselves rather than read
from a flag. Counting partial ballots would hand whichever demos somebody reached
before putting their phone away an advantage over the ones they never got to.

Because every counted ballot scored every demo, each demo has the same number of
raters, so ranking by total and ranking by average give the same order. The
totals are what the ranking is on; the average out of 5 is shown beside them.

The voting page carries a running `n of 6 scored` line for exactly this reason:
every card says "Saved" the moment it is scored, which on its own reads as "you
are done".

## Running an event

1. **Beforehand.** Open `/admin`, create the event, enter the demo line-up, set
   the voting window (60 minutes by default).
2. **Generate codes.** Enter how many you need and generate. Codes are 8
   characters from an alphabet that deliberately omits `I L O U 0 1`, so nothing
   on a printed slip can be misread.

   The rate limit on redemption is sized for a room rather than for a person:
   venue wifi puts every phone behind one NAT address, so the whole audience
   shares one limiter key. What makes guessing hopeless is the 6.6e11-wide
   keyspace, not the limit. See the arithmetic in `wrangler.toml`.
3. **Print the slips.** "Print QR slips" opens `/admin/print/<eventId>`: one slip
   per code, each with its own QR encoding `/v/<eventId>?c=<code>`, ready to cut
   up. Scanning one opens that person's ballot with nothing to type. The code is
   printed underneath as the fallback for a camera that will not focus.

   `/admin` also shows a single QR for the event with no code in it. Put it on
   the wall or the running order slide: it lands on the entry screen, and it is
   the way back in for anybody whose own slip will not scan — they have their
   code, but not the address. The printed slips say so. It is also where a
   steward reading a spare code aloud sends somebody.

   Both are built from the address you have `/admin` open on, so open the
   dashboard on the address attendees will use before printing anything.
4. **Check-in.** One slip per person. Hand them out individually rather than
   putting the sheet where it can be photographed: a slip is one ballot, and a
   photograph of thirty slips is thirty of them. (Nothing can be stuffed with a
   stolen code — scores overwrite rather than accumulate — but somebody else's
   ballot can be overwritten.)
5. **After the demos.** Press "Open voting". The countdown starts at that moment.
6. **While voting.** The dashboard refreshes every two seconds and shows codes
   issued, redeemed, and how many ballots have a score for every demo. The gap
   between the last two is the people who started scoring and did not finish,
   whose ballots will not be counted.
7. **Time up.** It closes itself, or press "Close now" to finish early.
8. **Reveal.** Press "Reveal results". Put `/screen/<eventId>` on the projector;
   every phone still on the voting page turns into the standings by itself within
   a few seconds, including the phones of people who never had a code. Nobody has
   to be told to refresh anything.

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
| `npm run contrast` | Reads the tokens out of `app.css` and fails on a WCAG contrast regression in either theme. `-v` prints every pair |
| `npm run check` | Typecheck, contrast, tests and build |
| `npm run check:worker` | Bundle the Worker with Wrangler without publishing |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.toml` |
| `npm run db:generate` | Generate a migration after editing `db/schema.ts` |
| `npm run smoke` | Post-deploy checks against localhost or a given URL. Waits for the target to serve the build in `dist/` before asserting anything, because `wrangler deploy` returns before the new version answers everywhere |

### Testing the full flow from a phone

The dev server listens on all interfaces, so a phone on the same wifi can reach
it. Print the LAN address and turn it into a QR code:

```bash
npm run qr
```

That prints a scannable QR block in your terminal pointing at
`http://<your-lan-ip>:5273/`, which resolves to whichever event is currently
open. Scan it, redeem a code from `/admin`, and walk the real path end to end.

To rehearse the path attendees actually take, open `/admin/print/<eventId>` from
the LAN address and scan a slip off the screen. Passing the code CSV to the
script builds the same sheet as a standalone file:

```bash
npm run qr -- http://<your-lan-ip>:5273/v/<eventId> codes-<eventId>.csv
```

That exists for the case the dashboard cannot cover — a venue with no network, a
laptop that is not the one signed into `/admin`, a print shop that wants a file
rather than a login. Otherwise use the page, which has a print dialogue attached.

## Running it again, and again

The tool is built to be reused. Create a new event for each session; the old
ones stay in the dropdown with their results intact.

**Each event gets its own QR codes.** Every one of them encodes
`/v/<eventId>`, so a scan can only ever land on the event it was made for. There
is no precedence to reason about and nothing to get wrong. It also means two
events can run at once, which is the only way a multi-track day works: a session
belongs to one event, the ballot is asked for by event, and a cookie issued for
another is refused rather than answered. Both halves matter, and
`tests/voting.test.ts` covers them. Without the refusal, somebody holding a live
session for one event who scans the other's QR is handed their existing receipt
and can never reach the ballot in front of them.

The QR lives on the printed slip itself, one per attendee, carrying that
person's code in the URL. Codes are reprinted for every event anyway, so this
costs nothing, removes the question of whether anybody remembered to swap a sign
on the wall, and makes a mismatch impossible: the slip and its QR come off the
same page, so they always belong to the same event and to each other.

Scanning your own slip is not the only way in. The code is printed under the QR
and the shared event QR leads to the screen where it is typed — which is why
that shared code is worth putting on the wall even though nobody's ballot needs
it. A phone whose camera will not focus in a dark room is a certainty at some
point in the evening, and it should cost that person thirty seconds rather than
their ballot.

`/` with no event id still resolves to something sensible for anyone who types
the bare address: the live event if one is running, otherwise the one being set
up, otherwise the most recent that has not been archived. That ordering must rank a finished event *below* a
draft, and `tests/voting.test.ts` guards it. It is a convenience for a mistyped
address, not the path the room is meant to take.

What is **not** reusable is the printed slips. Codes are bound to one event, so
a slip from the last session is rejected at the next one. That is deliberate:
it stops someone who kept a slip from voting without turning up. It does mean a
fresh print run each time.

### Filing old events away

A finished event can be archived from `/admin`, and unarchived again. Archived
events drop out of the dropdown, which hides them behind a "Show archived"
toggle, and out of what `/` resolves to. Archive everything and the bare address
says there is no event, which is the truthful answer.

Archiving is a nullable `events.archived_at`, **not** a fifth `status` value.
`status` is a one-way machine that `getCurrentEvent` sorts on, so an `archived`
status would gamble that ordering and would also throw away the record of
whether the event ended `closed` or `revealed`. Only a `closed` or `revealed`
event can be archived: hiding a draft or a live event from the landing page while
a room is being told to scan for it is exactly the failure that rule prevents.

The cycle each time:

1. `/admin` → **New event** → name it, enter the line-up, set the window
2. Generate codes, print the QR slips, cut them up
3. Run the event (open, score, close, reveal)
4. Leave it. The next event starts at step 1 with codes and QRs of its own

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
scan slip ─▶ /v/:eventId?c=CODE ─▶ POST /api/session ─▶ signed cookie
   (or the shared QR ─▶ type the code)     code dropped from the URL
                                                                  │
            score each demo 1-5 ─▶ POST /api/score ─▶ upsert ────┤
                    (once per adjustment, saved as you go)        ▼
                                  UNIQUE(code, demo_id) ─▶ one row per demo
organiser ─▶ /admin ─▶ polls every 2s ─▶ ranked bars
                    └─ open / close / reveal
                                  │
       after the reveal ──────────┼──▶ projector  /screen/:eventId
                                  └──▶ every phone, polling /api/results/:eventId
                                       every 8s until it lands, then stopping
```

| Path | Contents |
|---|---|
| `worker/index.ts` | Worker entry point and route dispatch |
| `worker/routes/voter.ts` | Code redemption, ballot, scoring |
| `worker/routes/admin.ts` | Sign-in, event setup, code batches, status, tally |
| `worker/auth.ts` | HMAC-signed sessions, shared by voters and organisers |
| `worker/codes.ts` | Code generator and alphabet |
| `worker/data.ts` | D1 queries, including the upsert in `saveScore` |
| `db/schema.ts` | Four tables: events, demos, codes, votes |
| `app/voteUrl.ts` | How a code travels in a QR URL, and how it is read back |
| `app/routes/PrintCodes.tsx` | The sheet of per-attendee QR slips |
| `app/` | React front end, six screens |
| `app/motion.ts` | GSAP setup and the reduced-motion check |

### Event states

`draft → open → closed → revealed`, one way only. Voting cannot reopen after a
reveal, otherwise a latecomer could score already knowing the standings.

A ballot needs two things to be true: the event is `open`, and the current time
is before `closes_at`. The clock closes the window, not the button, because
during a live event nobody remembers to press close on time. `closes_at` is
frozen the instant voting opens, so editing the window afterwards cannot extend
one that is already running.

## Design notes

A tie is a result, not an edge case. The tally is sorted score desc then slot
asc, which always puts somebody first, so ranks are computed separately in
`app/ranking.ts`: equal totals share a place, the place after a two-way tie for
first is third, and the projector announces joint winners by name rather than
crowning whichever tied demo had the lower slot number. Ties are compared on the
total, which is an exact integer sum; the average beside it is rounded, and two
demos can share one without being level. Nobody leads on zero.
`tests/ranking.test.ts` covers it.

The visual language is a scoreboard, not a landing page. There is not a single
icon anywhere: a demo needs a number, a name and a score, and type handles all
three better than glyphs would.

Results bars run against the top of the scale rather than against the leader. A
count out of an unknown total had no meaningful ceiling, so the leader was the
only sensible reference; an average out of five has one of its own, and using it
means a bar length says something absolute — four out of five is four fifths of
the track whether or not anything beat it.

The typeface is the system stack, deliberately. Two hundred phones joining
congested venue wifi at the same moment is the real constraint, and a webfont is
a render-blocking request that can leave someone staring at a blank screen while
the window runs down.

There is one accent colour, emerald, for everything the voter does. Amber and
red are reserved for time pressure alone, so a colour change on screen always
means the clock and never decoration.

Both themes are held to WCAG contrast by `npm run contrast`, which reads the
tokens out of the stylesheet rather than a copy of them. The bars are the reason
it exists: a fill that cannot be told from its own track is a missing bar, and
this is the screen that gets projected. In the light theme the quiet bar is
therefore the *deeper* green and the leading one the vivid green, the reverse of
the dark theme, because on a light track every colour that clears 3:1 is darker
than the track.

Motion is GSAP, all of it behind `motionOk()`, and none of it runs under
`prefers-reduced-motion: reduce`. No element starts hidden in CSS, so the page
is complete even if the JavaScript never runs.

## What the tests cover

```bash
npm run check
```

- **Concurrency**: twenty simultaneous writes for one demo produce one row.
  This is the important one.
- **Database level**: concurrent INSERTs straight against D1, proving the
  guarantee comes from the constraint itself rather than application logic.
- Code format and normalisation (lowercase and dashes can be pasted), and that
  characters outside the alphabet are never guessed at on the voter's behalf.
- Window boundaries: before opening, inside, after closing, and a session that
  outlives the window.
- Completeness: a partial ballot is left out of the tally entirely, and starts
  counting the moment its last demo is scored.
- Score validation: 0, 6, a negative, a fraction and a missing value are all
  refused, at the endpoint and again at the database.
- No tally leakage: every voter-facing response is asserted to carry nobody's
  scores but the caller's own, and no totals at all.
- State transitions: no skipping steps, no reopening after a reveal, no editing
  the line-up once voting has started.
- HMAC: tampering, expiry, wrong secret, and a voter cookie being offered as an
  organiser one.

## Licence

MIT. See [LICENSE](./LICENSE).
