import { unauthorized } from '../lib/httpError.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { prisma } from '../db.js';
function bearer(request) {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
        return null;
    const value = header.slice(7).trim();
    return value.length > 0 ? value : null;
}
/** Route guard. Throws 401 when the access token is missing or invalid. */
export async function requireAuth(request, _reply) {
    const raw = bearer(request);
    if (!raw)
        throw unauthorized();
    const claims = await verifyAccessToken(raw);
    if (!claims)
        throw unauthorized('error.tokenInvalid');
    request.authUser = { id: claims.sub, displayName: claims.displayName };
    // Presence is derived from last_seen_at; every authenticated request
    // refreshes it, and the WebSocket heartbeat keeps it warm between requests.
    void prisma.user
        .update({ where: { id: claims.sub }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
}
/** Same, but leaves `authUser` undefined instead of throwing. */
export async function optionalAuth(request) {
    const raw = bearer(request);
    if (!raw)
        return;
    const claims = await verifyAccessToken(raw);
    if (claims)
        request.authUser = { id: claims.sub, displayName: claims.displayName };
}
export function currentUser(request) {
    if (!request.authUser)
        throw unauthorized();
    return request.authUser;
}
