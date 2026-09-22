import { levelFromXp, xpIntoLevel } from '@mythos/shared';
/** The shape returned to the signed-in user about themselves. */
export function sessionUser(user) {
    const level = levelFromXp(user.xp);
    const { into, needed } = xpIntoLevel(user.xp);
    return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        xp: user.xp,
        level,
        xpIntoLevel: into,
        xpForNextLevel: needed,
        createdAt: user.createdAt.toISOString(),
        hasPassword: user.passwordHash !== null,
    };
}
/** The shape shown to everyone else. Never includes the email. */
export function publicProfile(user) {
    return {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        level: levelFromXp(user.xp),
        xp: user.xp,
        isBot: user.isBot,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
    };
}
