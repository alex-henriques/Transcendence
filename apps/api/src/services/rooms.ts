import type { RoomSummary } from '@wkb/shared';
import { prisma } from '../db.js';
import { activeSessions, getSession } from '../game/registry.js';

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
 * Occupancy is a live fact held in memory, so the list starts from the rooms
 * the engine has people in and only then asks the database about them. Asking
 * the database first, for the newest rooms, would miss a busy older room once
 * enough newer empty ones piled up in front of it.
 */
export async function listPublicRooms(): Promise<RoomSummary[]> {
  const occupied = activeSessions()
    .filter((session) => session.participantCount() > 0)
    .map((session) => session.roomId);
  if (occupied.length === 0) 
    return [];

  const rows = await prisma.room.findMany({
    where: { id: { in: occupied }, visibility: 'public', status: { in: ['lobby', 'playing'] } },
    include: roomInclude,
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  return Promise.all(rows.map(buildRoomSummary));
}


export { roomInclude };
