import { levelFromXp } from '@mythos/shared';
import { prisma } from '../db.js';
import { computeUserStats } from './stats.js';
/**
 * Gamification (module 10): XP with levels, achievements, and the leaderboard
 * that both feed. Everything is persisted; nothing is recomputed from a cache.
 */
/** Turning up is worth something; placing well is worth more. */
const XP_FOR_PLAYING = 20;
const XP_PER_100_POINTS = 10;
const XP_BY_RANK = { 1: 50, 2: 25, 3: 10 };
export function xpForMatch(params) {
    const fromScore = Math.max(0, Math.round((params.score / 100) * XP_PER_100_POINTS));
    const fromRank = params.rank ? (XP_BY_RANK[params.rank] ?? 0) : 0;
    return XP_FOR_PLAYING + fromScore + fromRank;
}
/**
 * Achievement rules are data, not code: each row in `achievements` carries a
 * `criteria` JSON blob that this function knows how to read. Adding a badge is
 * a seed change, not a deploy.
 */
async function unlockedSlugs(params) {
    const [stats, achievements, matchAnswers] = await Promise.all([
        computeUserStats(params.userId),
        prisma.achievement.findMany(),
        prisma.answer.findMany({
            where: { matchPlayer: { userId: params.userId, matchId: params.matchId } },
            select: { isCorrect: true, acceptedReactionMs: true },
        }),
    ]);
    const answeredEverything = matchAnswers.length > 0;
    const perfectMatch = answeredEverything && matchAnswers.every((a) => a.isCorrect);
    const fastestThisMatch = matchAnswers
        .filter((a) => a.isCorrect)
        .reduce((best, a) => (best === null ? a.acceptedReactionMs : Math.min(best, a.acceptedReactionMs)), null);
    const earned = [];
    for (const achievement of achievements) {
        const criteria = achievement.criteria;
        const threshold = criteria.threshold ?? 0;
        let met = false;
        switch (criteria.kind) {
            case 'matches_played':
                met = stats.matchesPlayed >= threshold;
                break;
            case 'matches_won':
                met = stats.matchesWon >= threshold;
                break;
            case 'correct_answers':
                met = stats.correct >= threshold;
                break;
            case 'best_combo':
                met = stats.bestCombo >= threshold;
                break;
            case 'accuracy':
                met = stats.answers >= (criteria.minAnswers ?? 50) && stats.accuracy >= threshold;
                break;
            case 'level':
                met = params.level >= threshold;
                break;
            case 'perfect_match':
                met = perfectMatch && matchAnswers.length >= (criteria.minAnswers ?? 10);
                break;
            case 'fast_correct':
                met = fastestThisMatch !== null && fastestThisMatch <= threshold;
                break;
            case 'category_correct': {
                const row = stats.byCategory.find((c) => c.slug === criteria.categorySlug);
                met = (row?.correct ?? 0) >= threshold;
                break;
            }
            default:
                met = false;
        }
        if (met)
            earned.push(achievement.slug);
    }
    return earned;
}
/**
 * Awards XP and achievements for a finished match.
 * Bots are skipped: they have no progression to speak of.
 */
export async function grantMatchRewards(matchId) {
    const players = await prisma.matchPlayer.findMany({
        where: { matchId },
        include: { user: { select: { id: true, isBot: true, xp: true } } },
    });
    const awards = [];
    for (const player of players) {
        if (player.user.isBot)
            continue;
        const xpGained = xpForMatch({ score: player.score, rank: player.finalRank });
        const xpBefore = player.user.xp;
        const xpAfter = xpBefore + xpGained;
        const levelBefore = levelFromXp(xpBefore);
        const levelAfter = levelFromXp(xpAfter);
        await prisma.user.update({
            where: { id: player.userId },
            data: { xp: xpAfter, level: levelAfter },
        });
        const slugs = await unlockedSlugs({
            userId: player.userId,
            matchId,
            level: levelAfter,
        });
        const newlyUnlocked = [];
        if (slugs.length > 0) {
            const rows = await prisma.achievement.findMany({ where: { slug: { in: slugs } } });
            for (const achievement of rows) {
                // `createMany` + skipDuplicates would hide which ones are new, and the
                // client wants to celebrate exactly the new ones.
                const created = await prisma.userAchievement.createMany({
                    data: [{ userId: player.userId, achievementId: achievement.id }],
                    skipDuplicates: true,
                });
                if (created.count > 0) {
                    newlyUnlocked.push({
                        slug: achievement.slug,
                        name: achievement.name,
                        description: achievement.description,
                    });
                }
            }
        }
        awards.push({
            userId: player.userId,
            xpGained,
            levelBefore,
            levelAfter,
            achievements: newlyUnlocked,
        });
    }
    return awards;
}
