import type { Difficulty } from '@wkb/shared';
import { applyDelta, computeScore } from '@wkb/shared';
import { prisma } from '../db.js';
import { roomCode, shuffle } from '../lib/random.js';
import { drawMatchDeck } from '../game/draw.js';
import { decideBotAnswer, type BotBrain } from '../game/bot.js';
import { grantMatchRewards } from './rewards.js';

/**
 * Single-elimination bracket (module 9).
 *
 * The bracket is stored, not computed: every pairing is a row in
 * `tournament_matchups`, so "who plays whom, and in what order" is a query
 * rather than a seeding formula the UI has to re-derive.
 */

export interface BracketMatchup {
  id: number;
  round: number;
  slot: number;
  status: 'pending' | 'ready' | 'playing' | 'finished';
  roomCode: string | null;
  winnerId: number | null;
  players: { id: number; displayName: string; avatarUrl: string | null; isBot: boolean; score: number | null }[];
}

export interface BracketView {
  id: number;
  name: string;
  status: string;
  size: number;
  difficulty: Difficulty;
  cardCount: number;
  winner: { id: number; displayName: string } | null;
  participants: { id: number; displayName: string; avatarUrl: string | null; isBot: boolean; seed: number; eliminated: boolean }[];
  rounds: BracketMatchup[][];
}

export async function bracketView(tournamentId: number): Promise<BracketView | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: {
        include: { user: { select: { id: true, displayName: true, avatarUrl: true, isBot: true } } },
        orderBy: { seed: 'asc' },
      },
      matchups: { orderBy: [{ round: 'asc' }, { slot: 'asc' }] },
    },
  });
  if (!tournament) return null;

  const userIds = new Set<number>();
  for (const m of tournament.matchups) {
    if (m.playerAId) userIds.add(m.playerAId);
    if (m.playerBId) userIds.add(m.playerBId);
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, displayName: true, avatarUrl: true, isBot: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const roomIds = tournament.matchups.flatMap((m) => (m.roomId ? [m.roomId] : []));
  const rooms = await prisma.room.findMany({
    where: { id: { in: roomIds } },
    select: { id: true, code: true },
  });
  const roomById = new Map(rooms.map((r) => [r.id, r.code]));

  const matchIds = tournament.matchups.flatMap((m) => (m.matchId ? [m.matchId] : []));
  const scores = await prisma.matchPlayer.findMany({
    where: { matchId: { in: matchIds } },
    select: { matchId: true, userId: true, score: true },
  });
  const scoreKey = (matchId: number, userId: number) => `${matchId}:${userId}`;
  const scoreMap = new Map(scores.map((s) => [scoreKey(s.matchId, s.userId), s.score]));

  const totalRounds = Math.log2(tournament.size);
  const rounds: BracketMatchup[][] = [];
  for (let r = 1; r <= totalRounds; r += 1) {
    rounds.push(
      tournament.matchups
        .filter((m) => m.round === r)
        .map((m) => ({
          id: m.id,
          round: m.round,
          slot: m.slot,
          status: m.status,
          roomCode: m.roomId ? (roomById.get(m.roomId) ?? null) : null,
          winnerId: m.winnerId,
          players: [m.playerAId, m.playerBId].flatMap((id) => {
            if (!id) return [];
            const u = byId.get(id);
            if (!u) return [];
            return [
              {
                id: u.id,
                displayName: u.displayName,
                avatarUrl: u.avatarUrl,
                isBot: u.isBot,
                score: m.matchId ? (scoreMap.get(scoreKey(m.matchId, u.id)) ?? null) : null,
              },
            ];
          }),
        })),
    );
  }

  const winner = tournament.winnerId ? (byId.get(tournament.winnerId) ?? null) : null;

  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    size: tournament.size,
    difficulty: tournament.difficulty,
    cardCount: tournament.cardCount,
    winner: winner ? { id: winner.id, displayName: winner.displayName } : null,
    participants: tournament.participants.map((p) => ({
      id: p.user.id,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      isBot: p.user.isBot,
      seed: p.seed,
      eliminated: p.eliminatedAt !== null,
    })),
    rounds,
  };
}

/**
 * Seeds the participants and lays out the first round.
 *
 * Humans are spread across the bracket before bots fill the rest, so a solo
 * player never draws a bot-versus-bot matchup in place of their own.
 */
export async function startTournament(tournamentId: number, requestedBy: number): Promise<string | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { participants: { include: { user: { select: { isBot: true } } } } },
  });
  if (!tournament) return 'error.notFound';
  if (tournament.createdById !== requestedBy) return 'error.tournament.hostOnly';
  if (tournament.status !== 'registration') return 'error.tournament.alreadyStarted';
  if (tournament.participants.length !== tournament.size) return 'error.tournament.needsFullBracket';

  const humans = shuffle(tournament.participants.filter((p) => !p.user.isBot).map((p) => p.userId));
  const bots = shuffle(tournament.participants.filter((p) => p.user.isBot).map((p) => p.userId));

  // Interleave so consecutive seeds (which face each other in round 1) are a
  // human and a bot wherever the numbers allow it.
  const ordered: number[] = [];
  const slots = tournament.size;
  for (let i = 0; i < slots; i += 2) {
    const human = humans.shift();
    const other = humans.shift() ?? bots.shift();
    if (human !== undefined) ordered.push(human);
    if (other !== undefined) ordered.push(other);
  }
  for (const leftover of [...humans, ...bots]) ordered.push(leftover);

  await prisma.$transaction(async (tx) => {
    for (let seed = 0; seed < ordered.length; seed += 1) {
      const userId = ordered[seed];
      if (userId === undefined) continue;
      await tx.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId, userId } },
        data: { seed, round: 1 },
      });
    }

    const totalRounds = Math.log2(slots);
    for (let round = 1; round <= totalRounds; round += 1) {
      const slotsInRound = slots / 2 ** round;
      for (let slot = 0; slot < slotsInRound; slot += 1) {
        await tx.tournamentMatchup.create({
          data: {
            tournamentId,
            round,
            slot,
            playerAId: round === 1 ? (ordered[slot * 2] ?? null) : null,
            playerBId: round === 1 ? (ordered[slot * 2 + 1] ?? null) : null,
            status: 'pending',
          },
        });
      }
    }

    await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'running' } });
  });

  await prepareRound(tournamentId, 1);
  return null;
}

/**
 * Gives every matchup of a round somewhere to be played.
 *
 * A matchup with a human gets a private room; an all-bot matchup would have
 * nobody to press start, so it is resolved by simulation instead.
 */
async function prepareRound(tournamentId: number, round: number): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return;

  const matchups = await prisma.tournamentMatchup.findMany({
    where: { tournamentId, round, status: 'pending' },
    orderBy: { slot: 'asc' },
  });

  for (const matchup of matchups) {
    if (!matchup.playerAId || !matchup.playerBId) continue;

    const players = await prisma.user.findMany({
      where: { id: { in: [matchup.playerAId, matchup.playerBId] } },
      select: { id: true, isBot: true, displayName: true },
    });
    const allBots = players.every((p) => p.isBot);

    if (allBots) {
      await simulateBotMatchup({ tournament, matchup });
      continue;
    }

    const host = players.find((p) => !p.isBot);
    if (!host) continue;

    const room = await prisma.room.create({
      data: {
        code: roomCode(),
        name: `${tournament.name} · R${round}`,
        visibility: 'private',
        mode: 'general',
        difficulty: tournament.difficulty,
        hostUserId: host.id,
        maxPlayers: 2,
        settings: {
          create: {
            cardCount: tournament.cardCount,
            categoryIds: [],
            answerWindowMs:
              tournament.difficulty === 'easy' ? 15_000 : tournament.difficulty === 'hard' ? 6_000 : 10_000,
            comboEnabled: true,
            doubleCardEnabled: false,
          },
        },
      },
    });

    await prisma.tournamentMatchup.update({
      where: { id: matchup.id },
      data: { roomId: room.id, status: 'ready' },
    });
  }

  await checkRoundCompletion(tournamentId, round);
}

/**
 * Plays an all-bot matchup without a wall clock.
 *
 * It is a real match: a real deck, real `answers` rows, and the same
 * `decideBotAnswer` and `computeScore` functions the live loop uses. Only the
 * waiting is skipped, because there is no one watching it happen.
 */
async function simulateBotMatchup(params: {
  tournament: { id: number; difficulty: Difficulty; cardCount: number; name: string };
  matchup: { id: number; playerAId: number | null; playerBId: number | null };
}): Promise<void> {
  const { tournament, matchup } = params;
  if (!matchup.playerAId || !matchup.playerBId) return;

  const botIds = [matchup.playerAId, matchup.playerBId];
  const windowMs =
    tournament.difficulty === 'easy' ? 15_000 : tournament.difficulty === 'hard' ? 6_000 : 10_000;

  const deck = await drawMatchDeck({
    userIds: [],
    categoryIds: [],
    difficulty: tournament.difficulty,
    count: tournament.cardCount,
  });

  if (deck.length === 0) {
    const [winnerId, loserId] = shuffle(botIds) as [number, number];
    await prisma.tournamentMatchup.update({
      where: { id: matchup.id }, 
      data: { status: 'finished', winnerId },
    });
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: tournament.id, userId: loserId },
      data: { eliminatedAt: new Date() },
    });
    return;
  }
  const room = await prisma.room.create({
    data: {
      code: roomCode(),
      name: `${tournament.name} · bots`,
      visibility: 'private',
      mode: 'general',
      difficulty: tournament.difficulty,
      hostUserId: botIds[0] as number,
      maxPlayers: 2,
      status: 'finished',
      settings: {
        create: {
          cardCount: deck.length,
          categoryIds: [],
          answerWindowMs: windowMs,
          comboEnabled: true,
          doubleCardEnabled: false,
        },
      },
    },
  });

  const profiles = await prisma.botProfile.findMany({ where: { userId: { in: botIds } } });
  const brains = new Map<number, BotBrain>(
    profiles.map((p) => [
      p.userId,
      {
        label: p.label,
        accuracyByCategory: p.accuracyByCategory as Record<string, number>,
        reactionMsMean: p.reactionMsMean,
        reactionMsStddev: p.reactionMsStddev,
      },
    ]),
  );

  const cardMeta = await prisma.card.findMany({
    where: { id: { in: deck.map((c) => c.cardId) } },
    include: { fact: { include: { category: { select: { slug: true } } } } },
  });
  const metaById = new Map(cardMeta.map((c) => [c.id, c]));

  const match = await prisma.match.create({
    data: { roomId: room.id, tournamentId: tournament.id, cardCount: deck.length, endedAt: new Date() },
  });

  const matchCards = [];
  for (let i = 0; i < deck.length; i += 1) {
    const entry = deck[i];
    if (!entry) continue;
    matchCards.push(
      await prisma.matchCard.create({
        data: {
          matchId: match.id,
          cardId: entry.cardId,
          position: i,
          servedAt: new Date(),
          deadlineAt: new Date(Date.now() + windowMs),
          revealedAt: new Date(),
        },
      }),
    );
  }

  const state = new Map<number, { matchPlayerId: number; score: number; combo: number; comboMax: number }>();
  for (const botId of botIds) {
    const mp = await prisma.matchPlayer.create({ data: { matchId: match.id, userId: botId } });
    state.set(botId, { matchPlayerId: mp.id, score: 0, combo: 0, comboMax: 0 });
  }

  for (let i = 0; i < matchCards.length; i += 1) {
    const mc = matchCards[i];
    const entry = deck[i];
    if (!mc || !entry) continue;
    const meta = metaById.get(entry.cardId);
    const slug = meta?.fact.category.slug ?? '_default';

    for (const botId of botIds) {
      const brain = brains.get(botId);
      const player = state.get(botId);
      if (!brain || !player) continue;

      const decision = decideBotAnswer({
        brain,
        categorySlug: slug,
        difficulty: tournament.difficulty,
        cardIsTrue: entry.isTrue,
        windowMs,
      });
      if (decision.choice === null) {
        player.combo = 0;
        continue;
      }

      const correct = (decision.choice === 'truth') === entry.isTrue;
      const score = computeScore({
        correct,
        reactionMs: decision.delayMs,
        windowMs,
        comboBefore: player.combo,
        comboEnabled: true,
        isDouble: false,
      });

      const applied = applyDelta(player.score, score.points);
      player.score = applied.score;
      player.combo = correct ? score.comboAfter : 0;
      player.comboMax = Math.max(player.comboMax, player.combo);

      await prisma.answer.create({
        data: {
          matchCardId: mc.id,
          matchPlayerId: player.matchPlayerId,
          choice: decision.choice,
          clientReactionMs: decision.delayMs,
          rttMs: 0,
          acceptedReactionMs: decision.delayMs,
          reactionTrusted: true,
          isCorrect: correct,
          pointsAwarded: applied.delta,
        },
      });
    }
  }

  const ranked = [...state.entries()].sort((a, b) => b[1].score - a[1].score);
  for (let i = 0; i < ranked.length; i += 1) {
    const row = ranked[i];
    if (!row) continue;
    await prisma.matchPlayer.update({
      where: { id: row[1].matchPlayerId },
      data: {
        score: row[1].score,
        comboCurrent: row[1].combo,
        comboMax: row[1].comboMax,
        finalRank: i + 1,
      },
    });
  }

  await prisma.tournamentMatchup.update({
    where: { id: matchup.id },
    data: { matchId: match.id, roomId: room.id, status: 'finished', winnerId: ranked[0]?.[0] ?? null },
  });

  const loserId = ranked[1]?.[0];
  if (loserId !== undefined) {
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: tournament.id, userId: loserId },
      data: { eliminatedAt: new Date() },
    });
  }
}

/**
 * Called by the engine when any match ends. Returns the tournament context
 * when the match belonged to one, so the client can show "you advanced".
 */
export async function reportMatchResult(
  matchId: number,
): Promise<{ id: number; advancedUserId: number | null } | null> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, roomId: true },
  });
  if (!match) return null;

  const matchup = await prisma.tournamentMatchup.findFirst({
    where: { roomId: match.roomId, status: { in: ['ready', 'playing'] } },
  });
  if (!matchup) return null;

  const players = await prisma.matchPlayer.findMany({
    where: { matchId },
    orderBy: [{ finalRank: 'asc' }, { score: 'desc' }],
    select: { userId: true, finalRank: true, score: true },
  });
  const winner = players[0];
  if (!winner) return null;

  await prisma.$transaction(async (tx) => {
    await tx.tournamentMatchup.update({
      where: { id: matchup.id },
      data: { matchId, status: 'finished', winnerId: winner.userId },
    });

    for (const player of players.slice(1)) {
      await tx.tournamentParticipant.updateMany({
        where: { tournamentId: matchup.tournamentId, userId: player.userId },
        data: { eliminatedAt: new Date() },
      });
    }

    await tx.tournamentParticipant.updateMany({
      where: { tournamentId: matchup.tournamentId, userId: winner.userId },
      data: { round: matchup.round + 1 },
    });

    await tx.match.update({ where: { id: matchId }, data: { tournamentId: matchup.tournamentId } });
  });

  await checkRoundCompletion(matchup.tournamentId, matchup.round);

  return { id: matchup.tournamentId, advancedUserId: winner.userId };
}

/**
 * Promotes winners into the next round once every matchup of the current one
 * has a result, or crowns the champion when there is no next round.
 */
async function checkRoundCompletion(tournamentId: number, round: number): Promise<void> {
  const current = await prisma.tournamentMatchup.findMany({
    where: { tournamentId, round },
    orderBy: { slot: 'asc' },
  });
  if (current.length === 0) return;
  if (current.some((m) => m.status !== 'finished')) return;

  const nextRound = round + 1;
  const next = await prisma.tournamentMatchup.findMany({
    where: { tournamentId, round: nextRound },
    orderBy: { slot: 'asc' },
  });

  if (next.length === 0) {
    // No further round: the winner of the single remaining matchup takes it.
    const champion = current[0]?.winnerId ?? null;
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: 'finished', winnerId: champion },
    });
    return;
  }

  for (const matchup of next) {
    const a = current[matchup.slot * 2]?.winnerId ?? null;
    const b = current[matchup.slot * 2 + 1]?.winnerId ?? null;
    await prisma.tournamentMatchup.update({
      where: { id: matchup.id },
      data: { playerAId: a, playerBId: b },
    });
  }

  await prepareRound(tournamentId, nextRound);
}

/** Marks a matchup as being played, so the bracket shows it live. */
export async function markMatchupPlaying(roomId: number): Promise<void> {
  await prisma.tournamentMatchup.updateMany({
    where: { roomId, status: 'ready' },
    data: { status: 'playing' },
  });
}

/** XP is granted for tournament matches too; the engine already called this. */
export { grantMatchRewards };

/**
 * Settles every unfinished matchup a user is drawn into as a loss.
 *
 * Called before an account is erased. Erasure removes the user from the
 * bracket, and a matchup left with one player can never be played, so the
 * whole tournament would wait on it forever. The opponent advances instead.
 */
export async function forfeitTournaments(userId: number): Promise<void> {
  const open = await prisma.tournamentMatchup.findMany({
    where: {
      status: { not: 'finished' },
      OR: [{ playerAId: userId }, { playerBId: userId }],
      tournament: { status: 'running' },
    },
  });

  for (const matchup of open) {
    const opponentId = matchup.playerAId === userId ? matchup.playerBId : matchup.playerAId;
    await prisma.tournamentMatchup.update({
      where: { id: matchup.id },
      data: { status: 'finished', winnerId: opponentId },
    });
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: matchup.tournamentId, userId },
      data: { eliminatedAt: new Date() },
    });
    await checkRoundCompletion(matchup.tournamentId, matchup.round);
  }
}