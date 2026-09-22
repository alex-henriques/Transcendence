import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { token } from './random.js';
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = 'mythos';
const AUDIENCE = 'mythos-web';
export async function signAccessToken(claims) {
    return new SignJWT({ displayName: claims.displayName })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(String(claims.sub))
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
        .sign(accessKey);
}
export async function verifyAccessToken(jwt) {
    try {
        const { payload } = await jwtVerify(jwt, accessKey, {
            issuer: ISSUER,
            audience: AUDIENCE,
        });
        const sub = Number(payload.sub);
        if (!Number.isInteger(sub) || sub <= 0)
            return null;
        return { sub, displayName: String(payload.displayName ?? '') };
    }
    catch {
        return null;
    }
}
/**
 * Refresh tokens are opaque random strings, not JWTs, so that a logout or a
 * password change can revoke them server-side. Only a keyed hash is stored:
 * the database alone is not enough to mint a session.
 */
function fingerprint(raw) {
    return createHmac('sha256', env.JWT_REFRESH_SECRET).update(raw).digest('hex');
}
export async function issueRefreshToken(userId) {
    const raw = token(48);
    await prisma.refreshToken.create({
        data: {
            userId,
            tokenHash: fingerprint(raw),
            expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
        },
    });
    return raw;
}
/**
 * Single-use rotation: the presented token is revoked and a fresh one issued.
 * Returns null when the token is unknown, expired or already revoked.
 */
export async function rotateRefreshToken(raw) {
    const hash = fingerprint(raw);
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now())
        return null;
    const rotated = await prisma.$transaction(async (tx) => {
        const claimed = await tx.refreshToken.updateMany({
            where: { id: record.id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        // Lost the race against a concurrent refresh: do not mint a second session.
        if (claimed.count === 0)
            return null;
        const next = token(48);
        await tx.refreshToken.create({
            data: {
                userId: record.userId,
                tokenHash: fingerprint(next),
                expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
            },
        });
        return next;
    });
    if (!rotated)
        return null;
    return { userId: record.userId, refreshToken: rotated };
}
export async function revokeRefreshToken(raw) {
    await prisma.refreshToken.updateMany({
        where: { tokenHash: fingerprint(raw), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
export async function revokeAllForUser(userId) {
    await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
/** Constant-time compare for the OAuth state parameter. */
export function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length)
        return false;
    return timingSafeEqual(ab, bb);
}
