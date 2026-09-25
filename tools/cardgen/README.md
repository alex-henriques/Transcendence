# cardgen, the card-set pipeline

This is a maintenance tool. It is not part of the application.

It runs on a developer machine, its output is committed to the repository, and
the running game never contacts OpenTDB. That last point matters: "runs with a
single command" is a rejection criterion, so `make` has to work with no network
and no API key, on a machine that has never seen this project before.

```
make cardgen ARGS="check"
```

Everything runs inside the pinned Node image, so you do not need Node installed.

## The steps

| Command | Step | Needs | What it does |
|---|---|---|---|
| `counts` | 1 | network | Asks OpenTDB for exact global and per-category counts. Nothing downstream is planned on an estimate. |
| `collect` | 2-3 | network | Pulls the whole pool using a session token, so the API never returns the same question twice in one run. Writes the raw JSON to `data/raw/questions.json`, keyed by the SHA-256 of each question. |
| `convert` | 4-5 | offline | Turns questions into facts and applies the filters. |
| `forms` | 6 | `ANTHROPIC_API_KEY` | Writes the affirmative and counter-wording of each fact, twenty per call. |
| `verify` | 7 | `ANTHROPIC_API_KEY` | A blind check. The model reads a wording without its stored label and says whether it is true. |
| `translate <locale>` | 8 | `ANTHROPIC_API_KEY` | Translates, then blind-verifies the translation the same way. |
| `sample [n]` | 9 | offline | Draws a random sample for manual review. |
| `check` | 10 | offline | Balance, coverage and the negation tell. |
| `export` | 11 | offline | Says where the shipped card set lives. |

## Decisions worth explaining

One fact per question. A multiple-choice question with three wrong options is
one fact, not four. All four options are the same piece of knowledge: somebody
who knows the capital of Australia will answer every variant without thinking.
Generating one card per wrong option would inflate the count while making the
card set feel repetitive, which defeats the purpose of having one.

Two wordings per fact, with the false one built by substitution. Each fact
becomes an affirmative card, which is true, and a counter-wording card, which is
false. The obvious way to write the false one is to insert "not", and that is a
trap. If every false card contained a negation word, a player could win by
scanning for "not" and never reading the statement.

So the false wording replaces the key value with a plausible wrong one:

> The Nile flows northward.  →  The Nile flows southward.

`cardgen check` measures how well this holds by counting negation words on each
side. On the shipped set the skew is -1.67 percentage points, so negation words
are slightly more common in the true cards. There is no tell to find.

Blind verification. The verifying model is never shown the stored label.
Negation is where truth values get flipped most often, and translation is second.
A disagreement is never resolved automatically: it goes to
`work/review-queue.json` and waits for a person. A card whose stored answer is
wrong is the worst thing that can happen during an evaluation.

The temporal filter. Statements containing "currently", "the most recent",
"record", "the only", a superlative or a recent year are flagged, because they
go stale without anything noticing. Superlatives are the noisy rule, since "the
largest ocean" is stable while "the largest company" is not, so they are flagged
for review and never discarded automatically.

Eight macro-categories, not OpenTDB's 24. Narrow categories like board games,
vehicles or anime never reach enough facts to sustain a category room, and a
room that runs out after two matches is worse than not offering it. `convert.ts`
maps the 24 onto 8.

## Why the raw dump is committed

`data/raw/questions.json` is the source of everything downstream. Committing it
means the pipeline can be re-run and re-checked without collecting again, and
OpenTDB being unreachable never becomes a problem, for the pipeline or for the
evaluation.

## Licence

The output is CC BY-SA 4.0, inherited from OpenTDB. See `LICENSE-CARDS.md` at
the repository root.
