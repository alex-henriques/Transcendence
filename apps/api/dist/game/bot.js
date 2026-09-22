import { normalSample } from '../lib/random.js';
/** Reference window the profile means are calibrated against. */
const CALIBRATION_WINDOW_MS = 10_000;
/** Harder cards are harder for the bot too, by a fixed, explainable amount. */
const DIFFICULTY_ACCURACY_SHIFT = {
    easy: 0.08,
    medium: 0,
    hard: -0.08,
};
export function accuracyFor(brain, categorySlug, difficulty) {
    const base = brain.accuracyByCategory[categorySlug] ?? brain.accuracyByCategory['_default'] ?? 0.6;
    return Math.min(0.97, Math.max(0.2, base + DIFFICULTY_ACCURACY_SHIFT[difficulty]));
}
/**
 * A bot's answer to one card.
 *
 * There is no search and no model here: the bot is a synthetic player with a
 * per-category hit rate and a latency drawn from a truncated normal
 * distribution. It is deliberately not a knowledge engine — the point of the
 * module is an opponent that behaves like a person, which means being wrong
 * in the categories it is bad at and occasionally being too slow.
 *
 * The reaction mean is scaled by the room's answer window, so the same profile
 * stays coherent whether the host picked the 15-second easy window or the
 * 6-second hard one. That is how the bot "uses" the customization options.
 */
export function decideBotAnswer(params) {
    const { brain, categorySlug, difficulty, cardIsTrue, windowMs } = params;
    const accuracy = accuracyFor(brain, categorySlug, difficulty);
    const answersCorrectly = Math.random() < accuracy;
    const votesTruth = answersCorrectly ? cardIsTrue : !cardIsTrue;
    const choice = votesTruth ? 'truth' : 'myth';
    const scale = windowMs / CALIBRATION_WINDOW_MS;
    const mean = brain.reactionMsMean * scale;
    const stddev = brain.reactionMsStddev * scale;
    let delayMs = Math.round(normalSample(mean, stddev));
    // Nobody reacts in under 400 ms, and a sample past the deadline is a bot
    // that simply did not answer in time.
    const floor = Math.min(400, Math.round(windowMs * 0.1));
    if (delayMs < floor)
        delayMs = floor;
    if (delayMs >= windowMs) {
        return { choice: null, delayMs: windowMs };
    }
    return { choice, delayMs };
}
