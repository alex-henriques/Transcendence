import { SCORING } from './constants.js';

export interface ScoreInput {
  correct: boolean | null;
  reactionMs: number;
  windowMs: number;
  comboBefore: number;
  comboEnabled: boolean;
  isDouble: boolean;
}

export interface ScoreResult {
  points: number;
  speedBonus: number;
  comboAfter: number;
  comboMultiplier: number;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { correct, reactionMs, windowMs, comboBefore, comboEnabled, isDouble } = input;
  if (correct === null) 
  {
    return { points: SCORING.NO_ANSWER, speedBonus: 0, comboAfter: 0, comboMultiplier: 1 };
  }
  if (!correct) 
  {
    const points = isDouble ? SCORING.WRONG_PENALTY * SCORING.DOUBLE_CARD_MULTIPLIER : SCORING.WRONG_PENALTY;
    return { points, speedBonus: 0, comboAfter: 0, comboMultiplier: 1 };
  }
  const ratio = Math.min(1, Math.max(0, reactionMs / windowMs));
  const speedBonus = Math.round(SCORING.MAX_SPEED_BONUS * (1 - ratio));
  const comboAfter = comboBefore + 1;
  const comboMultiplier = comboEnabled ? 1 + Math.min(SCORING.COMBO_MAX_BONUS, comboBefore * SCORING.COMBO_STEP) : 1;
  let points = Math.round((SCORING.BASE + speedBonus) * comboMultiplier);
  if (isDouble) 
    points *= SCORING.DOUBLE_CARD_MULTIPLIER;
  return { points, speedBonus, comboAfter, comboMultiplier };
}

const MAX_TRUSTED_RTT_MS = 1_000;

export function validateReaction(params: {
  claimedMs: number;
  serverElapsedMs: number;
  rttMs: number;
  windowMs: number;
  toleranceMs?: number;
}): { acceptedMs: number; trusted: boolean } {
  const { claimedMs, serverElapsedMs, windowMs } = params;
  const tolerance = params.toleranceMs ?? 250;
  const rttMs = Math.min(params.rttMs, MAX_TRUSTED_RTT_MS);
  const lower = Math.max(0, serverElapsedMs - rttMs - tolerance);
  const upper = serverElapsedMs + tolerance;
  const trusted =
    Number.isFinite(claimedMs) && claimedMs >= 0 && claimedMs >= lower && claimedMs <= upper;
  const acceptedMs = trusted ? Math.min(claimedMs, windowMs) : windowMs;
  return { acceptedMs, trusted };
}

export function applyDelta(
  currentScore: number,
  points: number,
): { score: number; delta: number } {
  const score = Math.max(0, currentScore + points);
  return { score, delta: score - currentScore };
}
