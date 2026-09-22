/**
 * Values that both the browser and the server must agree on.
 * The server is authoritative for every one of them; the client imports them
 * only so it can render the same numbers without a round trip.
 */
export declare const LOCALES: readonly ["en", "pt-BR", "fr"];
export type Locale = (typeof LOCALES)[number];
export declare const DEFAULT_LOCALE: Locale;
export declare const LOCALE_LABELS: Record<Locale, string>;
export declare const DIFFICULTIES: readonly ["easy", "medium", "hard"];
export type Difficulty = (typeof DIFFICULTIES)[number];
/** Answer window and match length per difficulty (spec §11). */
export declare const DIFFICULTY_PRESETS: Record<Difficulty, {
    answerWindowMs: number;
    cardCount: number;
}>;
/** Scoring constants (spec §11). */
export declare const SCORING: {
    readonly BASE: 100;
    readonly MAX_SPEED_BONUS: 100;
    readonly WRONG_PENALTY: -50;
    readonly NO_ANSWER: 0;
    readonly COMBO_STEP: 0.1;
    readonly COMBO_MAX_BONUS: 0.5;
    readonly DOUBLE_CARD_MULTIPLIER: 2;
};
/** How long the reveal screen is held before the next card is served. */
export declare const REVEAL_HOLD_MS = 4000;
/** Countdown between `match:start` and the first card. */
export declare const MATCH_COUNTDOWN_MS = 3000;
/** Server heartbeat interval; also the RTT sampling period. */
export declare const PING_INTERVAL_MS = 5000;
/** A connection that misses this many consecutive pings is dropped. */
export declare const PING_MAX_MISSED = 3;
export declare const ROOM_LIMITS: {
    readonly MIN_PLAYERS: 1;
    readonly MAX_PLAYERS: 8;
    readonly MIN_CARDS: 5;
    readonly MAX_CARDS: 40;
    readonly CODE_LENGTH: 6;
};
/** XP / level curve (module 10). Level n requires n * 500 cumulative XP. */
export declare const XP_PER_LEVEL = 500;
export declare function levelFromXp(xp: number): number;
export declare function xpIntoLevel(xp: number): {
    into: number;
    needed: number;
};
export declare const AVATAR_MAX_BYTES: number;
export declare const AVATAR_MIME_TYPES: readonly ["image/png", "image/jpeg", "image/webp"];
//# sourceMappingURL=constants.d.ts.map