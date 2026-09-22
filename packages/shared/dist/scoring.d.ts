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
export declare function computeScore(input: ScoreInput): ScoreResult;
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
export declare function validateReaction(params: {
    claimedMs: number;
    serverElapsedMs: number;
    rttMs: number;
    windowMs: number;
    toleranceMs?: number;
}): {
    acceptedMs: number;
    trusted: boolean;
};
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
export declare function applyDelta(currentScore: number, points: number): {
    score: number;
    delta: number;
};
//# sourceMappingURL=scoring.d.ts.map