import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AVATAR_MAX_BYTES, updateProfileSchema } from '@mythos/shared';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound, tooLarge } from '../lib/httpError.js';
import { EXTENSION, sniffImage } from '../lib/images.js';
import { publicProfile } from '../lib/serialize.js';
import { currentUser, requireAuth } from '../plugins/auth.js';
import { onlineUserIds } from '../game/registry.js';
import { computeUserStats, matchHistory } from '../services/stats.js';
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
/** A user counts as online while a lobby socket is open, or seen very recently. */
const ONLINE_WINDOW_MS = 90_000;
function isOnline(userId, lastSeenAt, live) {
    if (live.has(userId))
        return true;
    if (!lastSeenAt)
        return false;
    return Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}
const idParam = z.object({ id: z.coerce.number().int().positive() });
export async function userRoutes(app) {
    app.patch('/api/users/me', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const input = updateProfileSchema.parse(request.body);
        if (input.displayName) {
            const taken = await prisma.user.findFirst({
                where: { displayName: input.displayName, id: { not: me.id } },
                select: { id: true },
            });
            if (taken)
                throw conflict('error.alreadyExists', { displayName: 'error.alreadyExists' });
        }
        const user = await prisma.user.update({
            where: { id: me.id },
            data: {
                ...(input.displayName ? { displayName: input.displayName } : {}),
                ...(input.locale ? { locale: input.locale } : {}),
            },
        });
        return { user: publicProfile(user), locale: user.locale, displayName: user.displayName };
    });
    app.post('/api/users/me/avatar', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
        if (!file)
            throw badRequest('error.avatar.missing');
        const buffer = await file.toBuffer().catch(() => {
            throw tooLarge('error.avatar.tooLarge');
        });
        if (buffer.byteLength > AVATAR_MAX_BYTES)
            throw tooLarge('error.avatar.tooLarge');
        const kind = sniffImage(buffer);
        if (!kind)
            throw badRequest('error.avatar.unsupportedType');
        const filename = `${randomUUID()}.${EXTENSION[kind]}`;
        await writeFile(path.join(UPLOAD_DIR, filename), buffer);
        const previous = await prisma.user.findUnique({
            where: { id: me.id },
            select: { avatarUrl: true },
        });
        const user = await prisma.user.update({
            where: { id: me.id },
            data: { avatarUrl: `/api/uploads/${filename}` },
        });
        // Drop the old file, but only if it was one of ours.
        const old = previous?.avatarUrl;
        if (old?.startsWith('/api/uploads/')) {
            await unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => undefined);
        }
        return { avatarUrl: user.avatarUrl };
    });
    app.delete('/api/users/me/avatar', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const user = await prisma.user.findUnique({ where: { id: me.id }, select: { avatarUrl: true } });
        if (user?.avatarUrl?.startsWith('/api/uploads/')) {
            await unlink(path.join(UPLOAD_DIR, path.basename(user.avatarUrl))).catch(() => undefined);
        }
        await prisma.user.update({ where: { id: me.id }, data: { avatarUrl: null } });
        // Null means "render the default avatar", which the frontend generates
        // from the display name — the subject requires one to always exist.
        return { avatarUrl: null };
    });
    app.get('/api/users', { preHandler: requireAuth }, async (request) => {
        const query = z
            .object({ search: z.string().trim().min(1).max(40).optional() })
            .parse(request.query);
        const live = onlineUserIds();
        const users = await prisma.user.findMany({
            where: {
                isBot: false,
                ...(query.search
                    ? { displayName: { contains: query.search, mode: 'insensitive' } }
                    : {}),
            },
            orderBy: { displayName: 'asc' },
            take: 25,
        });
        return {
            users: users.map((u) => ({
                ...publicProfile(u),
                online: isOnline(u.id, u.lastSeenAt, live),
            })),
        };
    });
    app.get('/api/users/:id', { preHandler: requireAuth }, async (request) => {
        const { id } = idParam.parse(request.params);
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user)
            throw notFound();
        const [stats, history, achievements] = await Promise.all([
            computeUserStats(id),
            matchHistory(id, 15),
            prisma.userAchievement.findMany({
                where: { userId: id },
                include: { achievement: true },
                orderBy: { unlockedAt: 'desc' },
            }),
        ]);
        return {
            user: { ...publicProfile(user), online: isOnline(user.id, user.lastSeenAt, onlineUserIds()) },
            stats,
            history,
            achievements: achievements.map((a) => ({
                slug: a.achievement.slug,
                name: a.achievement.name,
                description: a.achievement.description,
                unlockedAt: a.unlockedAt.toISOString(),
            })),
        };
    });
}
