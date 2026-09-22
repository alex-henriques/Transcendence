import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
export async function computeUserStats(userId) {
    const finished = { match: { endedAt: { not: null } } };
    const [players, answerAgg, correctCount, fastest, byCategory] = await Promise.all([
        prisma.matchPlayer.findMany({
            where: { userId, ...finished },
            select: { score: true, finalRank: true, comboMax: true },
        }),
        prisma.answer.count({ where: { matchPlayer: { userId } } }),
        prisma.answer.count({ where: { matchPlayer: { userId }, isCorrect: true } }),
        prisma.answer.aggregate({
            where: { matchPlayer: { userId }, isCorrect: true },
            _min: { acceptedReactionMs: true },
        }),
        prisma.$queryRaw(Prisma.sql `
      SELECT cat.slug,
             cat.name,
             count(*)                                    AS answers,
             count(*) FILTER (WHERE a.is_correct)        AS correct
      FROM answers a
      JOIN match_players mp ON mp.id = a.match_player_id
      JOIN match_cards  mc ON mc.id = a.match_card_id
      JOIN cards         c ON c.id  = mc.card_id
      JOIN facts         f ON f.id  = c.fact_id
      JOIN categories  cat ON cat.id = f.category_id
      WHERE mp.user_id = ${userId}
      GROUP BY cat.slug, cat.name
      ORDER BY count(*) DESC
    `),
    ]);
    const matchesPlayed = players.length;
    const matchesWon = players.filter((p) => p.finalRank === 1).length;
    const podiums = players.filter((p) => p.finalRank !== null && p.finalRank <= 3).length;
    const totalScore = players.reduce((sum, p) => sum + p.score, 0);
    const bestScore = players.reduce((best, p) => Math.max(best, p.score), 0);
    const bestCombo = players.reduce((best, p) => Math.max(best, p.comboMax), 0);
    return {
        matchesPlayed,
        matchesWon,
        podiums,
        losses: matchesPlayed - matchesWon,
        winRate: matchesPlayed === 0 ? 0 : matchesWon / matchesPlayed,
        totalScore,
        bestScore,
        answers: answerAgg,
        correct: correctCount,
        accuracy: answerAgg === 0 ? 0 : correctCount / answerAgg,
        bestCombo,
        fastestCorrectMs: fastest._min.acceptedReactionMs ?? null,
        byCategory: byCategory.map((row) => {
            const answers = Number(row.answers);
            const correct = Number(row.correct);
            return {
                slug: row.slug,
                name: row.name,
                answers,
                correct,
                accuracy: answers === 0 ? 0 : correct / answers,
            };
        }),
    };
}
export async function matchHistory(userId, take = 20) {
    const rows = await prisma.matchPlayer.findMany({
        where: { userId, match: { endedAt: { not: null } } },
        orderBy: { match: { endedAt: 'desc' } },
        take,
        include: {
            match: {
                include: {
                    room: { select: { name: true, difficulty: true } },
                    players: {
                        include: { user: { select: { id: true, displayName: true, isBot: true } } },
                    },
                },
            },
        },
    });
    return rows.map((row) => ({
        matchId: row.matchId,
        roomName: row.match.room.name,
        endedAt: row.match.endedAt,
        score: row.score,
        rank: row.finalRank,
        playerCount: row.match.players.length,
        difficulty: row.match.room.difficulty,
        opponents: row.match.players
            .filter((p) => p.userId !== userId)
            .map((p) => ({
            id: p.user.id,
            displayName: p.user.displayName,
            isBot: p.user.isBot,
            score: p.score,
            rank: p.finalRank,
        }))
            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    }));
}
/**
 * Ranked by total score across finished matches. Bots are excluded: a
 * leaderboard the house can win is not a leaderboard.
 */
export async function leaderboard(take = 25) {
    const rows = await prisma.$queryRaw(Prisma.sql `
    SELECT u.id            AS user_id,
           u.display_name  AS display_name,
           u.avatar_url    AS avatar_url,
           u.level         AS level,
           u.xp            AS xp,
           count(DISTINCT mp.id)                                  AS matches_played,
           count(DISTINCT mp.id) FILTER (WHERE mp.final_rank = 1)  AS matches_won,
           coalesce(sum(mp.score), 0)                              AS total_score,
           count(a.id)                                             AS answers,
           count(a.id) FILTER (WHERE a.is_correct)                 AS correct
    FROM users u
    JOIN match_players mp ON mp.user_id = u.id
    JOIN matches        m ON m.id = mp.match_id AND m.ended_at IS NOT NULL
    LEFT JOIN answers   a ON a.match_player_id = mp.id
    WHERE u.is_bot = false
    GROUP BY u.id
    ORDER BY total_score DESC, matches_won DESC, u.xp DESC
    LIMIT ${take}
  `);
    return rows.map((r) => {
        const answers = Number(r.answers);
        return {
            userId: r.user_id,
            displayName: r.display_name,
            avatarUrl: r.avatar_url,
            level: r.level,
            xp: r.xp,
            matchesPlayed: Number(r.matches_played),
            matchesWon: Number(r.matches_won),
            totalScore: Number(r.total_score),
            accuracy: answers === 0 ? 0 : Number(r.correct) / answers,
        };
    });
}
