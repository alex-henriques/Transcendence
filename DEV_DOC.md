# Developer map

Where everything lives, and which file to open when you want to change
something. The README explains what the project is and why it works the way it
does. This file is the index.

## Layout at a glance

```
ft_transcendence/
├── apps/
│   ├── api/          Fastify server, Prisma schema, the seed
│   └── web/          React single-page app
├── packages/
│   └── shared/       Types, Zod schemas and scoring, used by both sides
├── infra/nginx/      The TLS edge config, and the generated certificate
├── tools/
│   ├── cardgen/      Offline pipeline that builds card sets from OpenTDB
│   └── scripts/      Setup and test scripts the Makefile calls
├── docker-compose.yml
├── Makefile          Every task you will need
└── .env.example      Every configuration key, documented
```

Roughly: 4,800 lines of backend, 6,800 of frontend, 520 shared, 1,000 in the
card pipeline.

## The shared package is the contract

`packages/shared/src/` is imported by the browser and the server. Anything that
both sides have to agree on goes here, and nowhere else.

| File | Holds |
|---|---|
| `constants.ts` | Locales, difficulties and their presets, scoring constants, room limits, the XP curve |
| `events.ts` | Every WebSocket message, in both directions |
| `scoring.ts` | `computeScore`, `validateReaction`, `applyDelta` |
| `validation.ts` | Every Zod schema used by a form or a route |
| `index.ts` | Re-exports the four above |

If you change a type here, run `npm run build -w @wkb/shared` (or just
`make typecheck`) before the other two workspaces will see it.

## Where the cards are

Cards exist in three places, in this order.

**1. Source files, committed.** `apps/api/prisma/seed/facts/*.json`, one file
per category, eight files, 360 facts. This is the only place you edit cards by
hand. The shape is:

```json
{
  "category": { "slug": "geography", "name": "Geography" },
  "license": "CC BY-SA 4.0",
  "facts": [
    {
      "ref": "geo-001",
      "difficulty": "easy",
      "en":    { "t": "The Nile flows northward.", "f": "The Nile flows southward." },
      "pt-BR": { "t": "O Nilo corre para o norte.", "f": "O Nilo corre para o sul." },
      "fr":    { "t": "Le Nil coule vers le nord.", "f": "Le Nil coule vers le sud." }
    }
  ]
}
```

`t` is the affirmative wording and is always true. `f` is the counter-wording
and is always false. Build `f` by substituting the key value, not by adding
"not". `make check` measures how well that holds.

**2. The database.** The seed reads those files into four tables: `categories`,
`facts`, `cards` and `card_translations`. One fact becomes two rows in `cards`,
and each of those gets two rows in `card_translations` for the non-English
locales.

**3. In a match.** `match_cards` holds the deck for one match, drawn when the
match starts.

To add or edit cards: change the JSON, then `make seed`. The seed matches on
`source_ref`, so running it again updates rather than duplicates.

## Where the translations are

Two separate systems, for two different kinds of text.

**Interface text** lives in `apps/web/src/i18n/locales/{en,pt-BR,fr}.json`, 436
strings each. The keys must match exactly across the three files. This includes
the Privacy Policy and the Terms of Service, which are stored as arrays of
paragraphs under `legal.privacy` and `legal.terms` and rendered by
`pages/Legal.tsx`.

**Card text** lives in the database, in `card_translations`, and comes from the
`pt-BR` and `fr` blocks of the source JSON above.

Related files:

| File | Purpose |
|---|---|
| `apps/web/src/i18n/index.ts` | i18next setup, language detection, `setLocale` |
| `apps/web/src/i18n/localeBus.ts` | Tells the open room socket that the language changed |
| `apps/web/src/components/LanguageSwitcher.tsx` | The EN / PT / FR control |

Category and achievement names are stored in English in the database and
translated in the browser by slug, under the `categories.*` and `achievements.*`
keys, falling back to the stored name.

To add a language: add it to `LOCALES` in `packages/shared/src/constants.ts`,
add a locale file, register it in `i18n/index.ts`, and add the wording to every
card in the eight source files.

## Where the game rules are

| Rule | File |
|---|---|
| Points, speed bonus, combo, the zero floor | `packages/shared/src/scoring.ts` |
| Reaction-time plausibility check | `packages/shared/src/scoring.ts`, `validateReaction` |
| Difficulty presets (window, card count) | `packages/shared/src/constants.ts` |
| Drawing a balanced deck | `apps/api/src/game/draw.ts` |
| The match state machine | `apps/api/src/game/engine.ts` |
| Bot behaviour | `apps/api/src/game/bot.ts` |
| Bot personalities | `apps/api/src/seed/data.ts` |
| Live room and lobby state | `apps/api/src/game/registry.ts` |
| Host handover and walking out of a match | `handleDeparture` in `apps/api/src/game/engine.ts` |

`engine.ts` is the biggest file in the project and the one to read first. It
owns the clock: it decides when a card is served, when the window closes, and
what a vote is worth.

## Where the API is

`apps/api/src/`

| Directory | Contents |
|---|---|
| `routes/` | One file per area: `auth`, `oauth`, `users`, `friends`, `rooms`, `catalog`, `stats`, `tournaments`, `health` |
| | `oauth.ts` covers Google, GitHub and 42. The endpoints are a table keyed by the provider slug, and the slug is what the callback URL says, so 42's redirect URI ends `/api/auth/oauth/42/callback` |
| `ws/` | `room.ts` and `lobby.ts` are the two channels, `connection.ts` wraps a socket and owns the heartbeat, `ticket.ts` issues the single-use handshake tickets |
| `services/` | Logic used by more than one route: `stats`, `rewards`, `tournament`, `rooms` |
| `game/` | The engine, the draw, the bots, the registry |
| `lib/` | Small helpers: `tokens`, `password`, `random`, `images`, `serialize`, `httpError` |
| `plugins/` | `auth.ts` is the route guard, `errors.ts` turns every throwable into one JSON shape |
| `seed/` | `index.ts` loads everything, `data.ts` holds bots, achievements and demo users |
| `server.ts` | Registers every plugin and route. Start here to find anything |
| `env.ts` | Configuration, validated once at boot |
| `db.ts` | The Prisma client |

## Where the frontend is

`apps/web/src/`

| Directory | Contents |
|---|---|
| `pages/` | One file per screen. `Room.tsx` is the match and is the largest. `Welcome.tsx` is the public front page at `/`, `Setup.tsx` the first-run screen |
| `components/` | `ui.tsx` has the primitives, `game.tsx` has the card, timer, vote buttons and scoreboard, `Layout.tsx` is the shell |
| `components/DeadEnd.tsx` | A room or bracket that is not there, dealt as a card with a Myth verdict |
| `components/ErrorBoundary.tsx` | The one class component in the codebase, because React offers no hook for this |
| `components/ConnectionLost.tsx` | The floating notice while the room socket is away |
| `components/AvatarPicker.tsx` | The sixteen stock avatars, grouped by suit |
| `theme/avatars.tsx` | Those sixteen drawings: two per suit, one that is not a person and one who is |
| `ws/` | `useRoomChannel.ts` and `useLobbyChannel.ts` are the two socket hooks, `socket.ts` handles the ticket handshake |
| `api/client.ts` | The fetch wrapper, token refresh and error shape |
| `auth/AuthContext.tsx` | Session state, silent refresh, proactive renewal |
| `i18n/` | Translations, described above |
| `theme/cardStyle.ts` | Whether suits and motion are on, optional. See below |
| `theme/suits.tsx` | The eight suits: colour, crest and corner pip for each category |
| `theme/useTheme.ts` | Theme primitives: the three values, applying one, remembering it |
| `theme/ThemeContext.tsx` | The React state behind it, so every control changes the same value |
| `index.css` | Base layer and component classes |
| `App.tsx` | Every route |

The front door is `/` and the play screen is `/play`. They were the other way
round until the welcome page existed: arriving at the site should say what the
site is, even to someone who already has an account, and play is one click away
in the nav and on the welcome page's own button. `RequireAuth` guards the
authenticated routes and sends an account with no `onboarded_at` to `/setup`
before anything else.

Design tokens (colours, fonts, radii) are in `apps/web/tailwind.config.js`.

### Green means right, and nothing else

Four colours carry meaning in the match, in two pairs that must never be
confused for one another:

| Pair | Tokens | Means |
|---|---|---|
| Outcome | `correct` (green), `wrong` (red) | Whether **you** were right |
| Answer | `truth` (ink blue), `myth` (plum) | What the **statement** turned out to be |

The reveal panel is framed in the outcome pair and says what the statement was
in the answer pair. Painting the frame by the statement — which is what it used
to do — meant that calling a myth correctly produced a red panel, and the small
green "Correct" underneath it was arguing with the large red box around it.

For the same reason the two vote buttons are blue and plum rather than green
and red: a myth is not a mistake, and a red button is a verdict on a press that
has not happened yet. The answer-window timer runs ink → ochre → red for the
same reason it never goes green.

Anything outside the match that means *good* or *bad* — a success alert, a form
error, an online dot, a positive score delta — uses `correct` and `wrong`.

## The deck: suits, themes and animation

`apps/web/src/theme/suits.tsx` holds the eight suits — a colour, a crest and a
corner pip per category. `apps/web/src/theme/cardStyle.ts` only decides whether
they are used:

```ts
export const CARD_SUITS = true;    // per-category colour, crest and pips
export const CARD_MOTION = true;   // deal, stamp, tick, urgency
```

Setting both to false gives you a plain card and changes nothing else. To
remove the feature entirely, delete those two files, delete the block at the
bottom of `index.css` marked "The deck", and drop the imports in
`components/game.tsx`.

Colours are RGB channels behind CSS variables (`tailwind.config.js` wraps each
in `rgb(var(--x) / <alpha-value>)`), which is why the whole app re-themes
without any utility class being touched, and why `border-truth/40` still works.
A card sets `--cat` and `--cat-wash` from its suit and everything on it —
band, keyline, crest, pips, rules — reads those rather than being handed a
colour.

The card's own colours (`--card`, `--card-ink`, `--card-edge`) are declared
once, outside both themes. That is deliberate: the card is paper, and only the
room around it changes.

The animations themselves are keyframes in `index.css`: `deal-in`, `stamp`,
`tick-up` and `urgency`, plus a `press` class carried by every button, which
takes the key down instantly and lets it back up over Tailwind's 150ms.

`deal-in` runs because `Room.tsx` keys `<CardFace>` on the card id, which
remounts it for every card. The key is at the call site on purpose: there it
plainly remounts the component, where a key on one node inside that component
depends on how the nodes around it happen to be arranged. It fills `backwards`
rather than `both` — a forwards-filled animation keeps applying its last frame,
and an animation's opacity outranks a class's, which silently defeated the
`opacity-70` dimming of the card during the reveal.

The `prefers-reduced-motion` rule in the base layer disables all of them, and
also zeroes `animation-delay`, without which a staggered group still arrives as
a timed sequence of pops. There are two exemptions. The loading spinner keeps
turning: a stopped spinner reads as a broken arc rather than as calm, and it is
the only sign that anything is happening. And the deal falls back to
`deal-quiet`, a 140ms fade with no travel at all, because a new card still has
to announce that it is a new card — reduced motion asks for less movement, not
for no feedback. **If the deal appears not to run at all, check that setting
first**: on such a machine every keyframe in the app collapses to nothing.

The scoreboard's row reordering is not a keyframe. It is a FLIP in
`useRankFlip` (`components/game.tsx`), measured with `offsetTop` so that
scrolling is not mistaken for movement, and played through WAAPI so a second
reorder landing mid-slide continues from where the row actually is.

## When something goes wrong

Four surfaces can fail, and each answers differently.

| Surface | What the player gets |
|---|---|
| A route that matches nothing | `NotFound.tsx`: the visitor from the space suit, adrift |
| A thrown render | `ErrorBoundary.tsx`, mounted in `main.tsx` |
| A room or bracket that is not there | `DeadEnd.tsx`, dealt as a card |
| The API or the app unreachable | nginx answers on its own, see below |

`DeadEnd` is the one worth explaining. Every case it covers is the app telling
a player that something they believed is not true, which is the shape of the
game, so it is served the way the game serves everything else: the false belief
as a statement on a card, then the verdict stamped underneath. The verdict is
always Myth and always plum, never the red of a wrong answer, because nobody
got anything wrong. One component covers a bad code, a finished room, a full
room, removal by the host and a missing bracket.

The edge proxy answers a fault itself rather than letting nginx print its
default page, which used to include the exact nginx version. It answers
differently depending on who asked: a browser gets `infra/nginx/50x.html`,
which is inlined to the last byte because the stylesheet and the font are among
the things that are not loading, and `fetch` gets JSON in the shape
`api/client.ts` already parses.

Two things that end a session are easy to confuse. `onSessionExpired` fires
when an API call gets a 401 and the silent refresh fails; the renewal timer
finding a dead cookie goes through `restore()` instead. Both set `expired` on
the auth context, and a `hadSession` ref keeps them apart from "you were never
signed in", which needs no explanation. Only the first of those was handled at
first, and it is the rarer of the two.

## Where the database is defined

| Thing | Location |
|---|---|
| Schema | `apps/api/prisma/schema.prisma`, 21 models |
| Migration | `apps/api/prisma/migrations/`, applied on every boot |
| Seed | `apps/api/src/seed/index.ts` |
| Seed data | `apps/api/src/seed/data.ts` for bots, achievements and demo users |
| Card source | `apps/api/prisma/seed/facts/*.json` |

After editing `schema.prisma`, create a migration:

```sh
docker compose up -d postgres
docker run --rm -v "$PWD":/w -w /w --network wkb_wkb \
  -e DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env)" \
  node:22-bookworm-slim \
  npx prisma migrate dev --schema apps/api/prisma/schema.prisma --name your_change
```

## Where the infrastructure is

| Thing | Location |
|---|---|
| Service definitions | `docker-compose.yml` |
| API image | `apps/api/Dockerfile` |
| Web image | `apps/web/Dockerfile` |
| Edge proxy and TLS | `infra/nginx/nginx.conf` |
| SPA static host | `apps/web/nginx.conf` |
| Certificate generation | `tools/scripts/gen-certs.sh` |
| Secret generation | `tools/scripts/gen-env.sh` |
| API startup sequence | `apps/api/docker-entrypoint.sh` |

Only nginx publishes a port. Everything else talks over the internal network.

## Where the tests are

| Command | Script | Checks |
|---|---|---|
| `make e2e` | `tools/scripts/e2e.mjs` | 74 assertions, playing a real match through the real API |
| `make console-check` | `tools/scripts/console-check.mjs` | 17 screens in headless Chrome, failing on any console output |
| `make check` | `tools/cardgen/src/report.ts` | Card set balance, coverage, the negation tell |
| `make typecheck` | | Every workspace with `tsc --noEmit` |
| `make test` | | All of the above except `check` |

`e2e.mjs` has no dependencies. It uses Node 22's built-in WebSocket so it runs
against a clone that has never had `npm install`.

## How the pieces talk

```
  browser                          server
  ───────                          ──────
  POST /api/auth/login ─────────▶  routes/auth.ts
       access token in memory  ◀─  + refresh cookie

  POST /api/ws/ticket ──────────▶  ws/ticket.ts
       single-use ticket       ◀─

  wss://…/ws/room?ticket=… ────▶  ws/room.ts
       room:join              ─▶  game/engine.ts  ──▶ Postgres
       room:state             ◀─
       card:served            ◀─  (per connection, in the player's language)
       card:vote              ─▶  engine.handleVote → validateReaction → applyVote
       vote:ack               ◀─
       card:revealed          ◀─  (per connection: the correction is localised)
       match:ended            ◀─  services/rewards.ts, services/tournament.ts
```

## Common tasks

**Add a card.** Edit the right file in `apps/api/prisma/seed/facts/`, then
`make seed`, then `make check`.

**Add a category.** Create a new file in the same directory with a new `slug`,
add the translated name under `categories.<slug>` in all three locale files, add
a suit in `theme/suits.tsx` if you want it to have one, then `make seed`.

**Change the scoring.** `packages/shared/src/scoring.ts` for the formula,
`packages/shared/src/constants.ts` for the numbers. Both sides pick it up after
`make typecheck`.

**Add an achievement.** Add an entry to `ACHIEVEMENTS` in
`apps/api/src/seed/data.ts`, add the name and description under
`achievements.<slug>` in all three locale files, and if the rule is new, add a
case to `unlockedSlugs` in `apps/api/src/services/rewards.ts`. Then `make seed`.

**Add a bot.** Add an entry to `BOTS` in `apps/api/src/seed/data.ts` and a
one-line description under `bot.<name>` in all three locale files, then
`make seed`.

**Add a WebSocket message.** Add it to the right union in
`packages/shared/src/events.ts`, handle it in `apps/api/src/ws/room.ts`, and
handle it in `apps/web/src/ws/useRoomChannel.ts`.

**Add a screen.** Add the page under `apps/web/src/pages/`, add a route in
`App.tsx`, add its strings to all three locale files, and add it to the list in
`tools/scripts/console-check.mjs`.

**Change the look.** Colours, fonts and radii are in
`apps/web/tailwind.config.js`. Shared component classes are in `index.css`.

**Reset everything.** `make fclean` drops the containers, the images and the
database. `make` builds it again from nothing.

## Things that will surprise you

The server owns the clock. The browser never decides that time is up. If you
are debugging a timing problem, the answer is in `engine.ts` and not in the
React code.

Green and red mean one thing only. `correct` and `wrong` say whether the player
was right; the two answers are `truth` (blue) and `myth` (plum). If you reach
for `text-correct` to colour something that is not an outcome, you are about to
put the app back where it was. See "Green means right, and nothing else".

An avatar choice lives in `users.avatar_url`, not in a column of its own. A
stock avatar is stored as `preset:<id>`; an uploaded one is a path. That field
already answers exactly one question, how is this person drawn, and those are
two answers to it, so all eleven screens that render an avatar read one field.
`presetFromStored` returns null for anything not on the shipped list, so a
stale or tampered value can never reach a renderer.

A new account is redirected, from wherever it was going, to `/setup`. The gate
is in `RequireAuth` rather than on the login screen, because an account arrives
signed in by several paths — the form, an OAuth callback, a silent refresh in a
returning tab — and only one of them passes through a screen that could have
redirected it. The demo accounts are seeded with `onboarded_at` set, so they
never see it.

The deck is drawn up front. All the cards for a match are written to
`match_cards` when it starts, which is why reconnecting is a lookup and not a
replay.

Player history is keyed by fact, not by card. `user_seen_facts` uses `fact_id`,
so a player who has seen one wording of a fact will never see the other.

The socket carries a locale. It is set from the connection ticket when the
socket opens, and updated by the `locale:set` message. Cards, and the correction
shown at the reveal, are rendered server-side in that language.

Every fact has a true wording and a false one, and the reveal always sends the
true one as `correction`. That is what tells a player what is actually the case
after they have been shown something false. `hydrate` in `engine.ts` loads both
wordings of every card in the deck for exactly this.

Scores never go below zero. The penalty is real, but `applyDelta` floors the
total, and the stored `points_awarded` is the amount actually applied.

Who the host is lives in `rooms.host_user_id`, not in memory, because every
host-only check reads it from there. When the host's last socket goes,
`handleDeparture` writes the badge to the human who has been in the room
longest. Bots are never candidates: the list of candidates is read off the open
sockets, and a bot never holds one. The same method stops the match when the
channel set empties, since that is exactly the case where only bots are left.

The seed runs on every boot. It is written to be safe to repeat, matching on
`source_ref` for facts and on the natural key for everything else.
