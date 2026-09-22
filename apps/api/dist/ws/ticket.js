import { randomInt } from 'node:crypto';
import { token } from '../lib/random.js';
/**
 * Single-use tickets for WebSocket authentication.
 *
 * The access token deliberately never appears in a WebSocket URL: query
 * strings land in proxy logs and browser history, and unlike a fetch there is
 * no way to attach an Authorization header to a browser WebSocket handshake.
 * So the client trades its access token for a ticket over HTTPS, and the
 * ticket — valid for 30 seconds, usable once — is what travels in the URL.
 */
const TTL_MS = 30_000;
const tickets = new Map();
export function issueTicket(userId, locale) {
    const value = token(24);
    tickets.set(value, { userId, locale, expiresAt: Date.now() + TTL_MS });
    // Opportunistic sweep; the map only ever holds a handful of live entries.
    if (tickets.size > 64 && randomInt(8) === 0)
        sweep();
    return value;
}
export function redeemTicket(value) {
    if (!value)
        return null;
    const found = tickets.get(value);
    if (!found)
        return null;
    tickets.delete(value);
    if (found.expiresAt < Date.now())
        return null;
    return found;
}
function sweep() {
    const now = Date.now();
    for (const [key, value] of tickets) {
        if (value.expiresAt < now)
            tickets.delete(key);
    }
}
