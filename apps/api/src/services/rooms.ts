import type { RoomSummary } from '@wkb/shared';
import { prisma } from '../db.js';
import { getSession } from '../game/registry.js';

const roomInclude = {
  host: { select: { displayName: true } },
  category: { select: { name: true, slug: true } },
  settings: true,
} as const;

type RoomWithRelations = Awaited<
  ReturnType<typeof prisma.room.findFirstOrThrow<{ include: typeof roomInclude }>>
>;

/**
 * The lobby view of a room. `playerCount` comes from the live session when one
 * exists, because a player who is in the room but not yet in a match has no
 * database row to count.
 */
export async function buildRoomSummary(room: RoomWithRelations): Promise<RoomSummary> {
  const session = getSession(room.id);

  let categories: { slug: string; name: string }[] = [];
  const settingsCategories = room.settings?.categoryIds ?? [];
  if (settingsCategories.length > 0) {
    categories = await prisma.category.findMany({
      where: { id: { in: settingsCategories } },
      select: { slug: true, name: true },
      orderBy: { name: 'asc' },
    });
  } else if (room.category) {
    categories = [{ slug: room.category.slug, name: room.category.name }];
  }

  return {
    id: room.id,
    code: room.code,
    name: room.name,
    mode: room.mode,
    visibility: room.visibility,
    difficulty: room.difficulty,
    status: room.status,
    categories,
    playerCount: session?.participantCount() ?? 0,
    maxPlayers: room.maxPlayers,
    hostDisplayName: room.host.displayName,
  };
}

export async function roomSummaryById(roomId: number): Promise<RoomSummary | null> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  if (!room) return null;
  return buildRoomSummary(room);
}

/**
 * The lobby listing: public rooms that somebody is actually in.
 *
 * Occupancy is a live fact, not a stored one, so the filter has to happen
 * after the summaries are built rather than in the query.
 */
export async function listPublicRooms(): Promise<RoomSummary[]> {
  const rows = await prisma.room.findMany({
    where: { visibility: 'public', status: { in: ['lobby', 'playing'] } },
    include: roomInclude,
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const summaries = await Promise.all(rows.map(buildRoomSummary));
  return summaries.filter((room) => room.playerCount > 0);
}

export { roomInclude };
