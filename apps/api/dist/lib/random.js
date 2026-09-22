import { randomBytes, randomInt } from 'node:crypto';
/** Excludes I, O, 0 and 1: room codes get read aloud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode(length = 6) {
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return out;
}
export function token(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}
/** Fisher-Yates, seeded from the CSPRNG. */
export function shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        const a = out[i];
        const b = out[j];
        out[i] = b;
        out[j] = a;
    }
    return out;
}
/**
 * Box-Muller. Used to sample bot reaction times from a normal distribution
 * rather than a uniform one, which is what makes them read as human.
 */
export function normalSample(mean, stddev) {
    let u = 0;
    let v = 0;
    while (u === 0)
        u = Math.random();
    while (v === 0)
        v = Math.random();
    return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
