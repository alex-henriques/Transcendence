import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientLobbyEvent } from '@wkb/shared';
import { prisma } from '../db.js';
import { Channel } from './connection.js';
import { redeemTicket } from './ticket.js';
import { announcePresence, joinLobby, leaveLobby, onlineUserIds } from '../game/registry.js';
import { listPublicRooms } from '../services/rooms.js';

/**
 * The lobby channel: the public room list, and presence.
 *
 * Kept separate from the match channel so that a message never has to be
 * routed by working out whether the socket happens to be in a room. It is also
 * what keeps `last_seen_at` warm, which is where the friends list reads a
 * user's online status from.
 */
export async function registerLobbyChannel(app: FastifyInstance): Promise<void> {
  app.get('/ws/lobby', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const query = request.query as { ticket?: string };
    const redeemed = redeemTicket(query.ticket);

    if (!redeemed) {
      socket.send(
        JSON.stringify({ type: 'error', code: 'error.ws.badTicket', message: 'error.ws.badTicket' }),
      );
      socket.close(4401, 'unauthorized');
      return;
    }

    const channel = new Channel(socket, redeemed.userId, redeemed.locale, () => {
      request.log.debug({ userId: redeemed.userId }, 'lobby socket heartbeat timeout');
    });

    const wasOffline = !onlineUserIds().has(redeemed.userId);
    joinLobby(channel);
    channel.startHeartbeat();

    if (wasOffline) announcePresence(redeemed.userId, true);

    void (async () => {
      channel.send({ type: 'lobby:rooms', rooms: await listPublicRooms() });
      await prisma.user
        .update({ where: { id: redeemed.userId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    })();

    // The heartbeat doubles as the presence refresh.
    const presenceTimer = setInterval(() => {
      void prisma.user
        .update({ where: { id: redeemed.userId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }, 30_000);

    socket.on('message', (raw: Buffer) => {
      let event: ClientLobbyEvent;
      try {
        event = JSON.parse(raw.toString()) as ClientLobbyEvent;
      } catch {
        return;
      }
      if (event?.type === 'pong') channel.handlePong(Number(event.t));
    });

    socket.on('close', () => {
      clearInterval(presenceTimer);
      channel.markClosed();
      leaveLobby(channel);
      if (!onlineUserIds().has(redeemed.userId)) announcePresence(redeemed.userId, false);
    });

    socket.on('error', () => {
      clearInterval(presenceTimer);
      channel.markClosed();
      leaveLobby(channel);
    });
  });
}
