import { hash, verify } from '@node-rs/argon2';
/**
 * Argon2id with the parameters OWASP currently recommends for interactive
 * logins (19 MiB, 2 passes, 1 lane). `@node-rs/argon2` salts every hash with
 * 16 random bytes and stores the salt inside the encoded string, so there is
 * no separate salt column.
 */
const OPTIONS = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
};
export function hashPassword(plain) {
    return hash(plain, OPTIONS);
}
export async function verifyPassword(stored, plain) {
    try {
        return await verify(stored, plain, OPTIONS);
    }
    catch {
        // A malformed hash must read as "wrong password", never as a crash.
        return false;
    }
}
