/**
 * Values that both the browser and the server must agree on.
 * The server is authoritative for every one of them; the client imports them
 * only so it can render the same numbers without a round trip.
 */

export const LOCALES = ['en', 'pt-BR', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Answer window and match length per difficulty (spec §11). */
export const DIFFICULTY_PRESETS: Record<
  Difficulty,
  { answerWindowMs: number; cardCount: number }
> = {
  easy: { answerWindowMs: 15_000, cardCount: 10 },
  medium: { answerWindowMs: 10_000, cardCount: 20 },
  hard: { answerWindowMs: 6_000, cardCount: 30 },
};

/** Scoring constants (spec §11). */
export const SCORING = {
  BASE: 100,
  MAX_SPEED_BONUS: 100,
  WRONG_PENALTY: -50,
  NO_ANSWER: 0,
  COMBO_STEP: 0.1,
  COMBO_MAX_BONUS: 0.5,
  DOUBLE_CARD_MULTIPLIER: 2,
} as const;

/** How long the reveal screen is held before the next card is served. */
export const REVEAL_HOLD_MS = 4_000;
/** Countdown between `match:start` and the first card. */
export const MATCH_COUNTDOWN_MS = 3_000;
/** Server heartbeat interval; also the RTT sampling period. */
export const PING_INTERVAL_MS = 5_000;
/** A connection that misses this many consecutive pings is dropped. */
export const PING_MAX_MISSED = 3;

export const ROOM_LIMITS = {
  MIN_PLAYERS: 1,
  MAX_PLAYERS: 8,
  MIN_CARDS: 5,
  MAX_CARDS: 40,
  CODE_LENGTH: 6,
} as const;

/** XP / level curve (module 10). Level n requires n * 500 cumulative XP. */
export const XP_PER_LEVEL = 500;
export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
}
export function xpIntoLevel(xp: number): { into: number; needed: number } {
  return { into: xp % XP_PER_LEVEL, needed: XP_PER_LEVEL };
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
