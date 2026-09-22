import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { friendRequestSchema } from '@wkb/shared';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { publicProfile } from '../lib/serialize.js';
import { currentUser, requireAuth } from '../plugins/auth.js';
import { onlineUserIds } from '../game/registry.js';

/**
 * Friendships are stored as a single directed row: `user_id` is the requester,
 * `friend_id` the addressee. One row per relationship keeps "who asked whom"
 * unambiguous, so accepting is an update rather than an insert plus a delete.
 */

const ONLINE_WINDOW_MS = 90_000;
const idParam = z.object({ id: z.coerce.number().int().positive() });

function online(userId: number, lastSeenAt: Date | null, live: Set<number>): boolean {
  if (live.has(userId)) return true;
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

export async function friendRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/friends', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);

    const rows = await prisma.friendship.findMany({
      where: { OR: [{ userId: me.id }, { friendId: me.id }] },
      include: {
        user: true,
        friend: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const live = onlineUserIds();
    const decorate = (other: (typeof rows)[number]['user']) => ({
      ...publicProfile(other),
      online: online(other.id, other.lastSeenAt, live),
    });

    const accepted = [];
    const incoming = [];
    const outgoing = [];
    const blocked = [];

    for (const row of rows) {
      const iAmRequester = row.userId === me.id;
      const other = iAmRequester ? row.friend : row.user;

      if (row.status === 'accepted') accepted.push(decorate(other));
      else if (row.status === 'blocked') {
        // Only the person who blocked sees the entry.
        if (iAmRequester) blocked.push(decorate(other));
      } else if (iAmRequester) outgoing.push(decorate(other));
      else incoming.push(decorate(other));
    }

    return { accepted, incoming, outgoing, blocked };
  });

  app.post('/api/friends', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);
    const { userId } = friendRequestSchema.parse(request.body);

    if (userId === me.id) throw badRequest('error.friends.self');

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.isBot) throw notFound();

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: me.id, friendId: userId },
          { userId, friendId: me.id },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'blocked') throw badRequest('error.friends.blocked');
      if (existing.status === 'accepted') return { status: 'accepted' };
      // They already asked us: asking back is the same as accepting.
      if (existing.userId === userId) {
        await prisma.friendship.update({
          where: { userId_friendId: { userId, friendId: me.id } },
          data: { status: 'accepted' },
        });
        return { status: 'accepted' };
      }
      return { status: 'pending' };
    }

    await prisma.friendship.create({ data: { userId: me.id, friendId: userId, status: 'pending' } });
    return { status: 'pending' };
  });

  app.post('/api/friends/:id/accept', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);

    const pending = await prisma.friendship.findUnique({
      where: { userId_friendId: { userId: id, friendId: me.id } },
    });
    if (!pending || pending.status !== 'pending') throw notFound();

    await prisma.friendship.update({
      where: { userId_friendId: { userId: id, friendId: me.id } },
      data: { status: 'accepted' },
    });
    return { status: 'accepted' };
  });

  app.delete('/api/friends/:id', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);

    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: me.id, friendId: id },
          { userId: id, friendId: me.id },
        ],
      },
    });
    return { ok: true };
  });

  app.post('/api/friends/:id/block', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);
    const { id } = idParam.parse(request.params);
    if (id === me.id) throw badRequest('error.friends.self');

    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: me.id, friendId: id },
          { userId: id, friendId: me.id },
        ],
      },
    });
    await prisma.friendship.create({ data: { userId: me.id, friendId: id, status: 'blocked' } });
    return { status: 'blocked' };
  });
}
