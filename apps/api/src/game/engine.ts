import type {
  Difficulty,
  Locale,
  MatchAward,
  MatchPhase,
  MatchStateSnapshot,
  PublicUser,
  RevealedPlayerResult,
  ScoreboardEntry,
  ServedCard,
  ServerRoomEvent,
  Vote,
} from '@wkb/shared';
import {
  DEFAULT_LOCALE,
  MATCH_COUNTDOWN_MS,
  REVEAL_HOLD_MS,
  applyDelta,
  computeScore,
  validateReaction,
} from '@wkb/shared';
import { prisma } from '../db.js';
import type { Channel } from '../ws/connection.js';
import { announceRoom, announceRoomRemoved, dropSession } from './registry.js';
import { drawMatchDeck } from './draw.js';
import { decideBotAnswer, type BotBrain } from './bot.js';
import { roomSummaryById } from '../services/rooms.js';
import { grantMatchRewards } from '../services/rewards.js';
import { reportMatchResult } from '../services/tournament.js';

// how long a match waits for a human to come back once the last one has gone
const ABANDON_GRACE_MS = 30_000;

interface DeckEntry {
  matchCardId: number;
  cardId: number;
  factId: number;
  isTrue: boolean;
  isDouble: boolean;
  categorySlug: string;
  categoryName: string;
  sourceRef: string | null;
  // Source text plus every translation, keyed by locale
  texts: Map<string, string>;
  // The affirmative wording of the same fact, keyed by locale. Identical to 'texts' when the card drawn was the true one
  truthTexts: Map<string, string>;
  sourceLocale: Locale;
}

interface PlayerState {
  matchPlayerId: number;
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  isBot: boolean;
  brain: BotBrain | null;
  score: number;
  combo: number;
  comboMax: number;
  connected: boolean;
  lastDelta: number | null;
}

interface VoteRecord {
  choice: Vote;
  acceptedMs: number;
  trusted: boolean;
  correct: boolean;
  points: number;
  comboAfter: number;
}

interface ActiveMatch {
  matchId: number;
  tournamentId: number | null;
  deck: DeckEntry[];
  position: number;
  phase: MatchPhase;
  windowMs: number;
  comboEnabled: boolean;
  difficulty: Difficulty;
  players: Map<number, PlayerState>;
  votes: Map<number, VoteRecord>;
  servedAt: number;
  deadlineAt: number;
  phaseEndsAt: number;
}

/* One room and the match running in it. The server owns the clock. It sets 'served_at' and 'deadline_at'.
Votes after 'deadline_at' are rejected, whatever the time browser shows. */
export class RoomSession {
  readonly roomId: number;
  readonly code: string;

  private channels = new Set<Channel>();
  // Bots added in the lobby, before a match exists to hold them
  private pendingBots = new Set<number>();
  private match: ActiveMatch | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private botTimers = new Set<NodeJS.Timeout>();
  private starting = false;
  private abandonTimer: NodeJS.Timeout | null = null;
  // The results of the card currently being revealed, for a language switch
  private lastResults: RevealedPlayerResult[] = [];

  constructor(roomId: number, code: string) {
    this.roomId = roomId;
    this.code = code;
  }

  // Membership

  attach(channel: Channel): void {
    this.channels.add(channel);
    // someone came back in time. the match isn't abandoned.
    if (this.abandonTimer) 
    {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
    }
  }

  detach(channel: Channel): void {
    this.channels.delete(channel);
  }

  get isEmpty(): boolean {
    return this.channels.size === 0;
  }

  get hasMatch(): boolean {
    return this.match !== null;
  }

  humanUserIds(): number[] {
    return [...new Set([...this.channels].map((c) => c.userId))];
  }

  participantCount(): number {
    if (this.match) 
      return this.match.players.size;
    return this.humanUserIds().length + this.pendingBots.size;
  }

  addBot(botUserId: number): void {
    this.pendingBots.add(botUserId);
  }

  removeBot(botUserId: number): void {
    this.pendingBots.delete(botUserId);
  }

  botIds(): number[] {
    return [...this.pendingBots];
  }

  private channelsFor(userId: number): Channel[] {
    return [...this.channels].filter((c) => c.userId === userId);
  }

  // Every socket currently attached, for fan out of a fresh snapshot
  channelList(): Channel[] {
    return [...this.channels];
  }

  /* Handles a player switching language mid match. The socket's locale is fixed at connect tim, so we resend the room snapshot, not just the card;
  it carries 'remainingMS', so the countdown continues and anm existing vote is kept*/
  async retranslate(channel: Channel, locale: Locale): Promise<void> {
    if (channel.locale === locale) 
      return;
    channel.locale = locale;
    const snapshot = await this.snapshot(channel);
    if (snapshot) 
      channel.send(snapshot);
    const m = this.match;
    const entry = m?.deck[m.position];
    if (m && entry && m.phase === 'revealing') 
    {
      channel.send({
        type: 'card:revealed',
        matchCardId: entry.matchCardId,
        isTrue: entry.isTrue,
        sourceRef: entry.sourceRef,
        correction: this.correctionFor(entry, locale),
        results: this.lastResults,
        scoreboard: this.scoreboard(),
        nextInMs: Math.max(0, m.phaseEndsAt - Date.now()),
        isLast: m.position >= m.deck.length - 1,
      });
    }
  }

  //Host removed a player from the lobby
  kick(userId: number): void {
    if (this.match) return;
    for (const channel of this.channelsFor(userId)) {
      channel.send({ type: 'error', code: 'error.room.removed', message: 'error.room.removed' });
      this.channels.delete(channel);
      channel.close(4403, 'removed');
    }
  }

  // Sending

  broadcast(event: ServerRoomEvent): void {
    for (const channel of this.channels) 
      channel.send(event);
  }

  sendTo(userId: number, event: ServerRoomEvent): void {
    for (const channel of this.channelsFor(userId)) 
      channel.send(event);
  }

 // Snapshots
/* Everything a client needs to render the room, even mid-match. The deck is stored when the match starts so the current card, time left, 
and scoreboard can simply be read.*/
  async snapshot(channel: Channel): Promise<ServerRoomEvent | null> {
    const room = await prisma.room.findUnique({
      where: { id: this.roomId },
      include: { settings: true },
    });
    const summary = await roomSummaryById(this.roomId);
    if (!room || !summary) 
      return null;
    const players = await this.presentPlayers();
    let match: MatchStateSnapshot | null = null;
    if (this.match) 
    {
      const m = this.match;
      const entry = m.deck[m.position];
      const now = Date.now();
      match = {
        matchId: m.matchId,
        phase: m.phase,
        position: m.position + 1,
        total: m.deck.length,
        card:
          entry && (m.phase === 'collecting' || m.phase === 'revealing')
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

  private async presentPlayers(): Promise<PublicUser[]> {
    const ids = this.match
      ? [...this.match.players.keys()]
      : [...this.humanUserIds(), ...this.pendingBots];
    if (ids.length === 0) 
      return [];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, avatarUrl: true, level: true, isBot: true },
    });
    // Preserve join order rather than database order
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids.flatMap((id) => {
      const u = byId.get(id);
      return u ? [u] : [];
    });
  }

  private servedCardFor(entry: DeckEntry, locale: Locale, m: ActiveMatch): ServedCard {
    const localized = entry.texts.get(locale);
    const text = localized ?? entry.texts.get(entry.sourceLocale) ?? '';
    return {
      matchCardId: entry.matchCardId,
      position: m.position + 1,
      total: m.deck.length,
      text,
      categorySlug: entry.categorySlug,
      categoryName: entry.categoryName,
      difficulty: m.difficulty,
      servedAt: m.servedAt,
      deadlineAt: m.deadlineAt,
      windowMs: m.windowMs,
      isDouble: entry.isDouble,
      ...(localized ? {} : { fallbackLocale: entry.sourceLocale }),
    };
  }

  // The fact stated correctly in one player's language 
  private correctionFor(entry: DeckEntry, locale: Locale): string {
    return entry.truthTexts.get(locale) ?? entry.truthTexts.get(entry.sourceLocale) ?? '';
  }

  scoreboard(): ScoreboardEntry[] {
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

    // Equal scores share a rank, the next rank skips accordingly
    let rank = 0;
    let previous: number | null = null;
    rows.forEach((row, index) => {
      if (previous === null || row.score !== previous) 
        rank = index + 1;
      row.rank = rank;
      previous = row.score;
    });
    return rows;
  }

  // Match lifecycle
  /* Draws the whole deck, writes the match, and starts the countdown. Returns an error code instead of throwing so the caller can send it down 
the socket as a normal error event.*/
  async start(requestedBy: number): Promise<string | null> {
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
      // One double value card per five, placed on fixed positions so every player sees the same ones. It's a room modifier and not a lottery
      const doubleAt = new Set<number>();
      if (doubleEnabled) 
      {
        for (let i = 4; i < drawn.length; i += 5) 
          doubleAt.add(i);
      }
      const matchup = await prisma.tournamentMatchup.findFirst({
        where: { roomId: this.roomId, status: { in: ['ready', 'playing'] } },
      });
      const tournamentId = matchup?.tournamentId ?? null;
      if (matchup) 
      {
        const drawn = [matchup.playerAId, matchup.playerBId];
        const exact = participants.length === 2 && drawn.every((id) => id !== null && participants.includes(id));
        if (!exact)
          return 'error.tournament.wrongPlayers';
      }
      const created = await prisma.$transaction(async (tx) => {
        const match = await tx.match.create({
          data: {
            roomId: this.roomId,
            cardCount: drawn.length,
            tournamentId,
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

      this.match = await this.hydrate(created.id, room.difficulty, windowMs, settings?.comboEnabled ?? true, tournamentId);
      const m = this.match;
      m.phase = 'countdown';
      m.phaseEndsAt = Date.now() + MATCH_COUNTDOWN_MS;

      this.broadcast({
        type: 'match:started',
        matchId: m.matchId,
        total: m.deck.length,
        startsInMs: MATCH_COUNTDOWN_MS,
      });
      /* The scoreboard is meant to be visible at all times, so send the opening one now. Without it the sidebar stays empty through the first card,
      which is exactly when a player is sizing up who they are against*/
      this.broadcast({ type: 'scoreboard:update', scoreboard: this.scoreboard() });
      await this.publishRoom();
      this.schedule(() => void this.serveNext(), MATCH_COUNTDOWN_MS);
      return null;
    } finally {
      this.starting = false;
    }
  }

  // Loads a persisted match into the in memory shape the loop runs on
  private async hydrate(
    matchId: number,
    difficulty: Difficulty,
    windowMs: number,
    comboEnabled: boolean,
    tournamentId: number | null,
  ): Promise<ActiveMatch> {
    const [cards, players] = await Promise.all([
      prisma.matchCard.findMany({
        where: { matchId },
        orderBy: { position: 'asc' },
        include: {
          card: {
            include: {
              translations: true,
              // Both wordings of the fact, so the reveal can state the truth even when the card on screen was the false one
              fact: {
                include: { category: true, cards: { include: { translations: true } } },
              },
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

    const deck: DeckEntry[] = cards.map((mc) => {
      const sourceLocale = DEFAULT_LOCALE;
      const localise = (card: { text: string; translations: { locale: string; text: string }[] }) => {
        const map = new Map<string, string>();
        map.set(sourceLocale, card.text);
        for (const t of card.translations) 
          map.set(t.locale, t.text);
        return map;
      };
      const texts = localise(mc.card);
      const truthCard = mc.card.fact.cards.find((c) => c.isTrue);
      const truthTexts = truthCard ? localise(truthCard) : texts;
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
        truthTexts,
        sourceLocale,
      };
    });

    const map = new Map<number, PlayerState>();
    for (const p of players) 
    {
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
              accuracyByCategory: profile.accuracyByCategory as Record<string, number>,
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
      tournamentId,
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

  // SERVING -> COLLECTING -> REVEALING -> ...
  private async serveNext(): Promise<void> {
    const m = this.match;
    if (!m) 
      return;
    m.position += 1;
    const entry = m.deck[m.position];
    if (!entry) 
    {
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
    m.phase = 'collecting';

    /*Announce first, stamp the closck and send the card in the same tick, so a slow database write can't eat into the players' time after
    'deadlineAt' is fixed. Nopthing is lost, the in memory deadline is the one enforced and sent to reconnecting clients*/
    for (const channel of this.channels) 
    {
      channel.send({ type: 'card:served', card: this.servedCardFor(entry, channel.locale, m) });
    }
    this.scheduleBots(entry, m);
    this.schedule(() => void this.reveal(), m.windowMs);
    await prisma.matchCard.update({
      where: { id: entry.matchCardId },
      data: { servedAt: new Date(servedAt), deadlineAt: new Date(deadlineAt) },
    });
  }

  private scheduleBots(entry: DeckEntry, m: ActiveMatch): void {
    for (const player of m.players.values()) 
    {
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

  // Handles a vote from a socket; validates the window and reaction time then calls 'applyVote, which the bots share
  async handleVote(params: {
    channel: Channel;
    matchCardId: number;
    choice: Vote;
    reactionMs: number;
  }): Promise<void> {
    const m = this.match;
    if (!m) 
      return;
    const entry = m.deck[m.position];
    if (!entry || entry.matchCardId !== params.matchCardId) 
      return;
    if (m.phase !== 'collecting') 
      return;
    const now = Date.now();
    // Serverside deadline; the client's own clock is never consulted.
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

  private async applyVote(params: {
    userId: number;
    matchCardId: number;
    choice: Vote;
    acceptedMs: number;
    clientReactionMs: number;
    rttMs: number;
    trusted: boolean;
  }): Promise<void> {
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

    // The penalty can only take away points the player has. 'player.score' is still the score before this card, since totals are applied at the reveal
    const { delta } = applyDelta(player.score, score.points);
    m.votes.set(params.userId, {
      choice: params.choice,
      acceptedMs: params.acceptedMs,
      trusted: params.trusted,
      correct,
      points: delta,
      comboAfter: score.comboAfter,
    });
    // The unique index on (match_card_id, match_player_id) is what actually prevents a double vote; the inmemory check above is only a fast path.
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
          pointsAwarded: delta,
        },
      });
    } catch {
      if (m.phase === 'collecting') 
        m.votes.delete(params.userId);
      return;
    }

    this.sendTo(params.userId, {
      type: 'vote:ack',
      matchCardId: entry.matchCardId,
      choice: params.choice,
    });

    // Everyone who could still answer has answered; reveal early.
    const expected = [...m.players.values()].filter((p) => p.isBot || p.connected).length;
    if (m.votes.size >= expected) 
    {
      this.clearPhaseTimer();
      await this.reveal();
    }
  }

  private async reveal(): Promise<void> {
    const m = this.match;
    if (!m || m.phase !== 'collecting') 
      return;
    const entry = m.deck[m.position];
    if (!entry) 
      return;
    m.phase = 'revealing';
    this.clearBotTimers();
    const results: RevealedPlayerResult[] = [];
    const playerUpdates: { id: number; score: number; combo: number; comboMax: number }[] = [];
    for (const player of m.players.values()) 
    {
      const vote = m.votes.get(player.userId);
      if (!vote) 
      {
        // No answer, zero points, and the combo resets just as it would after a wrong answer
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
      } else 
      {
        // 'vote.points' is already floored against the score at vote time
        player.score = Math.max(0, player.score + vote.points);
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
      ...playerUpdates.map((u) =>
        prisma.matchPlayer.update({
          where: { id: u.id },
          data: { score: u.score, comboCurrent: u.combo, comboMax: u.comboMax },
        }),
      ),
      // Seen facts are keyed by fact, never by card; a player who has met one wording of a fact must never be served the other one
      ...humanIds.map((userId) =>
        prisma.userSeenFact.upsert({
          where: { userId_factId: { userId, factId: entry.factId } },
          create: { userId, factId: entry.factId },
          update: { lastSeenAt: new Date() },
        }),
      ),
    ]);
    const isLast = m.position >= m.deck.length - 1;
    m.phaseEndsAt = Date.now() + REVEAL_HOLD_MS;
    // Everything except the correction is the same for everyone, so it is computed once; only the wording is per language, like 'card:served'
    this.lastResults = results;
    const scoreboard = this.scoreboard();
    for (const channel of this.channels) 
    {
      channel.send({
        type: 'card:revealed',
        matchCardId: entry.matchCardId,
        isTrue: entry.isTrue,
        sourceRef: entry.sourceRef,
        correction: this.correctionFor(entry, channel.locale),
        results,
        scoreboard,
        nextInMs: REVEAL_HOLD_MS,
        isLast,
      });
    }
    this.schedule(() => {
      if (isLast) 
        void this.finish();
      else 
        void this.serveNext();
    }, REVEAL_HOLD_MS);
  }

  private async finish(): Promise<void> {
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

    let awards: MatchAward[] = [];
    try {
      awards = await grantMatchRewards(m.matchId);
    } catch {
      awards = [];
    }
    let tournament: { id: number; advancedUserId: number | null } | null = null;
    try {
      tournament = await reportMatchResult(m.matchId);
    } catch {
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
    // The room stays alive so the same group can play again 
    await prisma.room.update({ where: { id: this.roomId }, data: { status: 'lobby' } });
    await this.publishRoom();
    // Resend the lobby view so clients leave the scoreboard cleanly.
    for (const channel of this.channels) {
      const snap = await this.snapshot(channel);
      if (snap) channel.send(snap);
    }
  }

  // Connection changes
  /* Handles a player disconnecting. Their 'match_players' row is kept so they keep their score and ranking, 
  but they score 0 on every card while away */
  async markDisconnected(userId: number): Promise<void> {
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
    if (m.phase === 'collecting') 
    {
      const expected = [...m.players.values()].filter((p) => p.isBot || p.connected).length;
      if (expected > 0 && m.votes.size >= expected) 
      {
        this.clearPhaseTimer();
        await this.reveal();
      }
    }
  }

  async markReconnected(userId: number): Promise<void> {
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

  // True when this user has a row in the running match
  isInMatch(userId: number): boolean {
    return this.match?.players.has(userId) ?? false;
  }

  forgetPlayer(userId: number): void {
    this.match?.players.delete(userId);
    this.match?.votes.delete(userId);
    for (const channel of this.channelsFor(userId)) 
    {
      this.channels.delete(channel);
      channel.close(4403, 'account deleted');
    }
  }

  /* Handles a socket going away, ie, the player left, closed the tab or dropped. Both rules below must finish before anyone gets a new snapshot,
  so the caller runds this first ans rerenders the room afterwards */
  async handleDeparture(): Promise<void> {
    // A bot holds no socket, so an empty channel set is exactly "no humans left" and there is nobody for the bots to go on playing in front of
    if (this.channels.size === 0) 
    {
    // for a moment a page reloads. give the players the grace period to come back first
      if (this.match && !this.abandonTimer)
      {
        this.abandonTimer = setTimeout(() => {
          this.abandonTimer = null;
          void this.abandonIfStillEmpty().catch(() => undefined);
        }, ABANDON_GRACE_MS);
      }
      return;
    }
    await this.reassignHost();
  }

  private async abandonIfStillEmpty(): Promise<void> {
    if (this.channels.size > 0)
      return;
    await this.abandon();
    await this.dispose();
  }

  // Passes hosts to the longest present human once the host has left. Bots are never candidates. The new host is saved on the room row
  private async reassignHost(): Promise<void> {
    const remaining = this.humanUserIds();
    const heir = remaining[0];
    if (heir === undefined) 
      return;
    const room = await prisma.room.findUnique({
      where: { id: this.roomId },
      select: { hostUserId: true },
    });
    if (!room || remaining.includes(room.hostUserId)) 
      return;
    await prisma.room.update({ where: { id: this.roomId }, data: { hostUserId: heir } });
  }

  /* The last human left mid match, so it stops and records nothing. 'ended_at' stays null. Tournament matches are settled as a forfeit instead,
  so the bracket isn't left waiting*/ 
  private async abandon(): Promise<void> {
    const m = this.match;
    if (!m) 
      return;
    this.clearPhaseTimer();
    this.clearBotTimers();
    this.match = null;
    this.lastResults = [];
    if (m.tournamentId !== null) 
    {
      const ranked = [...m.players.values()].sort((a, b) => {
        const present = Number(b.isBot || b.connected) - Number(a.isBot || a.connected);
        return present !== 0 ? present : b.score - a.score;
      });
      try {
        await prisma.$transaction([
          prisma.match.update({ where: { id: m.matchId }, data: { endedAt: new Date() } }),
          ...ranked.map((player, index) =>
            prisma.matchPlayer.update({
              where: { id: player.matchPlayerId },
              data: { finalRank: index + 1 },
            }),
          ),
        ]);
        await reportMatchResult(m.matchId);
      } catch {
        /* Recording the forfeit is best effort. Whatever happens to the bracket, the room still has to come back to the lobby below, 
        or it's stuck advertising a match that stopped. */
      }
    }
    await prisma.room.update({ where: { id: this.roomId }, data: { status: 'lobby' } });
  }

  // Housekeeping
  private schedule(fn: () => void, delayMs: number): void {
    this.clearPhaseTimer();
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      fn();
    }, delayMs);
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) 
    {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  private clearBotTimers(): void {
    for (const timer of this.botTimers) 
      clearTimeout(timer);
    this.botTimers.clear();
  }

  async publishRoom(): Promise<void> {
    const summary = await roomSummaryById(this.roomId);
    if (summary) 
      announceRoom(summary);
  }

  // Called when the last socket leaves and no match is running
  async dispose(): Promise<void> {
    this.clearPhaseTimer();
    this.clearBotTimers();
    if (this.abandonTimer) 
    {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
    }
    this.pendingBots.clear();
    dropSession(this.roomId);
    const room = await prisma.room.findUnique({ where: { id: this.roomId } });
    if (!room) 
    {
      announceRoomRemoved(this.roomId);
      return;
    }
    // An abandoned room stops being advertised, but is kept so its match history and its invite code stay valid.
    if (room.status !== 'lobby') 
    {
      await prisma.room.update({ where: { id: this.roomId }, data: { status: 'lobby' } });
    }
    announceRoomRemoved(this.roomId);
  }
}
