import { mkdir } from 'node:fs/promises';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { AVATAR_MAX_BYTES } from '@mythos/shared';
import './types.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { registerErrorHandler } from './plugins/errors.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { friendRoutes } from './routes/friends.js';
import { healthRoutes } from './routes/health.js';
import { oauthRoutes } from './routes/oauth.js';
import { roomRoutes } from './routes/rooms.js';
import { statsRoutes } from './routes/stats.js';
import { tournamentRoutes } from './routes/tournaments.js';
import { UPLOAD_DIR, userRoutes } from './routes/users.js';
import { registerLobbyChannel } from './ws/lobby.js';
import { registerRoomChannel } from './ws/room.js';
async function build() {
    const app = Fastify({
        logger: { level: env.LOG_LEVEL },
        // We sit behind the nginx edge; trust its forwarding headers so rate
        // limiting and logging see the real client address.
        trustProxy: true,
        bodyLimit: 1_048_576,
    });
    registerErrorHandler(app);
    await app.register(cookie);
    await app.register(rateLimit, {
        global: false,
        max: 300,
        timeWindow: '1 minute',
    });
    await app.register(multipart, {
        limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 4 },
    });
    await app.register(websocket, {
        options: { maxPayload: 64 * 1024 },
    });
    await mkdir(UPLOAD_DIR, { recursive: true });
    await app.register(fastifyStatic, {
        root: UPLOAD_DIR,
        prefix: '/api/uploads/',
        // User-supplied bytes: never let the browser guess what they are, and
        // never let one of them execute in our origin.
        setHeaders(reply) {
            reply.setHeader('X-Content-Type-Options', 'nosniff');
            reply.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            reply.setHeader('Cache-Control', 'public, max-age=86400');
        },
    });
    await app.register(healthRoutes);
    await app.register(authRoutes);
    await app.register(oauthRoutes);
    await app.register(userRoutes);
    await app.register(friendRoutes);
    await app.register(roomRoutes);
    await app.register(catalogRoutes);
    await app.register(statsRoutes);
    await app.register(tournamentRoutes);
    await app.register(registerLobbyChannel);
    await app.register(registerRoomChannel);
    return app;
}
async function main() {
    const app = await build();
    const shutdown = async (signal) => {
        app.log.info({ signal }, 'shutting down');
        try {
            await app.close();
            await prisma.$disconnect();
        }
        finally {
            process.exit(0);
        }
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    try {
        await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
    }
    catch (error) {
        app.log.error({ err: error }, 'failed to start');
        process.exit(1);
    }
}
void main();
