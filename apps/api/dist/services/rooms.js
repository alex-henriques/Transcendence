import { prisma } from '../db.js';
import { getSession } from '../game/registry.js';
const roomInclude = {
    host: { select: { displayName: true } },
    category: { select: { name: true, slug: true } },
    settings: true,
};
/**
 * The lobby view of a room. `playerCount` comes from the live session when one
 * exists, because a player who is in the room but not yet in a match has no
 * database row to count.
 */
export async function buildRoomSummary(room) {
    const session = getSession(room.id);
    let categoryNames = [];
    const settingsCategories = room.settings?.categoryIds ?? [];
    if (settingsCategories.length > 0) {
        const cats = await prisma.category.findMany({
            where: { id: { in: settingsCategories } },
            select: { name: true },
            orderBy: { name: 'asc' },
        });
        categoryNames = cats.map((c) => c.name);
    }
    else if (room.category) {
        categoryNames = [room.category.name];
    }
    return {
        id: room.id,
        code: room.code,
        name: room.name,
        mode: room.mode,
        visibility: room.visibility,
        difficulty: room.difficulty,
        status: room.status,
        categoryNames,
        playerCount: session?.participantCount() ?? 0,
        maxPlayers: room.maxPlayers,
        hostDisplayName: room.host.displayName,
    };
}
export async function roomSummaryById(roomId) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
    if (!room)
        return null;
    return buildRoomSummary(room);
}
export async function listPublicRooms() {
    const rows = await prisma.room.findMany({
        where: { visibility: 'public', status: { in: ['lobby', 'playing'] } },
        include: roomInclude,
        orderBy: { createdAt: 'desc' },
        take: 60,
    });
    return Promise.all(rows.map(buildRoomSummary));
}
export { roomInclude };
