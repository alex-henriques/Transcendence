# Card set licence

The card set for Who knows best?, meaning every file under
`apps/api/prisma/seed/facts/` and every raw dump under `tools/cardgen/data/`,
is licensed under the

**Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**

<https://creativecommons.org/licenses/by-sa/4.0/>

## Why share-alike

The card-generation pipeline in `tools/cardgen/` is built to derive cards from
the [Open Trivia Database](https://opentdb.com/), which is itself published
under CC BY-SA 4.0. Share-alike propagates: anything derived from it carries
the same licence.

Tracking two licences across one card set would be fragile, so the whole set is
released under CC BY-SA 4.0, whether a given card came from OpenTDB or was
written by hand for this project. The obligation stays simple and hard to get
wrong by accident.

## Attribution

- Open Trivia Database, <https://opentdb.com/>, CC BY-SA 4.0. The source of the
  questions the pipeline converts into facts.
- The Who knows best? card set, curated and translated for this project,
  CC BY-SA 4.0.

Users see the attribution in three places, as the licence requires:

1. A footer link on every page of the application.
2. A dedicated clause in the Terms of Service (§ *Content licence and
   attribution*), in all three supported languages.
3. This file.

## Your obligations if you reuse it

- Credit the sources above.
- Release any derived card set under CC BY-SA 4.0 as well.
- State what you changed.

## Provenance

Every fact carries a `source_ref` and a `license` column in the database, so
any individual card can be traced back to where it came from:

- `curated:<ref>` for statements written and verified for this project.
- `opentdb:<sha1>` for anything derived from the OpenTDB question with that
  content hash, stored verbatim in `tools/cardgen/data/raw/questions.json`.
