/**
 * The deck: what a card looks like and whether it moves.
 *
 * This whole file is optional decoration. To remove the feature entirely:
 *   1. set both flags below to false (nothing else has to change), or
 *   2. delete this file, theme/suits.tsx, the "The deck" block in index.css,
 *      and the imports in components/game.tsx.
 *
 * Nothing about the rules, the timing or the scoring reads anything from here.
 * The colours and the drawings live in theme/suits.tsx; this file only decides
 * whether they are used.
 */

/** Per-category suits: colour, crest and corner pips. Off means a plain card. */
export const CARD_SUITS = true;

/** Deal, stamp and tick animations. Off means the card just appears. */
export const CARD_MOTION = true;

/**
 * How far each sheet of the remaining deck sits behind the card in play.
 * Squared off rather than fanned: a stack of cards on a table does not splay
 * unless something pushes it.
 */
export const DECK_OFFSETS = [
  { dx: 11, dy: 9 },
  { dx: 21, dy: 17 },
] as const;
