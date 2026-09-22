import { SCORING } from './constants.js';

export interface ScoreInput {
  /** Was the vote correct? `null` means the player did not answer in time. */
  correct: boolean | null;
  /** Reaction time actually accepted by the server, in milliseconds. */
  reactionMs: number;
  /** The answer window for this card, in milliseconds. */
  windowMs: number;
  /** Consecutive correct answers *before* this card. */
  comboBefore: number;
  /** Room modifier: combo multiplier disabled. */
  comboEnabled: boolean;
  /** This card was drawn as a double-value card. */
  isDouble: boolean;
}

export interface ScoreResult {
  points: number;
  speedBonus: number;
  comboAfter: number;
  comboMultiplier: number;
}

/**
 * The single implementation of the scoring rules (spec §11).
 *
 * Lives in `shared` so the reveal screen can show the player exactly the
 * breakdown the server computed, without the client ever deciding a score:
 * the server calls this function and broadcasts the result.
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const { correct, reactionMs, windowMs, comboBefore, comboEnabled, isDouble } = input;

  if (correct === null) {
    return { points: SCORING.NO_ANSWER, speedBonus: 0, comboAfter: 0, comboMultiplier: 1 };
  }

  if (!correct) {
    const points = isDouble ? SCORING.WRONG_PENALTY * SCORING.DOUBLE_CARD_MULTIPLIER : SCORING.WRONG_PENALTY;
    return { points, speedBonus: 0, comboAfter: 0, comboMultiplier: 1 };
  }

  // Linear decay: answering in half the window earns half the bonus.
  const ratio = Math.min(1, Math.max(0, reactionMs / windowMs));
  const speedBonus = Math.round(SCORING.MAX_SPEED_BONUS * (1 - ratio));

  const comboAfter = comboBefore + 1;
  const comboMultiplier = comboEnabled
    ? 1 + Math.min(SCORING.COMBO_MAX_BONUS, comboBefore * SCORING.COMBO_STEP)
    : 1;

  let points = Math.round((SCORING.BASE + speedBonus) * comboMultiplier);
  if (isDouble) points *= SCORING.DOUBLE_CARD_MULTIPLIER;

  return { points, speedBonus, comboAfter, comboMultiplier };
}

/**
 * Bounds the reaction time a client may claim for a card (spec §11, RTT validation).
 *
 * A vote that reaches the server at `serverElapsedMs` after the card was served
 * cannot have been produced faster than the network allows. The client rendered
 * the card no earlier than `rtt/2` after `served_at`, and its report travelled
 * back for another `rtt/2`, so a truthful report sits inside
 * `[serverElapsedMs - rtt - tolerance, serverElapsedMs + tolerance]`.
 *
 * Anything outside that window is not trusted and falls back to the worst time
 * of the round, i.e. the full window.
 */
export function validateReaction(params: {
  claimedMs: number;
  serverElapsedMs: number;
  rttMs: number;
  windowMs: number;
  toleranceMs?: number;
}): { acceptedMs: number; trusted: boolean } {
  const { claimedMs, serverElapsedMs, rttMs, windowMs } = params;
  const tolerance = params.toleranceMs ?? 250;

  const lower = Math.max(0, serverElapsedMs - rttMs - tolerance);
  const upper = serverElapsedMs + tolerance;

  const trusted =
    Number.isFinite(claimedMs) && claimedMs >= 0 && claimedMs >= lower && claimedMs <= upper;

  const acceptedMs = trusted ? Math.min(claimedMs, windowMs) : windowMs;
  return { acceptedMs, trusted };
}

/**
 * Applies a card's points to a running total.
 *
 * A score never goes below zero. The wrong-answer penalty still exists and
 * still does its job, which is to make guessing worse than playing, but it can
 * only take away points a player actually has. Without the floor a bad opening
 * run puts somebody underwater with nothing to do about it, and a scoreboard
 * of negative numbers reads as a bug even when it is working as written.
 *
 * `delta` is the amount actually applied, so a player's stored answers always
 * add up to their score. On a full penalty against a score of 20, `points` is
 * -50 and `delta` is -20.
 */
export function applyDelta(
  currentScore: number,
  points: number,
): { score: number; delta: number } {
  const score = Math.max(0, currentScore + points);
  return { score, delta: score - currentScore };
}
