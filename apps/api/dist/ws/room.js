import { roomCodeSchema, roomSettingsSchema } from '@mythos/shared';
import { prisma } from '../db.js';
import { Channel } from './connection.js';
import { redeemTicket } from './ticket.js';
import { RoomSession } from '../game/engine.js';
import { getSession, setSession } from '../game/registry.js';
import { markMatchupPlaying } from '../services/tournament.js';
/**
 * The match channel.
 *
 * A socket carries no room until it sends `room:join`; that keeps the
 * handshake identical for a first join and for a reconnection, and the server
 * answers both with the same `room:state` snapshot.
 */
export async function registerRoomChannel(app) {
    app.get('/ws/room', { websocket: true }, (socket, request) => {
        const query = request.query;
        const redeemed = redeemTicket(query.ticket);
        if (!redeemed) {
            socket.send(JSON.stringify({ type: 'error', code: 'error.ws.badTicket', message: 'error.ws.badTicket' }));
            socket.close(4401, 'unauthorized');
            return;
        }
        let session = null;
        const channel = new Channel(socket, redeemed.userId, redeemed.locale, () => {
            request.log.debug({ userId: redeemed.userId }, 'room socket heartbeat timeout');
        });
        channel.startHeartbeat();
        const fail = (code) => channel.send({ type: 'error', code, message: code });
        const refreshEveryone = async () => {
            if (!session)
                return;
            const current = session;
            for (const peer of current.channelList()) {
                const snapshot = await current.snapshot(peer);
                if (snapshot)
                    peer.send(snapshot);
            }
        };
        socket.on('message', (raw) => {
            void (async () => {
                let event;
                try {
                    event = JSON.parse(raw.toString());
                }
                catch {
                    return fail('error.ws.badPayload');
                }
                if (typeof event?.type !== 'string')
                    return fail('error.ws.badPayload');
                switch (event.type) {
                    case 'pong':
                        channel.handlePong(Number(event.t));
                        return;
                    case 'room:join': {
                        if (session)
                            return fail('error.ws.alreadyJoined');
                        const parsedCode = roomCodeSchema.safeParse(event.code);
                        if (!parsedCode.success)
                            return fail('error.room.notFound');
                        const room = await prisma.room.findUnique({ where: { code: parsedCode.data } });
                        if (!room)
                            return fail('error.room.notFound');
                        let existing = getSession(room.id);
                        if (!existing) {
                            existing = new RoomSession(room.id, room.code);
                            setSession(room.id, existing);
                        }
                        session = existing;
                        // A player already in the running match is reconnecting; anyone
                        // else is joining, and a full match has no seat for them.
                        const rejoining = existing.isInMatch(channel.userId);
                        if (!rejoining && existing.hasMatch)
                            return fail('error.room.matchInProgress');
                        if (!rejoining && !existing.hasMatch && existing.participantCount() >= room.maxPlayers) {
                            return fail('error.room.full');
                        }
                        existing.attach(channel);
                        if (rejoining)
                            await existing.markReconnected(channel.userId);
                        const snapshot = await existing.snapshot(channel);
                        if (snapshot)
                            channel.send(snapshot);
                        await refreshEveryone();
                        await existing.publishRoom();
                        return;
                    }
                    case 'room:leave': {
                        if (!session)
                            return;
                        const leaving = session;
                        leaving.detach(channel);
                        await leaving.markDisconnected(channel.userId);
                        session = null;
                        if (leaving.isEmpty && !leaving.hasMatch)
                            await leaving.dispose();
                        else
                            await leaving.publishRoom();
                        channel.close(1000, 'left');
                        return;
                    }
                    case 'room:settings': {
                        if (!session)
                            return fail('error.ws.notInRoom');
                        if (session.hasMatch)
                            return fail('error.match.alreadyRunning');
                        const room = await prisma.room.findUnique({ where: { id: session.roomId } });
                        if (!room)
                            return fail('error.notFound');
                        if (room.hostUserId !== channel.userId)
                            return fail('error.match.hostOnly');
                        const parsed = roomSettingsSchema.safeParse(event.settings);
                        if (!parsed.success)
                            return fail('error.validation');
                        await prisma.roomSettings.update({
                            where: { roomId: session.roomId },
                            data: {
                                cardCount: parsed.data.cardCount,
                                categoryIds: parsed.data.categoryIds,
                                answerWindowMs: parsed.data.answerWindowMs,
                                comboEnabled: parsed.data.comboEnabled,
                                doubleCardEnabled: parsed.data.doubleCardEnabled,
                            },
                        });
                        await refreshEveryone();
                        await session.publishRoom();
                        return;
                    }
                    case 'room:add_bot': {
                        if (!session)
                            return fail('error.ws.notInRoom');
                        if (session.hasMatch)
                            return fail('error.match.alreadyRunning');
                        const room = await prisma.room.findUnique({ where: { id: session.roomId } });
                        if (!room)
                            return fail('error.notFound');
                        if (room.hostUserId !== channel.userId)
                            return fail('error.match.hostOnly');
                        if (session.participantCount() >= room.maxPlayers)
                            return fail('error.room.full');
                        const profile = await prisma.botProfile.findUnique({
                            where: { id: Number(event.profileId) },
                        });
                        if (!profile)
                            return fail('error.notFound');
                        if (session.botIds().includes(profile.userId))
                            return fail('error.room.botAlreadyIn');
                        session.addBot(profile.userId);
                        await refreshEveryone();
                        await session.publishRoom();
                        return;
                    }
                    case 'room:remove_player': {
                        if (!session)
                            return fail('error.ws.notInRoom');
                        if (session.hasMatch)
                            return fail('error.match.alreadyRunning');
                        const room = await prisma.room.findUnique({ where: { id: session.roomId } });
                        if (!room)
                            return fail('error.notFound');
                        if (room.hostUserId !== channel.userId)
                            return fail('error.match.hostOnly');
                        const targetId = Number(event.userId);
                        if (targetId === channel.userId)
                            return fail('error.room.cannotRemoveHost');
                        session.removeBot(targetId);
                        session.kick(targetId);
                        await refreshEveryone();
                        await session.publishRoom();
                        return;
                    }
                    case 'match:start': {
                        if (!session)
                            return fail('error.ws.notInRoom');
                        const error = await session.start(channel.userId);
                        if (error)
                            return fail(error);
                        await markMatchupPlaying(session.roomId).catch(() => undefined);
                        return;
                    }
                    case 'card:vote': {
                        if (!session)
                            return fail('error.ws.notInRoom');
                        await session.handleVote({
                            channel,
                            matchCardId: Number(event.matchCardId),
                            choice: event.choice === 'myth' ? 'myth' : 'truth',
                            reactionMs: Number(event.reactionMs),
                        });
                        return;
                    }
                    default:
                        return fail('error.ws.unknownEvent');
                }
            })().catch((error) => {
                request.log.error({ err: error }, 'room channel handler failed');
                fail('error.internal');
            });
        });
        socket.on('close', () => {
            channel.markClosed();
            void (async () => {
                if (!session)
                    return;
                const leaving = session;
                leaving.detach(channel);
                await leaving.markDisconnected(channel.userId);
                if (leaving.isEmpty && !leaving.hasMatch)
                    await leaving.dispose();
                else {
                    await leaving.publishRoom();
                    for (const peer of leaving.channelList()) {
                        const snapshot = await leaving.snapshot(peer);
                        if (snapshot)
                            peer.send(snapshot);
                    }
                }
            })().catch(() => undefined);
        });
        socket.on('error', () => channel.markClosed());
    });
}
