/**
 * Temporal instability filter (spec §7 step 5).
 *
 * A statement like "X is currently the tallest building" is true until it is
 * not, and nothing in the pipeline will notice when that happens. Anything
 * matching these patterns is held back for manual review rather than silently
 * shipped.
 */
const UNSTABLE_PATTERNS = [
    { pattern: /\b(currently|presently|nowadays|as of (today|now))\b/i, reason: 'present-tense claim' },
    { pattern: /\b(today|this year|last year|recent(ly)?|latest|newest)\b/i, reason: 'relative time' },
    { pattern: /\bthe (most|least) recent\b/i, reason: 'relative time' },
    { pattern: /\b(record|world record)\b/i, reason: 'records change' },
    { pattern: /\bthe only\b/i, reason: 'uniqueness claims decay' },
    { pattern: /\b(largest|biggest|smallest|tallest|longest|highest|richest|fastest)\b/i, reason: 'superlative' },
    { pattern: /\b(so far|to date|up to now|still)\b/i, reason: 'open-ended' },
    { pattern: /\bwho is the (current|reigning)\b/i, reason: 'office holder' },
    { pattern: /\b(20[2-9]\d)\b/, reason: 'recent year' },
];
export function checkStability(text) {
    const reasons = UNSTABLE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ reason }) => reason);
    // Superlatives are the noisy rule: "the largest ocean" is perfectly stable,
    // "the largest company" is not. They are flagged, never auto-discarded.
    return { stable: reasons.length === 0, reasons: [...new Set(reasons)] };
}
/**
 * Questions whose wording cannot become a standalone statement.
 * "Which of the following…" has no meaning once the options are gone.
 */
const UNCONVERTIBLE = [
    /which of the following/i,
    /which of these/i,
    /all of the above/i,
    /none of the above/i,
    /^which one/i,
    /the following/i,
    /\bthis (image|picture|logo)\b/i,
];
export function isConvertible(question) {
    return !UNCONVERTIBLE.some((pattern) => pattern.test(question));
}
/** Statements about named private individuals have no place in the card set. */
const SENSITIVE = [
    /\b(rumou?r|allegedly|reportedly|is said to)\b/i,
    /\b(scandal|affair|arrested|convicted|lawsuit)\b/i,
];
export function isSensitive(text) {
    return SENSITIVE.some((pattern) => pattern.test(text));
}
