import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AVATAR_MAX_BYTES,
  deleteAccountSchema,
  presetToStored,
  updateProfileSchema,
} from '@wkb/shared';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden,  notFound, tooLarge, unauthorized } from '../lib/httpError.js';
import { EXTENSION, sniffImage } from '../lib/images.js';
import { publicProfile, sessionUser } from '../lib/serialize.js';
import { currentUser, requireAuth } from '../plugins/auth.js';
import { verifyPassword } from '../lib/password.js';
import { isDemoAccount } from '../seed/data.js';
import { clearRefreshCookie } from './auth.js';
import { activeSessions, onlineUserIds } from '../game/registry.js';
import { computeUserStats, matchHistory } from '../services/stats.js';
import { forfeitTournaments } from '../services/tournament.js';


export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

/** A user counts as online while a lobby socket is open, or seen very recently. */
const ONLINE_WINDOW_MS = 90_000;

function isOnline(userId: number, lastSeenAt: Date | null, live: Set<number>): boolean {
  if (live.has(userId)) return true;
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/api/users/me', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);
    const input = updateProfileSchema.parse(request.body);
    if (input.displayName) {
      const account = await prisma.user.findUnique({
        where: { id: me.id },
        select: { email: true, displayName: true },
      });
      if (account && isDemoAccount(account.email) && input.displayName !== account.displayName)
        throw forbidden();
      const taken = await prisma.user.findFirst({
        where: { displayName: input.displayName, id: { not: me.id } },
        select: { id: true },
      });
      if (taken) 
        throw conflict('error.alreadyExists', { displayName: 'error.alreadyExists' });
    }

    // Stamped once. A second visit to /setup must not rewrite the date the
    // account actually started, so the flag only counts while it is still
    // null. `currentUser` carries the id and the name and nothing else, which
    // is why this reads the row rather than trusting the request.
    let onboardedAt: Date | undefined;
    if (input.onboarded) {
      const current = await prisma.user.findUnique({
        where: { id: me.id },
        select: { onboardedAt: true },
      });
      if (current && current.onboardedAt === null) 
        onboardedAt = new Date();
    }

    // Choosing a stock avatar replaces whatever was there, including an
    // uploaded file, which is then orphaned on disk unless it is removed here.
    let avatarUrl: string | null | undefined;
    if (input.avatarPreset !== undefined) {
      const previous = await prisma.user.findUnique({
        where: { id: me.id },
        select: { avatarUrl: true },
      });
      const old = previous?.avatarUrl;
      if (old?.startsWith('/api/uploads/')) {
        await unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => undefined);
      }
      avatarUrl = input.avatarPreset === null ? null : presetToStored(input.avatarPreset);
    }

    const user = await prisma.user.update({
      where: { id: me.id },
      data: {
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        ...(onboardedAt ? { onboardedAt } : {}),
      },
    });

    return { user: sessionUser(user), locale: user.locale, displayName: user.displayName };
  });

  /**
   * Everything the application holds about this account, as one JSON document
   * (module 15).
   *
   * Assembled from the tables rather than from the read models the interface
   * uses, so the export is what is actually stored and not a tidied-up view of
   * it. `password_hash` is the one field deliberately left out: handing back an
   * Argon2id digest tells the account holder nothing and hands an attacker who
   * has taken over the session something to work on offline.
   */
  app.get('/api/users/me/export', { preHandler: requireAuth }, async (request, reply) => {
    const me = currentUser(request);

    const [user, oauth, friendships, achievements, seenFacts, players, tournaments] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: me.id } }),
        prisma.oAuthAccount.findMany({ where: { userId: me.id } }),
        prisma.friendship.findMany({
          where: { OR: [{ userId: me.id }, { friendId: me.id }] },
          include: {
            user: { select: { id: true, displayName: true } },
            friend: { select: { id: true, displayName: true } },
          },
        }),
        prisma.userAchievement.findMany({
          where: { userId: me.id },
          include: { achievement: { select: { slug: true, name: true, description: true } } },
        }),
        prisma.userSeenFact.findMany({
          where: { userId: me.id },
          include: { fact: { select: { id: true, sourceRef: true } } },
        }),
        prisma.matchPlayer.findMany({
          where: { userId: me.id },
          include: {
            match: { select: { id: true, startedAt: true, endedAt: true, cardCount: true } },
            answers: {
              include: {
                matchCard: { select: { position: true, card: { select: { text: true, isTrue: true } } } },
              },
            },
          },
          orderBy: { id: 'asc' },
        }),
        prisma.tournamentParticipant.findMany({
          where: { userId: me.id },
          include: { tournament: { select: { id: true, name: true, status: true, createdAt: true } } },
        }),
      ]);
    if (!user) throw notFound('error.notFound');

    const stats = await computeUserStats(me.id);

    const document = {
      export: {
        generatedAt: new Date().toISOString(),
        application: 'Who knows best? (ft_transcendence)',
        about:
          'Everything stored about this account. The password is held only as an Argon2id hash and is not included.',
      },
      account: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatarUrl,
        locale: user.locale,
        xp: user.xp,
        level: user.level,
        hasPassword: user.passwordHash !== null,
        twoFactorEnabled: user.totpSecret !== null,
        createdAt: user.createdAt,
        onboardedAt: user.onboardedAt,
        lastSeenAt: user.lastSeenAt,
      },
      linkedSignIns: oauth.map((row) => ({
        provider: row.provider,
        providerAccountId: row.providerUserId,
      })),
      friends: friendships.map((row) => ({
        status: row.status,
        direction: row.userId === me.id ? 'sent' : 'received',
        otherPlayer: row.userId === me.id ? row.friend.displayName : row.user.displayName,
        since: row.createdAt,
      })),
      statistics: stats,
      achievements: achievements.map((row) => ({
        slug: row.achievement.slug,
        name: row.achievement.name,
        description: row.achievement.description,
        unlockedAt: row.unlockedAt,
      })),
      matches: players.map((player) => ({
        matchId: player.matchId,
        startedAt: player.match.startedAt,
        endedAt: player.match.endedAt,
        cards: player.match.cardCount,
        score: player.score,
        finalRank: player.finalRank,
        bestCombo: player.comboMax,
        answers: player.answers.map((answer) => ({
          position: answer.matchCard.position,
          statement: answer.matchCard.card.text,
          statementWasTrue: answer.matchCard.card.isTrue,
          youAnswered: answer.choice,
          correct: answer.isCorrect,
          pointsAwarded: answer.pointsAwarded,
          reactionMsReported: answer.clientReactionMs,
          reactionMsAccepted: answer.acceptedReactionMs,
          roundTripMs: answer.rttMs,
          answeredAt: answer.serverReceivedAt,
        })),
      })),
      tournaments: tournaments.map((row) => ({
        id: row.tournament.id,
        name: row.tournament.name,
        status: row.tournament.status,
        seed: row.seed,
        eliminatedAt: row.eliminatedAt,
        joined: row.tournament.createdAt,
      })),
      factsAlreadyShown: seenFacts.map((row) => ({
        factId: row.factId,
        sourceRef: row.fact.sourceRef,
        lastSeenAt: row.lastSeenAt,
      })),
    };

    // Indented on purpose: "a readable format" is the requirement, and a
    // reader opening this in a text editor is the person it is for.
    const filename = `wkb-data-${user.displayName.replace(/[^\w.-]+/g, '_')}.json`;
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(JSON.stringify(document, null, 2));
  });

  /**
   * Erases the account (module 15).
   *
   * Every table that references a user cascades, so one delete removes the
   * friendships, the answers, the achievements and the history with it. The
   * exceptions are the tournament columns that hold a user id without a
   * foreign key — the bracket's players and winners — which are nulled first,
   * because erasure that leaves an id pointing at a deleted person behind is
   * not erasure.
   */
  app.delete('/api/users/me', { 
    preHandler: requireAuth, 
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const me = currentUser(request);
    const input = deleteAccountSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) 
      throw notFound('error.notFound');
    if (isDemoAccount(user.email))
      throw forbidden();

    // Typing the display name back is what makes this deliberate rather than
    // a mis-click, and it is the only confirmation an account with no password
    // of its own can give.
    if (input.confirm.trim() !== user.displayName) {
      throw badRequest('error.validation', { confirm: 'error.account.confirmMismatch' });
    }
    if (user.passwordHash) {
      if (!input.password) {
        throw badRequest('error.validation', { password: 'validation.password.required' });
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        throw unauthorized('error.auth.wrongPassword');
      }
    }
    
    await forfeitTournaments(me.id);
    for (const session of activeSessions()) session.forgetPlayer(me.id);

    if (user.avatarUrl?.startsWith('/api/uploads/')) {
      await unlink(path.join(UPLOAD_DIR, path.basename(user.avatarUrl))).catch(() => undefined);
    }

    await prisma.$transaction([
      prisma.tournamentMatchup.updateMany({ where: { playerAId: me.id }, data: { playerAId: null } }),
      prisma.tournamentMatchup.updateMany({ where: { playerBId: me.id }, data: { playerBId: null } }),
      prisma.tournamentMatchup.updateMany({ where: { winnerId: me.id }, data: { winnerId: null } }),
      prisma.tournament.updateMany({ where: { winnerId: me.id }, data: { winnerId: null } }),
      prisma.tournament.updateMany({ where: { createdById: me.id }, data: { createdById: null } }),
      prisma.user.delete({ where: { id: me.id } }),
    ]);

    clearRefreshCookie(reply);
    return { deleted: true };
  });

  app.post('/api/users/me/avatar', { preHandler: requireAuth }, async (request) => {
    const me = currentUser(request);

    const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
    if (!file) throw badRequest('error.avatar.missing');

    const buffer = await file.toBuffer().catch(() => {
      throw tooLarge('error.avatar.tooLarge');
    });
    if (buffer.byteLength > AVATAR_MAX_BYTES) throw tooLarge('error.avatar.tooLarge');

    const kind = sniffImage(buffer);
    if (!kind) throw badRequest('error.avatar.unsupportedType');

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
    // from the display name. The subject requires one to always exist.
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
          ? { displayName: { contains: query.search, mode: 'insensitive' as const } }
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
    if (!user) throw notFound();

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
