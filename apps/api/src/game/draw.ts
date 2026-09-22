import { Prisma } from '@prisma/client';
import type { Difficulty } from '@wkb/shared';
import { prisma } from '../db.js';
import { shuffle } from '../lib/random.js';

export interface DrawnCard {
  cardId: number;
  factId: number;
  isTrue: boolean;
}

export interface DrawRequest {
  /** Human players in the room. Facts any of them has seen are avoided. */
  userIds: number[];
  /** Empty means "every category". */
  categoryIds: number[];
  difficulty: Difficulty;
  count: number;
}

interface DrawRow {
  cardId: number;
  factId: number;
  isTrue: boolean;
}

/**
 * Pulls one half of the deck.
 *
 * `excludeFactIds` is what keeps a fact's two wordings out of the same match:
 * the affirmative form is true and the negated form is false, so without it
 * the true half and the false half could each pick a wording of the same fact
 * and hand the room a free point.
 */
async function drawHalf(params: {
  req: DrawRequest;
  isTrue: boolean;
  limit: number;
  excludeFactIds: number[];
  allowSeen: boolean;
}): Promise<DrawRow[]> {
  const { req, isTrue, limit, excludeFactIds, allowSeen } = params;
  if (limit <= 0) return [];

  const categories = req.categoryIds;
  const users = req.userIds;

  return prisma.$queryRaw<DrawRow[]>(Prisma.sql`
    SELECT c.id AS "cardId", c.fact_id AS "factId", c.is_true AS "isTrue"
    FROM cards c
    JOIN facts f ON f.id = c.fact_id
    WHERE f.active
      AND (cardinality(${categories}::int[]) = 0 OR f.category_id = ANY(${categories}::int[]))
      AND f.difficulty = ${req.difficulty}::"Difficulty"
      AND c.is_true = ${isTrue}
      AND NOT (f.id = ANY(${excludeFactIds}::int[]))
      AND (
        ${allowSeen}
        OR NOT EXISTS (
          SELECT 1 FROM user_seen_facts s
          WHERE s.fact_id = f.id AND s.user_id = ANY(${users}::int[])
        )
      )
    ORDER BY random()
    LIMIT ${limit}
  `);
}

/**
 * Builds the deck for one match.
 *
 * Half the cards are true and half are false, always (spec §10). With a binary
 * answer, any deviation from 50/50 is exploitable information: if most cards
 * were true, voting "truth" instantly would beat playing, and the combo
 * multiplier would reward exactly that.
 *
 * The unseen-fact constraint is relaxed rather than enforced to the point of
 * failure: a small card set must still be able to start a match, so a second
 * pass tops the deck up from facts the room has already seen.
 */
export async function drawMatchDeck(req: DrawRequest): Promise<DrawnCard[]> {
  const trueTarget = Math.floor(req.count / 2);
  const falseTarget = req.count - trueTarget;

  const used = new Set<number>();
  const picked: DrawRow[] = [];

  const take = (rows: DrawRow[]) => {
    for (const row of rows) {
      if (used.has(row.factId)) continue;
      used.add(row.factId);
      picked.push(row);
    }
  };

  const countOf = (isTrue: boolean) => picked.filter((c) => c.isTrue === isTrue).length;

  for (const allowSeen of [false, true]) {
    const needTrue = trueTarget - countOf(true);
    if (needTrue > 0) {
      take(
        await drawHalf({ req, isTrue: true, limit: needTrue, excludeFactIds: [...used], allowSeen }),
      );
    }
    const needFalse = falseTarget - countOf(false);
    if (needFalse > 0) {
      take(
        await drawHalf({
          req,
          isTrue: false,
          limit: needFalse,
          excludeFactIds: [...used],
          allowSeen,
        }),
      );
    }
    if (countOf(true) >= trueTarget && countOf(false) >= falseTarget) break;
  }

  // The card set may not be able to honour the requested length at this
  // difficulty and category. Shrink the deck rather than the guarantee: the
  // two halves are never allowed to differ by more than one card.
  const trues = picked.filter((c) => c.isTrue);
  const falses = picked.filter((c) => !c.isTrue);

  let nTrue = Math.min(trues.length, trueTarget);
  let nFalse = Math.min(falses.length, falseTarget);
  if (nTrue > nFalse + 1) nTrue = nFalse + 1;
  if (nFalse > nTrue + 1) nFalse = nTrue + 1;

  const deck = shuffle([...trues.slice(0, nTrue), ...falses.slice(0, nFalse)]);

  return deck.map((row) => ({ cardId: row.cardId, factId: row.factId, isTrue: row.isTrue }));
}

/**
 * The longest deck the card set can deal for these settings.
 *
 * A fact contributes at most one card to a match, so the ceiling is the number
 * of usable facts and not the number of cards. Counting cards would double
 * the figure and promise a match length that cannot be dealt.
 */
export async function availableDeckSize(params: {
  categoryIds: number[];
  difficulty: Difficulty;
}): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*) AS n
    FROM facts f
    WHERE f.active
      AND (cardinality(${params.categoryIds}::int[]) = 0
           OR f.category_id = ANY(${params.categoryIds}::int[]))
      AND f.difficulty = ${params.difficulty}::"Difficulty"
      AND EXISTS (SELECT 1 FROM cards c WHERE c.fact_id = f.id AND c.is_true)
      AND EXISTS (SELECT 1 FROM cards c WHERE c.fact_id = f.id AND NOT c.is_true)
  `);
  return Number(rows[0]?.n ?? 0);
}
