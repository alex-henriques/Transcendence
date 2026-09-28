*This project has been created as part of the 42 curriculum by caida-si.*

# Who knows best?

A multiplayer quiz game that runs in the browser. A statement appears on
screen. Everyone in the room has a few seconds to decide whether it is a myth
or the truth. When the time runs out the answer is shown, along with who got it
right, who got it wrong, and the new scoreboard. Then the next card.

---

## Description

Who knows best? (WKB for short) is my ft_transcendence project: a web
application with a frontend, a backend and a database, deployed with one
command.

The game is easy to describe. One statement, two buttons, a countdown. Most of
the work is in the rules underneath:

- Answering faster is worth more. A correct answer gives 100 points plus a
  speed bonus of up to 100 more, which decays evenly across the answer window.
- A wrong answer costs 50 points. With only two options, guessing is right half
  the time. Without a penalty the best strategy would be to guess as fast as
  possible, and the game would stop being about knowing things. The total never
  goes below zero, so the penalty can only take away points you have: a bad
  opening run costs you the lead and not a hole you cannot climb out of.
- A combo multiplier adds 10% per correct answer in a row, up to +50%. Any miss
  resets it.
- Every match deals exactly half true cards and half false cards. This is
  enforced when the deck is drawn, so it holds in every single match.
- The server decides everything about timing. The browser only draws what it is
  told.
- You never get the same fact twice, in either of its two wordings.
- Getting one wrong tells you what is actually true. A card that was false
  leaves you holding a wrong idea, so the reveal states the fact correctly.
- Three languages, including the cards themselves.
- Eight computer opponents, each with its own idea of what it knows and how
  fast it answers.

### Key features

| | |
|---|---|
| Live rooms | Public listing, private invite codes, up to 8 players |
| Real-time match | Server-driven state machine over WebSockets |
| Reconnection | Drop out mid-match, come back, keep your score and your place |
| AI opponents | Eight profiles with per-category accuracy and sampled latency |
| Tournaments | Single-elimination brackets of 4 or 8 |
| Progression | XP, levels, 14 achievements, leaderboard |
| Statistics | Win rate, accuracy per category, full match history |
| Customization | Mode, difficulty, categories, match length, two modifiers |
| Social | Profiles, avatars, friends, live online status |
| Accounts | Email and password with Argon2id, optional Google or GitHub sign-in |
| Languages | English, Portuguese (Brazil), French, for the interface and the cards |

---

## Instructions

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker Engine | 24+ | With the Compose v2 plugin |
| Docker Compose | v2 | Check with `docker compose version` |
| GNU Make | 3.81+ | |
| OpenSSL | 1.1+ | Generates the certificate and the secrets |
| Google Chrome | latest stable | The supported browser |

You do not need Node.js installed. Everything builds inside containers.

If you are here to change something rather than to run it, read
[`DEV_DOC.md`](DEV_DOC.md). It maps every part of the project to the file that
owns it.

### Running it

```sh
git clone <this repository>
cd ft_transcendence
make
```

That is the whole setup. `make` will:

1. Create `.env` from `.env.example`, generating a random database password and
   two random 48-byte JWT secrets. If a `.env` already exists it is left alone.
2. Issue a self-signed TLS certificate into `infra/nginx/certs/`.
3. Build the four images and start them.
4. Apply the database migrations and load the card set. Both steps can be run
   again safely, so restarting is never a problem.

Then open <https://localhost:8443>.

> The certificate is self-signed, so Chrome will warn you the first time. Click
> Advanced, then "Proceed to localhost (unsafe)". If you type `http://` on that
> port by mistake, nginx redirects you.

### Demo accounts

The seed creates three accounts so you can start straight away:

| Email | Interface language |
|---|---|
| `ada@wkb.local` | English |
| `grace@wkb.local` | Português (Brasil) |
| `alan@wkb.local` | Français |

The password for all three is `Password1!`. The login screen lists them, and
clicking one fills the form.

### Configuration

Everything lives in `.env`, which git ignores. `.env.example` is committed and
documents every key.

| Variable | Default | Purpose |
|---|---|---|
| `WEB_PORT` | `8443` | Host port for the HTTPS edge |
| `PUBLIC_ORIGIN` | `https://localhost:8443` | OAuth redirect URIs and cookie scope |
| `PUBLIC_ORIGIN_ALIASES` | empty | Other addresses the same deployment answers on |
| `POSTGRES_*` | generated | Database credentials |
| `DATABASE_URL` | generated | Read by Prisma |
| `JWT_ACCESS_SECRET` | generated | Signs access tokens |
| `JWT_REFRESH_SECRET` | generated | Keys the refresh-token hashes |
| `ACCESS_TOKEN_TTL` | `900` | Access token lifetime in seconds |
| `REFRESH_TOKEN_TTL` | `2592000` | Refresh token lifetime in seconds |
| `GOOGLE_CLIENT_ID` / `_SECRET` | empty | Optional. The button is hidden when unset |
| `GITHUB_CLIENT_ID` / `_SECRET` | empty | Optional. The button is hidden when unset |
| `FT_CLIENT_ID` / `_SECRET` | empty | 42's own provider. Optional, same as the others |
| `ANTHROPIC_API_KEY` | empty | Not needed to run the game. Only for rebuilding the card set |

OAuth is optional. With no credentials the provider buttons do not appear and
everything else works normally. To turn one on, register an app, set its
callback URL to `${PUBLIC_ORIGIN}/api/auth/oauth/google/callback` (or
`/github/callback`, or `/42/callback`), put the credentials in `.env` and run
`make up`.

The 42 application is registered at
<https://profile.intra.42.fr/oauth/applications/new>. It needs the redirect URI
above and the `public` scope, which is the only one this application reads. Its
UID and secret go in `FT_CLIENT_ID` and `FT_CLIENT_SECRET`, named with `FT_`
because an environment variable cannot start with a digit.

### Playing from another machine

Set `PUBLIC_ORIGIN` to the address other machines will type, keep the old one
in `PUBLIC_ORIGIN_ALIASES`, and run `make`:

```sh
PUBLIC_ORIGIN=https://192.168.1.10:8443
PUBLIC_ORIGIN_ALIASES=https://localhost:8443
```

Nothing else needs changing. The browser builds every API and WebSocket URL
from the address it was opened at, so both work with no rebuild, and the
certificate is issued for the names on those two lines. It is reissued when
they change, which is why they are read at `make` time rather than trusted to
stay in step by hand.

The certificate is self-signed either way, so every machine sees the warning
once and clicks through it.

If the OAuth buttons are configured, register the callback for each address
you use. The provider sends the visitor back to the address they started from,
so logging in from localhost and from the LAN address both work, but each is a
separate redirect URI as far as the provider is concerned.

### Commands

```
make            build and start everything       make logs        follow the logs
make up         start without rebuilding         make ps          container status
make down       stop, keeping the data           make psql        a psql shell
make re         rebuild from scratch             make shell-api   a shell in the api
make fclean     stop and delete all data         make seed        run the seed again

make test          typecheck, then e2e, then the console check
make e2e           play a full match through the API and the WebSocket
make console-check load every screen in headless Chrome and fail on any console output
make check         validate the card set: balance, coverage, negation tell
make cardgen ARGS="…"  the card pipeline, described in tools/cardgen/README.md
```

---

## Technical Stack

TypeScript on both sides. That was the first decision, and most of the others
follow from it. The WebSocket event types, the Zod validation schemas and the
scoring function are written once in `packages/shared` and imported by the
browser and the server, so the two cannot disagree about them.

### Frontend

| Choice | Why |
|---|---|
| React 18 with Vite | The subject counts React as a framework. Vite builds fast and emits content-hashed assets. |
| Tailwind CSS 3 | The required CSS framework. Utility classes keep the responsive work next to the markup. |
| React Router 6 | Client-side routing with a shared layout. |
| i18next and react-i18next | Three complete locales, switchable without reloading. |
| Zod | The same schemas the server runs. |

There is no state-management library. The app has two pieces of shared state,
the session and the room channel, and both are custom hooks. Redux would have
been ceremony.

### Backend

| Choice | Why |
|---|---|
| Fastify 5 | A backend framework, as the subject requires. Faster than Express, good TypeScript support, and its plugin model keeps cookies, rate limiting, uploads, static files and WebSockets as separate, visible pieces. |
| @fastify/websocket | Raw `ws`. I did not want Socket.IO: it puts a second protocol on top of WebSockets and ships a client bundle, and its reconnection behaviour is something I would have had to understand anyway. The subject asks for WebSockets, so I used WebSockets. |
| Prisma 6 | The ORM module. Typed queries, real migration files, and raw SQL available where it matters. |
| jose | JWT signing and verification. Modern and ESM-native. |
| @node-rs/argon2 | Argon2id with prebuilt native binaries. |

### Database: PostgreSQL 16

The card draw is the reason. Every match runs this query twice, once for each
half of the deck:

```sql
SELECT c.* FROM cards c
JOIN facts f ON f.id = c.fact_id
WHERE f.active
  AND (cardinality($1::int[]) = 0 OR f.category_id = ANY($1::int[]))
  AND f.difficulty = $2::"Difficulty"
  AND c.is_true = $3
  AND NOT (f.id = ANY($4::int[]))
  AND NOT EXISTS (SELECT 1 FROM user_seen_facts s
                  WHERE s.fact_id = f.id AND s.user_id = ANY($5::int[]))
ORDER BY random()
LIMIT $6
```

It needs array parameters (`int[]`, `= ANY`, `cardinality`), native enum types,
`ORDER BY random()`, and a correlated `NOT EXISTS` against a table with a
composite key. All of that in one statement, at match start, covering every
player in the room at once.

PostgreSQL does all of it natively. SQLite has no array type and no enums, so
the same draw would have meant several round trips or building SQL by string
concatenation. The rest of the schema benefits too: `jsonb` for bot profiles and
achievement rules, `count(*) FILTER (WHERE …)` for the statistics, and real
transactions for concurrent voting.

### Design

The interface is a deck of cards on a table. The card in play is warm paper
lying on a dark table, and the rest of the deck is visible behind it, stepped
back and squared off.

The card keeps its own colours in both themes, and that is the load-bearing
idea rather than a detail: paper does not change colour when the lights go out,
so only the room around it is re-themed. A suit's colour is therefore checked
for contrast once, not twice, and the card looks like the same object in either
theme.

Light is the almanac the project started as — warm paper room, ochre accent,
thin rules. Dark is the same table in an unlit room. A third state, "follow the
system", is the default, so the app matches the machine until someone says
otherwise.

Every category is a suit, the way every card in a real deck belongs to one:

| Category | Suit | Category | Suit |
|---|---|---|---|
| Sports & Games | a die, since the category is both | Technology | a chip |
| History | a rolled papyrus | Arts | a quill |
| Science & Nature | orbits | Geography | a meridian globe |
| Space | a ringed planet | Society & Culture | a mask |

Four colours carry meaning during a match, and they are two pairs that must
never be mistaken for one another. `correct` (green) and `wrong` (red) say
whether **you** were right. `truth` (ink blue) and `myth` (plum) say what the
**statement** turned out to be. The reveal panel is framed in the first pair
and names the statement in the second.

That distinction is the whole point. Framing the panel by the statement — which
is what it did at first — meant that spotting a myth correctly produced a large
red box, with a small green "Correct" inside it arguing with the frame around
it. Two facts were sharing one colour axis, and the player had to work out
which one the red meant. For the same reason the two vote buttons are blue and
plum rather than green and red: a myth is not a mistake, and a red button is a
verdict on a press nobody has made yet. The answer timer runs ink, then ochre,
then red, and never green.

Each suit carries a colour that drives the card's top band, its inner keyline,
its crest and both corner pips. The pip is not simply a small crest: fine line
work reads at 42px and turns to mud at 13px, so the engraved suits fall back to
a heavier stroke or a filled silhouette in the corner. That rule is what keeps
four different drawing styles reading as one deck, and it is what real court
cards do.

The type is Archivo, a grotesque, self-hosted as two woff2 files with its OFL
licence. Nothing is fetched from a font host: that is a dependency at
evaluation time, a console error if it fails, and a third party to declare on
the privacy page. It replaced a book serif because the statements should read
as a game rather than as a document.

I am writing the constraints down because they were decisions, not defaults.
Generated interfaces land on the same house style, and the list of things
avoided is the more useful half:

| Avoided | Why |
|---|---|
| Lavender-violet accent | The most recognisable marker of a generated interface. |
| Stacked alpha | Every shade is a flat colour computed to its final value. Alpha layers are the cheap way to fake depth and they make contrast impossible to verify. |
| Gradients on surfaces | Backgrounds, bars and avatars are solid. |
| Backdrop blur | Panels are opaque sheets with a 1px rule. |
| Coloured glows | The card has one neutral shadow because it is genuinely raised off the table. |
| Inter | Archivo for everything, with the old serif kept only for the legal pages, where long-form reading wants one. |
| Pill radii | 6 to 12px: between a printed rule and an app. |

Failure is drawn from the same deck. A route that matches nothing gets the
visitor from the space suit adrift between two planets; a room or a bracket
that is not there is dealt as a card, with the player's false belief written on
it as a statement and Myth stamped underneath in the reveal panel they have
already read twenty times a match. That verdict is plum and never the red of a
wrong answer, because nobody got anything wrong. The one exception is the
expired session, which is a sentence above the login form: somebody whose game
just ended wants the form and a reason, not a joke.

Two useful things came out of the original pass and survived the redesign. The
countdown is a bar under the card, because the card is the thing being read and
the timer belongs to it. And voting has keyboard shortcuts, `T` and `M`, which
a timed game wanted anyway.

Contrast is measured rather than asserted. Every visible text node on fourteen
routes is checked against the background actually painted behind it, in both
themes, at the WCAG AA thresholds for its size and weight. That check is what
caught the avatar initials: the tones behind them are a fixed data palette that
does not follow the theme, but the ink on them did, and inverted to dark it put
dark ink on a dark tone at 2.65:1.

### Infrastructure

Four services on their own bridge network:

```
                         ┌──────────────────────────────────┐
   browser  ──HTTPS──▶   │ nginx     TLS 1.2/1.3 at the edge│
   (Chrome)  :8443       │           /api  /ws  →  api      │
                         │           everything else → web  │
                         └───────┬──────────────────┬───────┘
                         plain HTTP            plain HTTP
                                 │                  │
                    ┌────────────▼──────┐   ┌───────▼──────────┐
                    │ api   Fastify     │   │ web   nginx      │
                    │       node:22     │   │       static SPA │
                    └────────────┬──────┘   └──────────────────┘
                                 │ TCP
                    ┌────────────▼──────┐
                    │ postgres  16      │  named volume: pgdata
                    └───────────────────┘
```

TLS stops at the edge. Traffic between containers is plain HTTP, which the
subject allows. Only nginx publishes a port.

---

## Database Schema

21 tables. Ten of them are enough to play a match from start to finish; the
rest arrived with the modules that needed them.

```
CARD SET                              USERS
┌──────────────┐                      ┌────────────────┐
│ categories   │◀──┐                  │ users          │◀────┐
│  id, slug    │   │                  │  id, email     │     │
│  name        │   │                  │  password_hash │     │
└──────────────┘   │                  │  display_name  │     │
                   │ category_id      │  avatar_url    │     │
┌──────────────────┴───┐              │  locale, xp    │     │
│ facts                │              │  level, is_bot │     │
│  id, difficulty      │              │  totp_secret   │     │
│  source_ref (unique) │              │  last_seen_at  │     │
│  license, verified_at│              └────┬───────────┘     │
│  active              │                   │                 │
└───┬──────────────────┘                   │ user_id         │
    │ fact_id                              │                 │
┌───▼──────────────┐                  ┌────▼─────────────┐   │
│ cards            │                  │ oauth_accounts   │   │
│  id, text        │                  │ refresh_tokens   │   │
│  is_true         │                  │ friendships      │───┘
│  form(aff|neg)   │                  │ user_seen_facts  │
└───┬──────────────┘                  │ bot_profiles     │
    │ card_id                         │ user_achievements│
┌───▼──────────────┐                  └──────────────────┘
│ card_translations│
│  locale, text    │       ROOMS AND MATCHES
│  PK(card,locale) │       ┌───────────┐   ┌───────────────┐
└──────────────────┘       │ rooms     │──▶│ room_settings │
                           └─────┬─────┘   └───────────────┘
MODULES                          │ room_id
┌────────────────────────┐  ┌────▼──────┐
│ tournaments            │─▶│ matches   │
│ tournament_participants│  └──┬─────┬──┘
│ tournament_matchups    │     │     │
│ achievements           │  ┌──▼───┐ └──▶┌───────────────┐
└────────────────────────┘  │match_│     │ match_players │
                            │cards │     └───────┬───────┘
                            └──┬───┘             │
                               └────▶┌───────────▼─┐
                                     │ answers     │
                                     │ UNIQUE(card,│
                                     │        player)
                                     └─────────────┘
```

### The tables where a decision is buried

`facts` and `cards`. A fact is one piece of knowledge. A card is one way of
wording it. Each fact has exactly two cards: an affirmative one, which is true,
and a counter-wording, which is false. Variety is counted in facts and never in
cards. Someone who knows a fact will answer both wordings without thinking, so
showing a player both would be showing them the same card twice.

Key fields: `facts.difficulty` (enum `easy|medium|hard`), `facts.source_ref`
(text, unique, which records where every statement came from and also lets the
seed run twice without duplicating anything), `cards.is_true` (boolean) and
`cards.form` (enum `affirmative|negated`). There is an index on
`(category_id, difficulty, active)` and a unique constraint on
`(fact_id, form)`.

`user_seen_facts` has `PK(user_id, fact_id)`. It is keyed by fact, never by
card. That is how repetition is avoided, and it also feeds the per-category
accuracy in the statistics module.

`match_cards` holds the whole deck, drawn and written when the match starts
rather than one card at a time. Because of that, reconnecting is a lookup and
not a state reconstruction. `served_at` and `deadline_at` are `timestamptz` and
are written after the card goes out, since the deadline the server enforces is
the one it holds in memory.

`match_players` exists separately from the socket. A player who drops keeps
their row, their score and their rank. Only `connected` changes. Nothing is
deleted while a match is running.

`answers` stores three times for every vote: `client_reaction_ms` (what the
browser claimed), `rtt_ms` (the server's moving average for that connection)
and `accepted_reaction_ms` (what was actually scored), plus a
`reaction_trusted` flag. Keeping them apart makes it possible to audit how many
answers fell outside the plausible window. The
`UNIQUE(match_card_id, match_player_id)` constraint is what actually prevents a
double vote; the in-memory check is only there to save a round trip.

`bot_profiles.accuracy_by_category` is `jsonb`, so a bot that knows geography
and struggles with music is a data change and not a schema change.

`achievements.criteria` is `jsonb` too. Adding a badge means editing the seed,
not deploying code: `services/rewards.ts` reads `criteria.kind` and applies the
rule.

`tournament_matchups` stores every bracket pairing explicitly, so who plays
whom and in what order is a query and not a formula the UI has to work out.

Statistics are derived from `answers` and `match_players` when they are
requested. There are no denormalised counters, so nothing can fall out of sync
with the matches that actually happened.

---

## Modules

Fifteen modules, worth 21 points. The score is 19: the 14 required plus 5 of
bonus, which is the cap, so the last two points cannot be awarded.

They are claimed anyway, and deliberately. A module rejected at evaluation
scores zero, and at exactly 19 a single rejection costs a bonus point. Modules
14 and 15 are the slack: reject any two of the fifteen and the total is still
19.

| # | Module | Type | Pts |
|---|---|---|---|
| 1 | Use a framework for both frontend and backend | Major | 2 |
| 2 | Implement a complete web-based game | Major | 2 |
| 3 | Multiplayer game (more than two players) | Major | 2 |
| 4 | Real-time features using WebSockets | Major | 2 |
| 5 | Standard user management and authentication | Major | 2 |
| 6 | AI opponent | Major | 2 |
| 7 | Use an ORM for the database | Minor | 1 |
| 8 | Remote authentication with OAuth 2.0 | Minor | 1 |
| 9 | Tournament system | Minor | 1 |
| 10 | Gamification system | Minor | 1 |
| 11 | Game statistics and match history | Minor | 1 |
| 12 | Game customization options | Minor | 1 |
| 13 | Multiple languages (at least 3) | Minor | 1 |
| 14 | Custom-made design system | Minor | 1 |
| 15 | GDPR compliance features | Minor | 1 |
| | 6 majors × 2 + 9 minors × 1 | | 21 |
| | capped at 14 + 5 bonus | | **19** |

The dependencies are respected. Modules 3, 6, 9, 11 and 12 all need a working
game, so module 2 was finished and playable before any of them started.

### 1. Framework for both frontend and backend (Major, 2 pts)

Why: the subject counts React as a frontend framework and Fastify as a backend
one, and everything else sits on top of this.

How: React 18 with Vite for the SPA and Fastify 5 for the API, both in
TypeScript and both importing `packages/shared`. The WebSocket event union, the
Zod schemas and the scoring function are compiled once and used by both sides.

Code: `apps/web/src/`, `apps/api/src/server.ts`, `packages/shared/src/`

### 2. Complete web-based game (Major, 2 pts)

Why: it is the product. Everything else is built around it.

How: live matches over WebSockets, driven by a state machine on the server.
Clear rules (myth or truth inside a time window), clear scoring, and a clear
win condition (highest score after the last card). 2D, drawn in React.

The per-card cycle, in `apps/api/src/game/engine.ts`:

```
SERVING     stamp served_at and deadline_at, send the card to each
            player in their own language                        → COLLECTING
COLLECTING  take votes until deadline_at, or until everyone who
            can answer has                                      → REVEALING
REVEALING   score, save, broadcast the answer and the whole
            scoreboard, hold for about 4 seconds                → SERVING | SCOREBOARD
SCOREBOARD  final ranks, XP, achievements                       → back to the room lobby
```

Code: `apps/api/src/game/engine.ts`, `apps/web/src/pages/Room.tsx`

### 3. Multiplayer, more than two players (Major, 2 pts)

Why: three or more players is the point at which a quiz becomes a party game
and the scoreboard starts to matter.

How: rooms hold up to 8 participants. Every player is a row in `match_players`.
The reveal broadcasts results for all of them plus the full scoreboard, not
deltas. Fairness between players of different connection quality is what the
RTT validation is for.

To demonstrate it, open three or more browser windows. With two, the module
counts as not demonstrated.

### 4. Real-time features using WebSockets (Major, 2 pts)

Why: a timed game where everybody answers at once cannot be built on polling.

How: two separate channels, split from the beginning.

- `/ws/lobby` for the public room list and presence.
- `/ws/room` for one match: join, vote, reveal, scoreboard.

Keeping them apart means no message ever has to be routed by first working out
whether a socket happens to be in a room.

Within one socket the handlers run one after another, chained on a promise. A
WebSocket delivers in order, so a client is entitled to assume the server acts
in order: firing each handler independently let a client that sent `add_bot`
and `match:start` back to back have the start read the room before the bot was
in it, and be told it needed a second player.

Updates across clients: every reveal sends the full scoreboard. Most events are
serialised once per room. The two exceptions are `card:served` and
`card:revealed`, which are built per connection because each player reads the
card, and the correction that follows it, in their own language.

Authentication: a browser cannot set an `Authorization` header on a WebSocket
handshake, and a token in the query string ends up in proxy logs. The client
trades its access token for a single-use ticket over HTTPS, valid for 30
seconds, and the ticket is what travels in the URL. See
`apps/api/src/ws/ticket.ts`.

Disconnection: the player loses the current round. They stay in the match until
the end with the score they had, and cards that go past while they are away
count as no answer, worth zero points with the combo reset. The
`match_players` row is never deleted, only marked `connected = false`.

Leaving: the room is handed to whoever has been in it longest, so it is never
stuck without anyone able to change the settings or press start. Only humans
are candidates, and that falls out of where the list comes from, since the
candidates are read off the open sockets and a bot never has one. When the last
human leaves a match, the match stops instead of letting the bots play on to an
empty room, and nothing is recorded: `ended_at` stays null, every stats query
filters on `ended_at IS NOT NULL`, so a match nobody stayed for reaches no
history, no XP and no leaderboard row. A tournament match is the exception,
because a bracket cannot sit waiting on a match that is never coming back, so
it is settled as a forfeit where whoever is still there outranks whoever left.

Reconnection: the client sends `room:join`. The server finds the existing
`match_players` row and answers with a `room:state` containing the current
position, the card in play, the time left and the scoreboard. There is no
replay and no reconstruction, because the whole deck was written to
`match_cards` when the match started. The countdown re-anchors to the time
remaining, so a clock difference between browser and server cannot make it
finish early.

Code: `apps/api/src/ws/`, `apps/web/src/ws/`

### 5. Standard user management and authentication (Major, 2 pts)

How: sign-up and login with email and password, hashed with Argon2id (19 MiB,
2 passes, 1 lane, and a 16-byte random salt per password). Profile editing,
avatar upload with a generated default, and friends with live online status.

Creating an account does not start a session. The server issues no token and
sets no cookie for a sign-up; the new account is sent to the sign-in screen
with its address filled in, and types the password it just chose. That is also
the first time anyone finds out whether that password is really the one they
meant.

Sessions: a short-lived JWT access token kept only in memory, never in
`localStorage` where an injected script could read it, plus an opaque refresh
token in an httpOnly, `SameSite=Strict`, `Secure` cookie scoped to `/api/auth`.
Refresh tokens are stored as keyed hashes, so a copy of the database is not
enough to mint a session, and they rotate on every refresh with a transaction
guarding against double use.

The subject requires a default avatar. Mine derives a fixed colour from the
display name, so players stay distinguishable in a scoreboard.

Code: `apps/api/src/routes/auth.ts`, `apps/api/src/lib/tokens.ts`,
`apps/web/src/auth/`

### 6. AI opponent (Major, 2 pts)

Why: the game has to be playable when nobody else is online, and the subject
asks for an opponent that behaves like a person and not like a solver.

How: a bot is a row in `users` with `is_bot = true` and a record in
`bot_profiles`. It joins `match_players` like anybody else and answers through
the same `applyVote` path, except that its answer comes from an internal timer
and not from a socket. That is why the AI needs no second copy of the match
rules.

- `accuracy_by_category` (jsonb) holds a hit rate per category. A bot that knows
  geography and misses music feels like a person. A uniformly mediocre one feels
  like a coin.
- Reaction times are drawn from a truncated normal distribution. A sample past
  the deadline is a bot that did not answer in time, which humans also do.
- The mean is calibrated against the 10-second medium window and rescaled to
  whatever window the room uses. That is how the bot uses the customization
  options, as the subject asks.
- Hard cards shift accuracy down by 8 points and easy cards up by 8.

It is challenging and it does win. `Oracle` sits at 0.80 to 0.85 accuracy with a
3.0 second mean. `Rookie` sits at 0.55 with a 6.2 second mean. There are six
more in between.

No language model plays the game. It is a synthetic player with a parameterised
hit rate and sampled latency, which is what makes it explainable, reproducible
and able to run with no network.

Code: `apps/api/src/game/bot.ts`, `apps/api/src/seed/data.ts`

### 7. ORM (Minor, 1 pt)

Prisma 6, with a versioned migration in `apps/api/prisma/migrations/` applied by
the container entrypoint every time it boots. Typed queries throughout, dropping
to `$queryRaw` with bound parameters for the card draw and the aggregate
statistics, where the SQL is the interesting part.

### 8. OAuth 2.0 (Minor, 1 pt)

Authorization-code flow for Google, GitHub and 42's own intra. The `state`
parameter is kept in a short-lived httpOnly cookie and compared in constant
time.

The three differ only in their endpoints and in the shape of the profile they
return, so the endpoints are a table and only the profile call is a branch. 42
is asked for the `public` scope and nothing else: the application reads an id,
an email, a login and an avatar, and the other scopes on the intra form would
be asking for permissions it has no use for.

The callback never puts a token in the redirect URL. It sets the refresh cookie
and bounces to `/auth/callback`, where the SPA makes an ordinary session call,
the same one a returning visitor makes.

The address the visitor came in on decides where they are sent back to, which
is what lets one deployment serve a LAN address and localhost at the same
time. It is chosen by looking the `Host` header up in the configured list and
returning the configured string, never by rebuilding a URL from the request: a
redirect built out of a header nobody checked is a way to have the
authorization code delivered somewhere else.

Accounts are matched by provider identity first and by verified email second, so
signing in with Google on an account that already has a password links the two
and does not create a duplicate. Providers with no credentials configured do not
render a button.

Code: `apps/api/src/routes/oauth.ts`

### 9. Tournament system (Minor, 1 pt)

Single-elimination brackets of 4 or 8. Every pairing is a row in
`tournament_matchups` holding the round, the slot, both players, the room, the
match and the winner, so the matchup order can be read out of the database.

Registration, seeding, matchmaking and automatic advancement when a round
finishes. Humans are spread across the bracket before bots fill the remaining
seats, so a solo player never draws a bot-versus-bot game in place of their own.

Matchups between two bots are simulated: a real deck, real `answers` rows, and
the same `decideBotAnswer` and `computeScore` functions the live loop uses. Only
the waiting is skipped, since nobody is watching. The UI says so.

Code: `apps/api/src/services/tournament.ts`, `apps/web/src/pages/Tournaments.tsx`

### 10. Gamification (Minor, 1 pt)

The subject asks for at least three of achievements, badges, leaderboards, XP,
daily challenges or rewards, and says explicitly that three done well beats six
done badly. I built three:

1. XP and levels. 20 for playing, 10 per 100 points, and 50/25/10 for a podium
   finish. 500 XP per level.
2. 14 achievements, with the rules stored as `jsonb` so adding one is a seed
   change.
3. A leaderboard ranked by total score across finished matches. Bots are
   excluded, since a leaderboard the house can win is not a leaderboard.

All of it is persisted, with a level progress bar on the profile and an
end-of-match panel that shows only the achievements that are new.

Code: `apps/api/src/services/rewards.ts`

### 11. Game statistics and match history (Minor, 1 pt)

Wins, losses, ranking, level, win rate, accuracy, best combo, fastest correct
answer, accuracy per category, a small chart of score over the last matches, and
a full history with dates, results and opponents.

All of it is derived from `answers` and `match_players` at read time. There are
no stored counters, so the numbers cannot drift away from the matches that
produced them.

Code: `apps/api/src/services/stats.ts`, `apps/web/src/pages/Stats.tsx`

### 12. Game customization (Minor, 1 pt)

Mode and difficulty alone would be thin, so a room also carries:

- Mode: general knowledge, or a single-category room. A category room is its own
  room and not a filter inside the general one.
- Difficulty: easy (15s, 10 cards), medium (10s, 20 cards), hard (6s, 30 cards).
  The 6-second window also makes looking an answer up impractical.
- Several categories at once in general mode.
- Match length from 5 to 40 cards, capped at what the card set can actually deal
  for those settings.
- An answer window from 3 to 30 seconds, independent of the difficulty preset.
- Two modifiers: the combo multiplier can be switched off, and double-value
  cards make every fifth card worth twice as much, for better or worse.
- A player cap from 2 to 8.

The subject requires default options. Every control starts from a documented
default and there is a "Reset to defaults" button. The host can also change
settings from inside the room without recreating it.

The player is customisable too, not just the room: sixteen stock avatars, two
per card suit, picked on the first-run screen or later from the profile page.
A choice is stored in `users.avatar_url` as `preset:<id>` rather than in a
column of its own, since that field already answers the one question of how a
person is drawn.

Outside the room, a new account is taken through a first-run setup screen once
— display name, interface language and theme — rather than being dropped into a
live lobby with whatever its browser happened to guess. It is gated on
`users.onboarded_at`, so it follows the account to another machine, and every
control on it also lives in the header or on the profile page, so nothing there
is a one-time decision.

Code: `apps/web/src/pages/CreateRoom.tsx`, table `room_settings`

### 13. Multiple languages (Minor, 1 pt)

Three complete locales, English, Português (Brasil) and Français, with a
switcher in the header on every screen, and a choice on the first-run setup
screen that applies as it is picked. All 477 strings exist in all three, and
`make e2e` checks that the key sets match exactly, with nothing missing and
nothing extra — a key added to one locale and forgotten in the others renders
as its raw key path, which is invisible to anyone testing in English.

The cards are translated too. All 360 facts exist in all three languages, and
`make check` confirms 100% coverage. Inside a room each player sees the card in
their own language, which is the choice I made and documented, since the answer
is the same either way. A card with no translation for the viewer would fall
back to English and say so, though on the shipped set that never happens.

Switching language during a match re-languages the card that is on screen. The
socket's locale is set when it opens, so the naive version leaves the cards in
whichever language the player joined with while every other label changes, which
leaves the only thing anyone is reading in the wrong language. A `locale:set`
event moves the socket's locale, and the server answers with a room snapshot and
not a fresh card, so the countdown re-anchors to the time actually left and a
vote already cast survives. Category and achievement names travel as slugs and
are translated in the browser, with the stored English name as a fallback.

The interface language is stored on the account, so it follows the player
between browsers.

Code: `apps/web/src/i18n/`, table `card_translations`

### 14. Custom-made design system (Minor, 1 pt)

Why: the subject asks for reusable components with a proper colour palette,
typography and icons, minimum ten. This one is claimed last because it was not
built as a module. It is what the other thirteen are drawn with, and writing it
down is the only work the claim needed.

Nothing is borrowed. `apps/web/package.json` has no component library and no
icon library in it — React, the router, i18next, Zod, and Tailwind for
utilities, which the subject requires anyway. Every component, every colour and
every drawing below is authored in this repository.

**Eighteen reusable components**, each with at least one consumer outside the
file that defines it:

| Component | Used by |
|---|---|
| `Button` `Field` `Alert` `PageTitle` `Avatar` `EmptyState` `Spinner` | 5 to 9 screens each |
| `AvatarPicker` | profile, first-run setup |
| `DeadEnd` | a missing room, a missing bracket |
| `CardFace` `TimerBar` `VoteButtons` `Scoreboard` | the match |
| `ConnectionLost` | the match, when the socket drops |
| `Layout` `ThemeSwitcher` `LanguageSwitcher` `ThemeProvider` | the shell |

**The palette** is 30 semantic tokens defined three times over: light, explicit
dark, and dark inherited from the system. They are named for what they mean and
not for what colour they are — `--correct` and `--wrong` for whether you were
right, `--truth` and `--myth` for what the statement was, and those two pairs
are deliberately not the same two colours. Every value is a flat colour computed
to its final form, with no alpha stacking, which is what makes the contrast
measurable rather than assertable. `make a11y` measures it.

**The typography** is Archivo, self-hosted as two woff2 files with its OFL
licence in `apps/web/public/fonts/`. Nothing is fetched from a font host: that
would be a dependency at evaluation time, a console error if it failed, and a
third party to declare on the privacy page.

**The icons** are the eight suit marks — a die, a papyrus, orbits, a ringed
planet, a chip, a quill, a meridian globe, a mask — each drawn twice, once as a
42px crest and once as a 13px corner pip, because fine line work turns to mud at
pip size and has to fall back to a heavier stroke or a filled silhouette. On top
of those, sixteen stock avatars, two per suit. Every one is an SVG path in
`apps/web/src/theme/`.

Code: `apps/web/src/components/ui.tsx`, `apps/web/src/theme/`,
`apps/web/src/index.css`. The reasoning behind the palette, the type and the
suit marks is in the [Design](#design) section above, including the list of
things deliberately avoided.

### 15. GDPR compliance features (Minor, 1 pt)

Why: the Privacy Policy is a rejection-class requirement and it already
promised the player could see their data and have it erased. Until this module
those were promises kept by hand, by asking me. A policy that describes a right
the application cannot exercise is the kind of page the subject calls a
placeholder.

**Request your data.** `GET /api/users/me/export` returns one JSON document
holding everything stored about the account: the account row, linked sign-ins,
friendships with their direction and status, the full statistics, every
achievement with its unlock date, every match with every answer — the
statement, what it turned out to be, what you answered, the points, the
reported reaction time, the accepted one and the round trip that separates them
— every tournament entered, and the list of facts already shown. It is
assembled from the tables and not from the read models the interface uses, so
it is what is actually stored rather than a tidied view of it.

The one field deliberately left out is `password_hash`. Handing an account
holder their own Argon2id digest tells them nothing, and hands anyone who has
taken over the session something to attack offline.

**A readable format.** Indented JSON, sent with a `Content-Disposition` so the
browser saves it as `wkb-data-<name>.json`. The access token lives in memory
and never in a URL, so the download cannot be a plain link: it goes through the
same authenticated client as every other call and is turned into a blob in the
browser.

**Deletion with confirmation.** `DELETE /api/users/me` requires the display name
typed back and, for an account that has one, the password re-entered. Erasure is
irreversible, so the confirmation has to prove both intent and identity, and an
OAuth-only account can still confirm with the name alone.

Every table referencing a user cascades, so one delete takes the sessions,
answers, friendships, achievements and match participation with it. The
exception is the bracket: `tournament_matchups.player_a_id`, `player_b_id`,
`winner_id` and `tournaments.winner_id` hold a user id without a foreign key,
so they are nulled in the same transaction. An id left pointing at a deleted
person is not erasure. The uploaded avatar is unlinked from disk first, and the
refresh cookie is cleared on the way out.

**Confirmation emails: not implemented, and not claimed.** The subject lists
them as the fourth bullet of this module. This application has no mail server
and sends no email at all, which is why it also has no password-reset flow —
both are in Known limitations. Adding SMTP for one bullet would mean a
credential to store, a service to run and a delivery failure mode on evaluation
day. Instead the confirmation is synchronous and in the interface: the name
typed back, the password re-entered, and the account gone before the response
returns. I would rather say plainly which bullet is missing than claim it.

Code: `apps/api/src/routes/users.ts`, `apps/web/src/pages/Profile.tsx`

---

## Features List

Everything below was written by caida-si. See Team Information.

### Account and identity
| Feature | Description |
|---|---|
| Welcome page | A public front page reached from the mark in the header: what the game is, how a round goes, and the eight suits, built from the same components the game uses. |
| Sign-up | Email, display name and password, validated by the same Zod schema on both sides. Creating the account does not sign you in. |
| First-run setup | A new account picks its name, language and theme once before its first round, gated on `users.onboarded_at` so the answer follows the account rather than the browser. |
| Login | Argon2id verification, with roughly the same cost whether or not the account exists, so the endpoint cannot be used to find out which emails are registered. |
| OAuth sign-in | Google, GitHub and 42 intra, authorization-code flow with a CSRF-protected `state`. |
| Session | Access token in memory, rotating httpOnly refresh cookie, renewed a minute before it expires. |
| Password change | Requires the current password and revokes every other session. |
| Profile | Display name, language, avatar, level and XP progress. |
| Avatar upload | Type checked from the actual bytes, size capped at 2 MB, old file removed. |
| Stock avatars | Sixteen ink stamps, two per card suit, on the rule that one of each pair is not a person and the other is a person dressed for that suit. Chosen on the first-run screen or from the profile page. |
| Default avatar | Generated from the display name with a fixed colour, for anyone who picks neither. |
| Friends | Request, accept, decline, remove, block. |
| Online status | Live over the lobby socket, backed by `last_seen_at`. |

### Playing
| Feature | Description |
|---|---|
| Public lobby | Live listing that updates as rooms appear, fill and finish. |
| Private rooms | Reachable only with a 6-character invite code, with no I, O, 0 or 1 in the alphabet since codes get read aloud. |
| Room creation | Full customization screen with documented defaults. |
| In-room settings | The host can change them without recreating the room. |
| Computer opponents | Eight profiles, added by the host, described by strength and speed. |
| Live match | Server-driven cycle with a countdown and two vote buttons, also bound to `T` and `M`. |
| Cumulative scoreboard | Always visible, updated on every reveal. |
| Reveal | The answer, the fact stated correctly, everyone's vote, the points each player got, and the card's source reference. |
| Host handover | The host leaving passes the room to the next human in it. Bots are never candidates. |
| Walking out | A match whose last human leaves stops rather than playing on to an empty room, and is not recorded. |
| Reconnection | Rejoin mid-match with score, position and remaining time intact. |
| Final scoreboard | Ranks, XP gained, level-ups and newly unlocked achievements. |
| Tournaments | Create, register, fill with bots, start, and watch a live bracket. |

### Progression and data
| Feature | Description |
|---|---|
| XP and levels | With a progress bar on the profile. |
| Achievements | 14 of them, with the rules stored as data. |
| Leaderboard | Total score, matches, wins, accuracy. Bots excluded. |
| Statistics | Win rate, accuracy, best combo, fastest answer, accuracy per category. |
| Match history | Dates, difficulty, rank, score and opponents. |
| Progression chart | Score over the last matches, drawn as inline SVG with no chart library. |

### Platform
| Feature | Description |
|---|---|
| One-command deploy | `make` on a fresh clone, with no network needed. |
| HTTPS everywhere | TLS 1.2/1.3 at nginx, certificate generated by the Makefile. |
| Three languages | Interface and cards. |
| Legal pages | Privacy Policy and Terms of Service with real content, linked in the footer, in all three languages. |
| Responsive | Mobile through desktop, using Tailwind breakpoints. |
| Accessibility | Keyboard navigable, visible focus rings, ARIA attributes on interactive controls, reduced-motion support, WCAG AA contrast. |
| Error screens | A 404, a crash boundary, a dead room or bracket, a dropped socket and an expired session, each answered where it happens rather than by one generic page. |
| Clean console | Checked in headless Chrome by `make console-check`. |

---

## Team Information

I built this alone, with the school's permission, even though the subject
describes a group of four or five.

| Member | Roles | Responsibilities |
|---|---|---|
| caida-si | Product Owner, Project Manager, Tech Lead, Developer | All four, and all of the code. |

Since one person held every role, here is what each one actually meant:

As Product Owner I decided what the game was and what the scoring rules should
be, and what to leave out. Community-submitted cards were dropped. They would
have unlocked the AI content-moderation minor, but they needed a submission
screen, a review queue and a content policy, which is a lot of work for one
point.

As Project Manager I ordered the work so that every finished phase left
something deliverable, and kept track of which modules depended on which.

As Tech Lead I chose the stack, designed the schema, and made the three
decisions the architecture rests on: the server owns the clock, the deck is
drawn up front, and the shared package is the only contract between the two
sides.

As Developer I wrote all of it.

### If teammates join later

I kept the work in a state where somebody could join without unpicking what
exists. Writing it down so it is a plan and not an excuse:

| Area | Why it is a clean starting point |
|---|---|
| Chat (the User interaction major) | The lobby channel already exists and already carries presence. A chat is one more message type on it plus a table. The match channel does not need to change. |
| 2FA | The `users.totp_secret` column is already there, so turning it on is a feature and not a migration of live user data. |
| Spectator mode | The room session already fans `card:revealed` and `scoreboard:update` out to every attached channel. A spectator is a channel that never receives `card:served`. |
| Health check and status page | `/api/health` already reports database reachability and uptime. The page and the backup procedure are what is missing. |
| PWA | The frontend is already a static bundle behind nginx. |
| GDPR export and delete | Every table cascades on user delete, and the Privacy Policy already promises it. |
| Card set expansion | `tools/cardgen` is written, and its collection and conversion steps have been run against the live OpenTDB pool. The AI steps are implemented and waiting for an API key. |

Each one is self-contained enough for a new member to own end to end.

---

## Project Management

### How the work was organised

Phase by phase, and no phase started before the previous one met its own
acceptance criteria. The order was chosen so that every finished phase left
something deliverable. If I had run out of time the result would have been fewer
modules and not a broken application.

```
0  Foundation   docker, HTTPS, .env, legal pages, skeleton
1  Card set     collect, convert, filter, both wordings, verify, translate, check
2  Database     Prisma schema, migration, repeatable seed
3  Users        auth, profile, avatar, friends, OAuth
4  Match        rooms, WebSockets, state machine, scoreboard, reconnection, 50/50
5  Scoring      formula, difficulties, RTT validation
6  AI           bot profiles, synthetic player
7  Modules      tournament, gamification, statistics, customization
8  i18n         interface and cards
9  Docs         README and evaluation rehearsal
```

Module dependencies were checked and not assumed. Modules 3, 6, 9, 11 and 12 all
need a working game, so nothing in phase 7 started until phase 4 could be played
end to end.

### Tools

| Tool | Use |
|---|---|
| Git | Small commits, each describing what changed. |
| The Makefile | Effectively the task list. `make test` is my definition of "still working". |
| `make e2e` | 74 assertions that play a real match through the real API. |
| `make console-check` | Headless Chrome across 17 screens, failing on any console output. |
| `make a11y` | Contrast, target size and overflow across 14 routes, both themes, 8 widths. |
| `make check` | Card set balance, coverage and the negation tell. |
| TypeScript in strict mode | With `noUncheckedIndexedAccess`, so the compiler holds the invariants the tests do not. |

### Communication

With a team of one there were no meetings and no channel to keep. What would
normally live in a Discord thread is written down in two places instead:

- In the code, as comments explaining why a decision was made wherever the
  reason is not obvious from the line itself.
- In this README, as the justification for each module and each technical
  choice.

Both exist so a reviewer, or a future teammate, can reconstruct the reasoning
without asking me.

---

## Individual Contributions

### caida-si

Architecture: the monorepo (`apps/web`, `apps/api`, `packages/shared`, `infra`,
`tools`), the 21-table schema, and the shared contract that keeps the browser
and the server in agreement.

Backend: the Fastify server, auth with Argon2id and rotating refresh tokens,
OAuth for three providers, the room registry and the match engine, the balanced
card draw, RTT validation, the AI opponent, tournaments with bracket
advancement and bot simulation, XP, achievements and statistics, and the seed.

Frontend: the whole SPA. 17 screens, the design system, both WebSocket channels
with reconnection and backoff, the countdown, and three complete locales.

Infrastructure: Docker Compose with four services, health-gated startup order,
the nginx edge with TLS, and a Makefile where `make` on a fresh clone really is
the only command needed.

Content: 360 facts across 8 categories, each written in three languages in both
wordings, which is 2,160 localised strings, plus the pipeline that can generate
more from OpenTDB.

### Challenges, and how I dealt with them

The 50/50 problem. With only two options, the proportion of true cards is
information a player can exploit. If 60% of cards were true, the best strategy
would be to answer "truth" instantly every time, and the combo multiplier would
reward exactly that. The game would be dead.

I fixed it by making balance a property of the draw and not of the card set.
Each match takes half its cards from the true pool and half from the false pool,
in two queries, then shuffles. When the card set cannot fill the requested
length, the deck shrinks and the guarantee does not: the two halves are never
allowed to differ by more than one card. See `apps/api/src/game/draw.ts`.

The negation tell, which the 50/50 fix creates. Giving each fact a true and a
false wording is the obvious way to guarantee balance, and the obvious way to
write the false one is to add "not". That would have handed players a free
strategy: look for the negation word, answer false, never read the statement.

So the false wording substitutes the key value:

> The Nile flows northward. → The Nile flows southward.

And then I measured it. `make check` counts negation words on each side. The
shipped set comes out at -1.67 percentage points, meaning negation words are
slightly more common in the true cards. There is no tell. Several true cards use
a negation naturally, like "Switzerland has no coastline", which is what pushes
the number negative.

Latency as a scoring advantage. Scoring on speed means a player on a slow
connection is punished for their network, and a modified client could claim an
impossible reaction time.

I bounded what a client is allowed to claim. The server pings every 5 seconds
and keeps a moving average of round-trip time per connection. A truthful report
has to sit inside `[serverElapsed - rtt - 250ms, serverElapsed + 250ms]`.
Anything outside falls back to the worst time of the round. The RTT used there
is capped at one second: the client decides when it answers a ping, so without
the cap a client that delays its pongs could widen the window as far as it
likes. All three numbers, claimed, RTT and accepted, are stored separately, so
the behaviour can be audited afterwards. It is about 40 lines, in
`packages/shared/src/scoring.ts`.


Reconnection without replay. The obvious design streams one card at a time and
rebuilds state when someone returns, which is fiddly and easy to get subtly
wrong.

I draw the whole deck when the match starts and write it to `match_cards`.
Reconnecting is then a lookup: find the `match_players` row, read the current
position, send a snapshot. There is no replay path because there is no state to
replay. `make e2e` drops a player mid-match and checks that the snapshot comes
back correct.

The countdown that finished early. My first version anchored the timer to the
server's `deadline_at`. On any machine whose clock differed from the server's,
the timer ran out before the window did, and players thought they had missed a
card they could still answer.

Now it anchors to the moment the card was painted in that browser, and
re-anchors from `remainingMs` when someone reconnects. The timer is decoration.
The server owns the real deadline.

A red console on a page where nothing was wrong. The subject rejects a project
whose console shows errors. My session probe returned 401 for anonymous
visitors, and Chrome logs every failed response, so every public page painted
red errors twice before rendering perfectly.

I split the endpoints. `GET /api/auth/session` answers 200 with
`authenticated: false` for the page-load probe, and `POST /api/auth/refresh`
keeps its 401 for the mid-session path. The client also renews a minute before
expiry, so a 401 never reaches the console at all. `make console-check` found
this, not luck.

An answer window eaten by a database write. `serveNext` stamped `served_at` and
`deadline_at`, then awaited the write, then sent the card. On a slow database
every millisecond of that write came out of the players' time, because the
deadline had already been fixed. The card now goes out first and the row is
written after. Measured over 18 cards afterwards, the served window is exactly
the configured 4.000 seconds every time.

Cards that ignored the language switcher. The socket's locale was fixed when it
opened, from the connection ticket, so switching language mid-match changed
every label on the page except the card. Fixed with a `locale:set` event, as
described under module 13.

Two messages from one socket, running at once. The room channel started a
handler per message without awaiting the one before it, so a client that sent
`add_bot` and `match:start` back to back could have the start read the room
before the bot was in it and be told it needed a second player. A WebSocket
delivers in order and a client is entitled to assume the server acts in order,
so the handlers are now chained on a promise. The exception is `pong`, which is
answered on arrival: it is a clock reading, and time spent waiting behind a
database query would be counted as round-trip latency, which is the number that
decides how wide a window a claimed reaction time may fall in. This came out of
writing the test for the host handover, not out of a bug report.

Prisma's engine and the container it runs in. The API crash-looped on first
boot. The client had been generated in a build stage without OpenSSL, so it
targeted `openssl-1.1.x` while the runtime image was `openssl-3.0.x`. A second
failure had the CLI unable to write its engine directory as the unprivileged
`node` user. I pinned `binaryTargets` instead of relying on auto-detection,
installed OpenSSL in the build stage as well, and gave the runtime user
ownership of the app tree. Both fixes are commented where they live, so the next
person does not have to rediscover them.

---

## Resources

### Documentation

- [Fastify](https://fastify.dev/docs/latest/), for the plugin model, hooks and error handling
- [@fastify/websocket](https://github.com/fastify/fastify-websocket). Version 11 changed the handler signature to `(socket, request)`
- [Prisma](https://www.prisma.io/docs), for the schema reference, migrations and `$queryRaw` parameter binding
- [PostgreSQL 16](https://www.postgresql.org/docs/16/), for array operators, `FILTER` and `jsonb`
- [React](https://react.dev/reference/react) and [React Router 6](https://reactrouter.com/en/main)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [i18next](https://www.i18next.com/), including `returnObjects` for the legal pages
- [MDN on WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- [MDN on Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie), for `SameSite` and `HttpOnly`

### Security

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). The Argon2id parameters (19 MiB, t=2, p=1) come from here
- [RFC 6749, OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749), for the authorization-code flow and the `state` parameter
- [RFC 9106, Argon2](https://datatracker.ietf.org/doc/html/rfc9106)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html), on why the access token does not live in `localStorage`

### Data

- [Open Trivia Database](https://opentdb.com/), CC BY-SA 4.0. The source pool for the card pipeline, with [API documentation](https://opentdb.com/api_config.php) covering the session-token mechanism
- [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

### Techniques

- The Box-Muller transform, for drawing bot reaction times from a normal distribution instead of a uniform one
- Fisher-Yates shuffle, seeded from the CSPRNG
- The [rule of three](https://en.wikipedia.org/wiki/Rule_of_three_%28statistics%29), used below for the confidence bound on a zero-error sample

### Design

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), which I used to review the prose in this README
- [AI Design Slop and how to spot it](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), which I used to review the interface

---

## How AI was used

The subject asks which tasks and which parts, so here it is in detail.

### The card pipeline

`tools/cardgen/` implements the 11-step pipeline described in
`tools/cardgen/README.md`. Three of those steps use a language model:

- `forms` takes a fact and writes its affirmative and counter-wording, twenty at
  a time.
- `verify` is a blind pass. The model reads a wording without being told the
  stored label and says whether it is true.
- `translate` translates, then blind-verifies the translation the same way,
  because translation flips meaning about as often as negation does.

The model is `claude-sonnet-5` at `temperature: 0`, called over the Anthropic
Messages API. A card the blind pass disagrees with is never resolved
automatically. It goes to `work/review-queue.json` and waits for a person.

What I actually ran matters here, so:

| Step | Status | Result |
|---|---|---|
| `counts` | Run | 21,602 questions, 5,298 verified |
| `collect` | Run | 5,248 unique questions in about 106 calls over 9 minutes, committed to `tools/cardgen/data/raw/questions.json` (2.0 MB) |
| `convert` | Run | 5,248 questions became 4,634 facts. 601 skipped as depending on their options, 13 for sensitive wording, 173 flagged by the temporal filter (105 superlatives, 37 uniqueness claims, 13 recent years, and so on) |
| `forms`, `verify`, `translate` | Not run | They need `ANTHROPIC_API_KEY`, which is not part of this deliverable |

So the card set you play is not AI-generated. All 360 facts were written by
hand, in three languages, in both wordings. The pipeline is real and tested
against the live API for the steps that do not need a key, and it is there to
grow the set later. Saying otherwise would be the easiest claim in this README
to get caught on.

### Development

I used AI as a pair programmer: scaffolding boilerplate, reviewing the
concurrency around voting, catching the Prisma binary-target mismatch, and
drafting prose for the legal pages and this README. Every architectural decision
recorded here was mine, and each one is argued for above on its own terms.

### Where I did not use it

Scoring, timing and card selection are plain deterministic functions with no
model involved. `computeScore` and `validateReaction` are about 40 lines each,
in `packages/shared/src/scoring.ts`.

The AI opponent, despite the module name, contains no language model. It is a
synthetic player with a per-category hit rate and latency drawn from a truncated
normal distribution, which is what makes it explainable, reproducible and able to
run offline.

### Residual error rate of the card set

Step 9 of the pipeline asks for a manual sample after all the filters, with a
threshold of under 2%.

Method: two independent random draws using `cardgen sample`, covering all three
languages and both wordings. I read each statement, decided true or false
myself, then compared with the stored label.

Result: 103 cards reviewed, 0 label errors, so a measured residual error rate of
0.0%.

The honest caveat is that zero errors in 103 samples only puts the 95% upper
confidence bound at about 2.9%, by the rule of three. The true rate is probably
under the 2% threshold, but 103 samples cannot prove it. Quoting 0.0% without
that bound would claim more than the sample supports.

The structural checks are exhaustive rather than sampled, and they all pass:

```
Categories: 8      Facts: 360      Cards: 720 (360 true, 360 false)
en 720 (100.0%)    pt-BR 720 (100.0%)    fr 720 (100.0%)
Negation tell skew: -1.67 percentage points
No structural problems found.
```

---

## Testing

```sh
make test          # typecheck every workspace, then e2e, then the console check
```

`make e2e` runs 74 assertions that play a real match through the real API and
the real WebSocket. Two accounts sign up and log in, a room is created, a bot is
added, six cards are played, one player is dropped mid-match and reconnects, one
player switches language mid-card, the host then walks out of a second room and
the last human walks out of a match, and the saved results are checked
afterwards.

Among other things it checks that the deck was exactly half true and half false,
that a correct answer never scores below the base, that a wrong answer costs
exactly 50, that every card carries a source reference, that only the host can
start, that the reconnect snapshot has the right position and scoreboard, that
switching language re-languages the card without restarting the countdown, that
the host badge lands on the player who is left, that a match everyone walked out
of is not counted as played, and that bots are kept off the leaderboard.

`make console-check` loads 17 screens in headless Chrome, signs in, switches
language three times and opens a room, which opens both WebSocket channels. It
fails on any console error or warning, any page error, any failed request, and
any non-API HTTP status of 400 or more.

```
74 passed, 0 failed
Checked 17 screens in headless Chrome.
Console is clean: no errors, no warnings, no failed requests.
```

`make check` validates the card set offline: balance per category and
difficulty, translation coverage, duplicate references, degenerate wordings, and
the negation tell.

---

## Known limitations

Listing these because a reviewer will find them anyway.

The match engine runs in one process. Live room state and the phase timers are
held in memory in the API process and written through to Postgres. This works
because exactly one API container runs. Scaling horizontally would need the
timers behind a shared lock or moved into their own service. I took the
trade-off knowingly: the alternative buys nothing at this scale and costs a lot
of complexity.

Bots added to a room lobby are held in memory. If the API restarts while a room
is sitting in its lobby, the bots have to be added again. Bots inside a running
match are rows in `match_players` and survive.

The card set is 360 facts. That is comfortable for general-knowledge rooms at
any difficulty. A single-category room on hard has 14 facts to draw from, so it
deals a 14-card match and not a 30-card one. The room creation screen shows the
available count, and the draw shrinks the deck rather than the 50/50 guarantee.
`tools/cardgen` exists to grow this.

The certificate is self-signed, so Chrome warns once. A real deployment would
use a real certificate and nothing else would change.

There is no email delivery, so there is no password-reset flow. The Privacy
Policy says so.

Statistics are computed at read time. That is correct by construction and fast
at this scale. If it ever stops being fast the answer is a materialised view,
and the schema is ready for one.

Two checkouts on one machine collide. `docker-compose.yml` pins the project name
to `wkb`, so a second clone reuses the same containers and the same `pgdata`
volume, and the database keeps whichever `.env` password created it first. This
is fine for an evaluation, which is one checkout. Run `make fclean` before
switching between copies.

Accessibility is good but not audited. Keyboard navigation including `T` and `M`
to vote, focus rings, ARIA attributes on interactive controls, reduced-motion
support and a `lang` attribute that follows the chosen locale are all in place,
and every text and background pair meets WCAG AA in light and in dark, with the worst
against a 4.5:1 requirement, measured on every visible text node across fourteen
routes in both themes rather than sampled. Interactive targets were measured rather
than eyeballed: every one on every route clears the 24x24 of WCAG 2.2 SC 2.5.8,
counting a control inside a padded label as the label, and excluding links that
sit inside a sentence, which that criterion exempts. Fourteen routes were checked
for horizontal overflow at eight widths from 320px to 1440px. I did not do a
screen-reader pass, so I am not claiming the WCAG 2.1 AA module.

Reusing a rotated refresh token is not treated as theft. The textbook defence
is to revoke every session of a user whose old token shows up again, but here
it would log people out for ordinary reasons: two tabs renewing at the same
moment, or another device renewing after a password change, both present a
token that was just revoked. Telling those apart from a stolen token needs
each token to record what replaced it, which the schema does not do. The
cookie is httpOnly, Secure and SameSite=Strict, so stealing it in the first
place is already hard.


---

## Evaluation checklist

- [x] Boots from a fresh clone with one command, with no network
- [x] Frontend, backend and database, all in containers
- [x] HTTPS on every external connection
- [x] Chrome console clean on every screen, checked in headless Chrome
- [x] Privacy Policy and Terms of Service with real content, in the footer, in three languages
- [x] Multiple simultaneous users with no data corruption and no race conditions
- [x] Responsive frontend using a CSS framework
- [x] Credentials in `.env`, git-ignored, with a committed `.env.example`
- [x] Clear schema with well-defined relations
- [x] Email and password auth, hashed and salted with Argon2id
- [x] Input validation on the frontend and the backend, from one shared schema
- [x] Git history with clear commit messages
- [x] Complete README in English

When demonstrating:

1. Open three or more browser windows. With two, the Multiplayer 3+ module
   counts as not demonstrated.
2. Show disconnection and reconnection live. Close a tab mid-match, watch the
   scoreboard grey that player out, then reopen it and rejoin.
3. Demonstrate every module claimed. An incomplete one scores zero.
4. Be ready for a small change on the spot.

Good things to ask me about: why the server owns the clock, why the deck is
drawn up front, why the false wording substitutes instead of negating and what
`make check` measures about it, what the three time columns in `answers` are
for, and why the AI opponent is not a language model.

---

## License and credits

The source code is MIT. See [`LICENSE`](LICENSE).

The card set is under Creative Commons Attribution-ShareAlike 4.0 International
(CC BY-SA 4.0). See [`LICENSE-CARDS.md`](LICENSE-CARDS.md).

The interface font is [Archivo](https://github.com/Omnibus-Type/Archivo) by
Omnibus-Type, under the SIL Open Font License 1.1. It is committed to
`apps/web/public/fonts/` and served from this origin, and its licence travels
with it in `apps/web/public/fonts/OFL.txt`.

### Attribution

The suit drawings and the rest of the interface are original work under the
project's MIT licence.

[Open Trivia Database](https://opentdb.com/), CC BY-SA 4.0, is the source pool
for the card pipeline in `tools/cardgen/`, and its raw collection is committed
to `tools/cardgen/data/raw/`. Share-alike propagates, so the whole card set
carries the same licence.

The attribution appears in three places, as the licence requires: a footer link
on every page, a clause in the Terms of Service in all three languages, and
`LICENSE-CARDS.md`.

Every fact carries a `source_ref` and a `license` column, so any card can be
traced back to where it came from: `curated:<ref>` for the hand-written set and
`opentdb:<sha256>` for anything derived from OpenTDB.

---

*Built for 42 Luxembourg. Run `make`, then open <https://localhost:8443>.*
