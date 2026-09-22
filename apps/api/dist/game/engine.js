import { DEFAULT_LOCALE, MATCH_COUNTDOWN_MS, REVEAL_HOLD_MS, computeScore, validateReaction, } from '@mythos/shared';
import { prisma } from '../db.js';
import { announceRoom, announceRoomRemoved, dropSession } from './registry.js';
import { drawMatchDeck } from './draw.js';
import { decideBotAnswer } from './bot.js';
import { roomSummaryById } from '../services/rooms.js';
import { grantMatchRewards } from '../services/rewards.js';
import { reportMatchResult } from '../services/tournament.js';
/**
 * One room, and the match running inside it.
 *
 * The server owns the clock. `served_at` and `deadline_at` are decided here,
 * written to the database, and only then sent to clients, which do nothing but
 * animate a countdown they cannot influence. A vote that arrives after
 * `deadline_at` is rejected no matter what the browser believes the time is.
 */
export class RoomSession {
    roomId;
    code;
    channels = new Set();
    /** Bots added in the lobby, before a match exists to hold them. */
    pendingBots = new Set();
    match = null;
    phaseTimer = null;
    botTimers = new Set();
    starting = false;
    constructor(roomId, code) {
        this.roomId = roomId;
        this.code = code;
    }
    // -------------------------------------------------------------------------
    // Membership
    // -------------------------------------------------------------------------
    attach(channel) {
        this.channels.add(channel);
    }
    detach(channel) {
        this.channels.delete(channel);
    }
    get isEmpty() {
        return this.channels.size === 0;
    }
    get hasMatch() {
        return this.match !== null;
    }
    /** Distinct human users holding a socket in this room. */
    humanUserIds() {
        return [...new Set([...this.channels].map((c) => c.userId))];
    }
    participantCount() {
        if (this.match)
            return this.match.players.size;
        return this.humanUserIds().length + this.pendingBots.size;
    }
    addBot(botUserId) {
        this.pendingBots.add(botUserId);
    }
    removeBot(botUserId) {
        this.pendingBots.delete(botUserId);
    }
    botIds() {
        return [...this.pendingBots];
    }
    channelsFor(userId) {
        return [...this.channels].filter((c) => c.userId === userId);
    }
    /** Every socket currently attached, for fan-out of a fresh snapshot. */
    channelList() {
        return [...this.channels];
    }
    /** Host removed a player from the lobby: drop their sockets. */
    kick(userId) {
        if (this.match)
            return;
        for (const channel of this.channelsFor(userId)) {
            channel.send({ type: 'error', code: 'error.room.removed', message: 'error.room.removed' });
            this.channels.delete(channel);
            channel.close(4403, 'removed');
        }
    }
    // -------------------------------------------------------------------------
    // Sending
    // -------------------------------------------------------------------------
    broadcast(event) {
        for (const channel of this.channels)
            channel.send(event);
    }
    sendTo(userId, event) {
        for (const channel of this.channelsFor(userId))
            channel.send(event);
    }
    // -------------------------------------------------------------------------
    // Snapshots
    // -------------------------------------------------------------------------
    /**
     * Everything a client needs to render the room, including one mid-match.
     *
     * Reconnection is a lookup, not a replay: the deck was drawn and stored when
     * the match started, so the current card, the time left and the scoreboard
     * are all readable state.
     */
    async snapshot(channel) {
        const room = await prisma.room.findUnique({
            where: { id: this.roomId },
            include: { settings: true },
        });
        const summary = await roomSummaryById(this.roomId);
        if (!room || !summary)
            return null;
        const players = await this.presentPlayers();
        let match = null;
        if (this.match) {
            const m = this.match;
            const entry = m.deck[m.position];
            const now = Date.now();
            match = {
                matchId: m.matchId,
                phase: m.phase,
                position: m.position + 1,
                total: m.deck.length,
                card: entry && (m.phase === 'collecting' || m.phase === 'revealing')
                    ? this.servedCardFor(entry, channel.locale, m)
                    : null,
                remainingMs: Math.max(0, m.phaseEndsAt - now),
                myVote: m.votes.get(channel.userId)?.choice ?? null,
                scoreboard: this.scoreboard(),
            };
        }
        return {
            type: 'room:state',
            room: summary,
            settings: {
                cardCount: room.settings?.cardCount ?? 20,
                categoryIds: room.settings?.categoryIds ?? [],
                answerWindowMs: room.settings?.answerWindowMs ?? 10_000,
                comboEnabled: room.settings?.comboEnabled ?? true,
                doubleCardEnabled: room.settings?.doubleCardEnabled ?? false,
            },
            hostUserId: room.hostUserId,
            players,
            you: { userId: channel.userId },
            match,
        };
    }
    async presentPlayers() {
        const ids = this.match
            ? [...this.match.players.keys()]
            : [...this.humanUserIds(), ...this.pendingBots];
        if (ids.length === 0)
            return [];
        const users = await prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayName: true, avatarUrl: true, level: true, isBot: true },
        });
        // Preserve join order rather than database order.
        const byId = new Map(users.map((u) => [u.id, u]));
        return ids.flatMap((id) => {
            const u = byId.get(id);
            return u ? [u] : [];
        });
    }
    servedCardFor(entry, locale, m) {
        const localized = entry.texts.get(locale);
        const text = localized ?? entry.texts.get(entry.sourceLocale) ?? '';
        return {
            matchCardId: entry.matchCardId,
            position: m.position + 1,
            total: m.deck.length,
            text,
            categoryName: entry.categoryName,
            difficulty: m.difficulty,
            servedAt: m.servedAt,
            deadlineAt: m.deadlineAt,
            windowMs: m.windowMs,
            isDouble: entry.isDouble,
            ...(localized ? {} : { fallbackLocale: entry.sourceLocale }),
        };
    }
    scoreboard() {
        if (!this.match)
            return [];
        const rows = [...this.match.players.values()].map((p) => ({
            userId: p.userId,
            displayName: p.displayName,
            avatarUrl: p.avatarUrl,
            isBot: p.isBot,
            score: p.score,
            comboCurrent: p.combo,
            comboMax: p.comboMax,
            connected: p.connected,
            rank: 0,
            lastDelta: p.lastDelta,
        }));
        rows.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
        // Equal scores share a rank; the next rank skips accordingly.
        let rank = 0;
        let previous = null;
        rows.forEach((row, index) => {
            if (previous === null || row.score !== previous)
                rank = index + 1;
            row.rank = rank;
            previous = row.score;
        });
        return rows;
    }
    // -------------------------------------------------------------------------
    // Match lifecycle
    // -------------------------------------------------------------------------
    /**
     * Draws the whole deck, writes the match, and starts the countdown.
     * Returns an error code instead of throwing so the caller can send it down
     * the socket as a normal `error` event.
     */
    async start(requestedBy) {
        if (this.match || this.starting)
            return 'error.match.alreadyRunning';
        this.starting = true;
        try {
            const room = await prisma.room.findUnique({
                where: { id: this.roomId },
                include: { settings: true },
            });
            if (!room)
                return 'error.notFound';
            if (room.hostUserId !== requestedBy)
                return 'error.match.hostOnly';
            const humans = this.humanUserIds();
            const bots = [...this.pendingBots];
            const participants = [...humans, ...bots];
            if (participants.length < 2)
                return 'error.match.needsTwoPlayers';
            if (participants.length > room.maxPlayers)
                return 'error.match.roomFull';
            const settings = room.settings;
            const windowMs = settings?.answerWindowMs ?? 10_000;
            const requestedCount = settings?.cardCount ?? 20;
            const categoryIds = settings?.categoryIds ?? [];
            const drawn = await drawMatchDeck({
                userIds: humans,
                categoryIds,
                difficulty: room.difficulty,
                count: requestedCount,
            });
            if (drawn.length < 4)
                return 'error.match.notEnoughCards';
            const doubleEnabled = settings?.doubleCardEnabled ?? false;
            // One double-value card per five, placed on fixed positions so every
            // player sees the same ones — it is a room modifier, not a lottery.
            const doubleAt = new Set();
            if (doubleEnabled) {
                for (let i = 4; i < drawn.length; i += 5)
                    doubleAt.add(i);
            }
            const created = await prisma.$transaction(async (tx) => {
                const match = await tx.match.create({
                    data: {
                        roomId: this.roomId,
                        cardCount: drawn.length,
                        tournamentId: null,
                    },
                });
                await tx.matchCard.createMany({
                    data: drawn.map((card, index) => ({
                        matchId: match.id,
                        cardId: card.cardId,
                        position: index,
                        isDouble: doubleAt.has(index),
                    })),
                });
                await tx.matchPlayer.createMany({
                    data: participants.map((userId) => ({ matchId: match.id, userId })),
                });
                await tx.room.update({ where: { id: this.roomId }, data: { status: 'playing' } });
                return match;
            });
            this.match = await this.hydrate(created.id, room.difficulty, windowMs, settings?.comboEnabled ?? true);
            const m = this.match;
            m.phase = 'countdown';
            m.phaseEndsAt = Date.now() + MATCH_COUNTDOWN_MS;
            this.broadcast({
                type: 'match:started',
                matchId: m.matchId,
                total: m.deck.length,
                startsInMs: MATCH_COUNTDOWN_MS,
            });
            await this.publishRoom();
            this.schedule(() => void this.serveNext(), MATCH_COUNTDOWN_MS);
            return null;
        }
        finally {
            this.starting = false;
        }
    }
    /** Loads a persisted match into the in-memory shape the loop runs on. */
    async hydrate(matchId, difficulty, windowMs, comboEnabled) {
        const [cards, players] = await Promise.all([
            prisma.matchCard.findMany({
                where: { matchId },
                orderBy: { position: 'asc' },
                include: {
                    card: {
                        include: {
                            translations: true,
                            fact: { include: { category: true } },
                        },
                    },
                },
            }),
            prisma.matchPlayer.findMany({
                where: { matchId },
                include: {
                    user: {
                        select: {
                            id: true,
                            displayName: true,
                            avatarUrl: true,
                            isBot: true,
                            locale: true,
                            botProfile: true,
                        },
                    },
                },
            }),
        ]);
        const deck = cards.map((mc) => {
            const texts = new Map();
            const sourceLocale = DEFAULT_LOCALE;
            texts.set(sourceLocale, mc.card.text);
            for (const t of mc.card.translations)
                texts.set(t.locale, t.text);
            return {
                matchCardId: mc.id,
                cardId: mc.cardId,
                factId: mc.card.factId,
                isTrue: mc.card.isTrue,
                isDouble: mc.isDouble,
                categorySlug: mc.card.fact.category.slug,
                categoryName: mc.card.fact.category.name,
                sourceRef: mc.card.fact.sourceRef,
                texts,
                sourceLocale,
            };
        });
        const map = new Map();
        for (const p of players) {
            const profile = p.user.botProfile;
            map.set(p.userId, {
                matchPlayerId: p.id,
                userId: p.userId,
                displayName: p.user.displayName,
                avatarUrl: p.user.avatarUrl,
                isBot: p.user.isBot,
                brain: profile
                    ? {
                        label: profile.label,
                        accuracyByCategory: profile.accuracyByCategory,
                        reactionMsMean: profile.reactionMsMean,
                        reactionMsStddev: profile.reactionMsStddev,
                    }
                    : null,
                score: p.score,
                combo: p.comboCurrent,
                comboMax: p.comboMax,
                connected: p.user.isBot ? true : this.channelsFor(p.userId).length > 0,
                lastDelta: null,
            });
        }
        return {
            matchId,
            tournamentId: null,
            deck,
            position: -1,
            phase: 'countdown',
            windowMs,
            comboEnabled,
            difficulty,
            players: map,
            votes: new Map(),
            servedAt: 0,
            deadlineAt: 0,
            phaseEndsAt: Date.now(),
        };
    }
    // -------------------------------------------------------------------------
    // The per-card cycle: SERVING -> COLLECTING -> REVEALING -> ...
    // -------------------------------------------------------------------------
    async serveNext() {
        const m = this.match;
        if (!m)
            return;
        m.position += 1;
        const entry = m.deck[m.position];
        if (!entry) {
            await this.finish();
            return;
        }
        m.phase = 'serving';
        m.votes.clear();
        for (const player of m.players.values())
            player.lastDelta = null;
        const servedAt = Date.now();
        const deadlineAt = servedAt + m.windowMs;
        m.servedAt = servedAt;
        m.deadlineAt = deadlineAt;
        m.phaseEndsAt = deadlineAt;
        // The deadline is persisted before it is announced: the database, not the
        // broadcast, is what a late vote gets checked against.
        await prisma.matchCard.update({
            where: { id: entry.matchCardId },
            data: { servedAt: new Date(servedAt), deadlineAt: new Date(deadlineAt) },
        });
        m.phase = 'collecting';
        // Each player receives the card in their own language.
        for (const channel of this.channels) {
            channel.send({ type: 'card:served', card: this.servedCardFor(entry, channel.locale, m) });
        }
        this.scheduleBots(entry, m);
        this.schedule(() => void this.reveal(), m.windowMs);
    }
    scheduleBots(entry, m) {
        for (const player of m.players.values()) {
            if (!player.isBot || !player.brain)
                continue;
            const decision = decideBotAnswer({
                brain: player.brain,
                categorySlug: entry.categorySlug,
                difficulty: m.difficulty,
                cardIsTrue: entry.isTrue,
                windowMs: m.windowMs,
            });
            if (decision.choice === null)
                continue;
            const choice = decision.choice;
            const timer = setTimeout(() => {
                this.botTimers.delete(timer);
                void this.applyVote({
                    userId: player.userId,
                    matchCardId: entry.matchCardId,
                    choice,
                    acceptedMs: decision.delayMs,
                    clientReactionMs: decision.delayMs,
                    rttMs: 0,
                    trusted: true,
                });
            }, decision.delayMs);
            this.botTimers.add(timer);
        }
    }
    /**
     * A vote arriving from a socket. Validates the window and the reported
     * reaction time, then hands over to the shared `applyVote` path — the same
     * one the bots use, which is what keeps the AI opponent from needing a
     * duplicate copy of the match rules.
     */
    async handleVote(params) {
        const m = this.match;
        if (!m)
            return;
        const entry = m.deck[m.position];
        if (!entry || entry.matchCardId !== params.matchCardId)
            return;
        if (m.phase !== 'collecting')
            return;
        const now = Date.now();
        // Server-side deadline. The client's own clock is never consulted.
        if (now > m.deadlineAt)
            return;
        const { acceptedMs, trusted } = validateReaction({
            claimedMs: params.reactionMs,
            serverElapsedMs: now - m.servedAt,
            rttMs: params.channel.rttMs,
            windowMs: m.windowMs,
        });
        await this.applyVote({
            userId: params.channel.userId,
            matchCardId: params.matchCardId,
            choice: params.choice,
            acceptedMs,
            clientReactionMs: Math.max(0, Math.round(params.reactionMs)),
            rttMs: params.channel.rttMs,
            trusted,
        });
    }
    async applyVote(params) {
        const m = this.match;
        if (!m)
            return;
        const entry = m.deck[m.position];
        if (!entry || entry.matchCardId !== params.matchCardId)
            return;
        if (m.phase !== 'collecting')
            return;
        const player = m.players.get(params.userId);
        if (!player)
            return;
        if (m.votes.has(params.userId))
            return;
        const correct = (params.choice === 'truth') === entry.isTrue;
        const score = computeScore({
            correct,
            reactionMs: params.acceptedMs,
            windowMs: m.windowMs,
            comboBefore: player.combo,
            comboEnabled: m.comboEnabled,
            isDouble: entry.isDouble,
        });
        // The unique index on (match_card_id, match_player_id) is what actually
        // prevents a double vote; the in-memory check above is only a fast path.
        try {
            await prisma.answer.create({
                data: {
                    matchCardId: entry.matchCardId,
                    matchPlayerId: player.matchPlayerId,
                    choice: params.choice,
                    clientReactionMs: params.clientReactionMs,
                    rttMs: params.rttMs,
                    acceptedReactionMs: params.acceptedMs,
                    reactionTrusted: params.trusted,
                    isCorrect: correct,
                    pointsAwarded: score.points,
                },
            });
        }
        catch {
            // Already voted (unique violation) — nothing more to do.
            return;
        }
        m.votes.set(params.userId, {
            choice: params.choice,
            acceptedMs: params.acceptedMs,
            trusted: params.trusted,
            correct,
            points: score.points,
            comboAfter: score.comboAfter,
        });
        this.sendTo(params.userId, {
            type: 'vote:ack',
            matchCardId: entry.matchCardId,
            choice: params.choice,
        });
        // Everyone who could still answer has answered: reveal early.
        const expected = [...m.players.values()].filter((p) => p.isBot || p.connected).length;
        if (m.votes.size >= expected) {
            this.clearPhaseTimer();
            await this.reveal();
        }
    }
    async reveal() {
        const m = this.match;
        if (!m || m.phase !== 'collecting')
            return;
        const entry = m.deck[m.position];
        if (!entry)
            return;
        m.phase = 'revealing';
        this.clearBotTimers();
        const results = [];
        const playerUpdates = [];
        for (const player of m.players.values()) {
            const vote = m.votes.get(player.userId);
            if (!vote) {
                // No answer — whether the player was thinking or offline. Zero points
                // and the combo resets, exactly as a wrong answer's combo would.
                player.combo = 0;
                player.lastDelta = 0;
                results.push({
                    userId: player.userId,
                    choice: null,
                    correct: null,
                    points: 0,
                    reactionMs: null,
                    reactionTrusted: true,
                });
            }
            else {
                player.score += vote.points;
                player.combo = vote.correct ? vote.comboAfter : 0;
                player.comboMax = Math.max(player.comboMax, player.combo);
                player.lastDelta = vote.points;
                results.push({
                    userId: player.userId,
                    choice: vote.choice,
                    correct: vote.correct,
                    points: vote.points,
                    reactionMs: vote.acceptedMs,
                    reactionTrusted: vote.trusted,
                });
            }
            playerUpdates.push({
                id: player.matchPlayerId,
                score: player.score,
                combo: player.combo,
                comboMax: player.comboMax,
            });
        }
        const humanIds = [...m.players.values()].filter((p) => !p.isBot).map((p) => p.userId);
        await prisma.$transaction([
            prisma.matchCard.update({
                where: { id: entry.matchCardId },
                data: { revealedAt: new Date() },
            }),
            ...playerUpdates.map((u) => prisma.matchPlayer.update({
                where: { id: u.id },
                data: { score: u.score, comboCurrent: u.combo, comboMax: u.comboMax },
            })),
            // Seen facts are keyed by fact, never by card: a player who has met one
            // wording of a fact must never be served the other one.
            ...humanIds.map((userId) => prisma.userSeenFact.upsert({
                where: { userId_factId: { userId, factId: entry.factId } },
                create: { userId, factId: entry.factId },
                update: { lastSeenAt: new Date() },
            })),
        ]);
        const isLast = m.position >= m.deck.length - 1;
        m.phaseEndsAt = Date.now() + REVEAL_HOLD_MS;
        this.broadcast({
            type: 'card:revealed',
            matchCardId: entry.matchCardId,
            isTrue: entry.isTrue,
            sourceRef: entry.sourceRef,
            results,
            scoreboard: this.scoreboard(),
            nextInMs: REVEAL_HOLD_MS,
            isLast,
        });
        this.schedule(() => {
            if (isLast)
                void this.finish();
            else
                void this.serveNext();
        }, REVEAL_HOLD_MS);
    }
    async finish() {
        const m = this.match;
        if (!m)
            return;
        m.phase = 'scoreboard';
        this.clearBotTimers();
        this.clearPhaseTimer();
        const board = this.scoreboard();
        await prisma.$transaction([
            prisma.match.update({ where: { id: m.matchId }, data: { endedAt: new Date() } }),
            ...board.map((row) => {
                const player = m.players.get(row.userId);
                return prisma.matchPlayer.update({
                    where: { id: player?.matchPlayerId ?? -1 },
                    data: { finalRank: row.rank },
                });
            }),
        ]);
        let awards = [];
        try {
            awards = await grantMatchRewards(m.matchId);
        }
        catch {
            // Rewards are additive: never let them take a finished match down.
            awards = [];
        }
        let tournament = null;
        try {
            tournament = await reportMatchResult(m.matchId);
        }
        catch {
            tournament = null;
        }
        this.broadcast({
            type: 'match:ended',
            matchId: m.matchId,
            scoreboard: board,
            awards,
            tournament,
        });
        this.match = null;
        // FINISHED -> LOBBY: the room stays alive so the same group can play again.
        await prisma.room.update({ where: { id: this.roomId }, data: { status: 'lobby' } });
        await this.publishRoom();
        // Re-send the lobby view so clients leave the scoreboard cleanly.
        for (const channel of this.channels) {
            const snap = await this.snapshot(channel);
            if (snap)
                channel.send(snap);
        }
    }
    // -------------------------------------------------------------------------
    // Connection changes
    // -------------------------------------------------------------------------
    /**
     * A player dropped. Their `match_players` row is never deleted: they keep
     * their score, keep their place in the ranking, and score zero on every card
     * that passes while they are away.
     */
    async markDisconnected(userId) {
        const m = this.match;
        if (!m)
            return;
        if (this.channelsFor(userId).length > 0)
            return;
        const player = m.players.get(userId);
        if (!player || !player.connected)
            return;
        player.connected = false;
        await prisma.matchPlayer.update({
            where: { id: player.matchPlayerId },
            data: { connected: false, disconnectedAt: new Date() },
        });
        this.broadcast({ type: 'scoreboard:update', scoreboard: this.scoreboard() });
        // The room may now be waiting on nobody.
        if (m.phase === 'collecting') {
            const expected = [...m.players.values()].filter((p) => p.isBot || p.connected).length;
            if (expected > 0 && m.votes.size >= expected) {
                this.clearPhaseTimer();
                await this.reveal();
            }
        }
    }
    async markReconnected(userId) {
        const m = this.match;
        if (!m)
            return;
        const player = m.players.get(userId);
        if (!player || player.connected)
            return;
        player.connected = true;
        await prisma.matchPlayer.update({
            where: { id: player.matchPlayerId },
            data: { connected: true, disconnectedAt: null },
        });
        this.broadcast({ type: 'scoreboard:update', scoreboard: this.scoreboard() });
    }
    /** True when this user has a row in the running match. */
    isInMatch(userId) {
        return this.match?.players.has(userId) ?? false;
    }
    // -------------------------------------------------------------------------
    // Housekeeping
    // -------------------------------------------------------------------------
    schedule(fn, delayMs) {
        this.clearPhaseTimer();
        this.phaseTimer = setTimeout(() => {
            this.phaseTimer = null;
            fn();
        }, delayMs);
    }
    clearPhaseTimer() {
        if (this.phaseTimer) {
            clearTimeout(this.phaseTimer);
            this.phaseTimer = null;
        }
    }
    clearBotTimers() {
        for (const timer of this.botTimers)
            clearTimeout(timer);
        this.botTimers.clear();
    }
    async publishRoom() {
        const summary = await roomSummaryById(this.roomId);
        if (summary)
            announceRoom(summary);
    }
    /** Called when the last socket leaves and no match is running. */
    async dispose() {
        this.clearPhaseTimer();
        this.clearBotTimers();
        this.pendingBots.clear();
        dropSession(this.roomId);
        const room = await prisma.room.findUnique({ where: { id: this.roomId } });
        if (!room) {
            announceRoomRemoved(this.roomId);
            return;
        }
        // An abandoned room stops being advertised, but is kept so its match
        // history and its invite code stay valid.
        if (room.status !== 'lobby') {
            await prisma.room.update({ where: { id: this.roomId }, data: { status: 'lobby' } });
        }
        announceRoomRemoved(this.roomId);
    }
}
