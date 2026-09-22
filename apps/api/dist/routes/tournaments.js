import { z } from 'zod';
import { createTournamentSchema } from '@mythos/shared';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { shuffle } from '../lib/random.js';
import { currentUser, requireAuth } from '../plugins/auth.js';
import { bracketView, startTournament } from '../services/tournament.js';
const idParam = z.object({ id: z.coerce.number().int().positive() });
export async function tournamentRoutes(app) {
    app.get('/api/tournaments', { preHandler: requireAuth }, async () => {
        const rows = await prisma.tournament.findMany({
            orderBy: { createdAt: 'desc' },
            take: 25,
            include: { participants: true },
        });
        return {
            tournaments: rows.map((t) => ({
                id: t.id,
                name: t.name,
                status: t.status,
                size: t.size,
                difficulty: t.difficulty,
                cardCount: t.cardCount,
                registered: t.participants.length,
            })),
        };
    });
    app.post('/api/tournaments', { preHandler: requireAuth }, async (request, reply) => {
        const me = currentUser(request);
        const input = createTournamentSchema.parse(request.body);
        const tournament = await prisma.tournament.create({
            data: {
                name: input.name,
                difficulty: input.difficulty,
                cardCount: input.cardCount,
                size: input.size,
                createdById: me.id,
                // The creator is seeded in immediately; a tournament with nobody in it
                // is just a form that was submitted.
                participants: { create: { userId: me.id, seed: 0 } },
            },
        });
        return reply.code(201).send({ tournament: await bracketView(tournament.id) });
    });
    app.get('/api/tournaments/:id', { preHandler: requireAuth }, async (request) => {
        const { id } = idParam.parse(request.params);
        const view = await bracketView(id);
        if (!view)
            throw notFound();
        return { tournament: view };
    });
    app.post('/api/tournaments/:id/join', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const { id } = idParam.parse(request.params);
        const tournament = await prisma.tournament.findUnique({
            where: { id },
            include: { participants: true },
        });
        if (!tournament)
            throw notFound();
        if (tournament.status !== 'registration')
            throw badRequest('error.tournament.alreadyStarted');
        if (tournament.participants.some((p) => p.userId === me.id)) {
            return { tournament: await bracketView(id) };
        }
        if (tournament.participants.length >= tournament.size) {
            throw badRequest('error.tournament.full');
        }
        await prisma.tournamentParticipant.create({
            data: { tournamentId: id, userId: me.id, seed: tournament.participants.length },
        });
        return { tournament: await bracketView(id) };
    });
    app.delete('/api/tournaments/:id/leave', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const { id } = idParam.parse(request.params);
        const tournament = await prisma.tournament.findUnique({ where: { id } });
        if (!tournament)
            throw notFound();
        if (tournament.status !== 'registration')
            throw badRequest('error.tournament.alreadyStarted');
        await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: id, userId: me.id } });
        return { tournament: await bracketView(id) };
    });
    /** Fills the remaining seats with bots so a bracket can start on demand. */
    app.post('/api/tournaments/:id/fill', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const { id } = idParam.parse(request.params);
        const tournament = await prisma.tournament.findUnique({
            where: { id },
            include: { participants: true },
        });
        if (!tournament)
            throw notFound();
        if (tournament.createdById !== me.id)
            throw badRequest('error.tournament.hostOnly');
        if (tournament.status !== 'registration')
            throw badRequest('error.tournament.alreadyStarted');
        const seatsLeft = tournament.size - tournament.participants.length;
        if (seatsLeft <= 0)
            return { tournament: await bracketView(id) };
        const taken = new Set(tournament.participants.map((p) => p.userId));
        const bots = await prisma.user.findMany({ where: { isBot: true }, select: { id: true } });
        const available = shuffle(bots.map((b) => b.id).filter((botId) => !taken.has(botId)));
        if (available.length < seatsLeft)
            throw badRequest('error.tournament.notEnoughBots');
        let seed = tournament.participants.length;
        for (const botId of available.slice(0, seatsLeft)) {
            await prisma.tournamentParticipant.create({
                data: { tournamentId: id, userId: botId, seed },
            });
            seed += 1;
        }
        return { tournament: await bracketView(id) };
    });
    app.post('/api/tournaments/:id/start', { preHandler: requireAuth }, async (request) => {
        const me = currentUser(request);
        const { id } = idParam.parse(request.params);
        const error = await startTournament(id, me.id);
        if (error)
            throw badRequest(error);
        return { tournament: await bracketView(id) };
    });
}
