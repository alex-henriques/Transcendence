import type { Difficulty, Locale } from './constants.js';
/**
 * The WebSocket contract.
 *
 * There are two independent channels (spec §10):
 *   /ws/lobby: the public room list and its live changes
 *   /ws/room:  one match; join, vote, reveal, scoreboard
 * Keeping them apart means a message never has to be routed by inspecting a
 * room id that may or may not apply to the socket.
 *
 * Both channels authenticate with a single-use ticket obtained from
 * `POST /api/ws/ticket`; see `apps/api/src/ws/ticket.ts` for why a ticket
 * rather than the access token in the query string.
 */
export type RoomStatus = 'lobby' | 'playing' | 'finished';
export type MatchPhase = 'countdown' | 'serving' | 'collecting' | 'revealing' | 'scoreboard';
export type Vote = 'truth' | 'myth';
export interface PublicUser {
    id: number;
    displayName: string;
    avatarUrl: string | null;
    level: number;
    isBot: boolean;
}
export interface ScoreboardEntry {
    userId: number;
    displayName: string;
    avatarUrl: string | null;
    isBot: boolean;
    score: number;
    comboCurrent: number;
    comboMax: number;
    connected: boolean;
    rank: number;
    /** Points gained or lost on the card that was just revealed. */
    lastDelta: number | null;
}
export interface RoomSummary {
    id: number;
    code: string;
    name: string;
    mode: 'general' | 'category';
    visibility: 'public' | 'private';
    difficulty: Difficulty;
    status: RoomStatus;
    categories: {
        slug: string;
        name: string;
    }[];
    playerCount: number;
    maxPlayers: number;
    hostDisplayName: string;
}
export interface RoomSettingsPayload {
    cardCount: number;
    categoryIds: number[];
    answerWindowMs: number;
    comboEnabled: boolean;
    doubleCardEnabled: boolean;
}
export interface ServedCard {
    matchCardId: number;
    position: number;
    total: number;
    text: string;
    categorySlug: string;
    categoryName: string;
    difficulty: Difficulty;
    /** Server clock, epoch ms. The client only uses these to animate. */
    servedAt: number;
    deadlineAt: number;
    windowMs: number;
    isDouble: boolean;
    /** Present when the viewer's locale has no translation for this card. */
    fallbackLocale?: Locale;
}
export interface RevealedPlayerResult {
    userId: number;
    choice: Vote | null;
    correct: boolean | null;
    points: number;
    reactionMs: number | null;
    /** False when the reported reaction time failed RTT validation. */
    reactionTrusted: boolean;
}
export interface MatchStateSnapshot {
    matchId: number;
    phase: MatchPhase;
    position: number;
    total: number;
    card: ServedCard | null;
    /** Milliseconds left in the current phase, computed by the server at send time. */
    remainingMs: number;
    /** The viewer's own vote on the card in play, if already cast. */
    myVote: Vote | null;
    scoreboard: ScoreboardEntry[];
}
export type ClientLobbyEvent = {
    type: 'pong';
    t: number;
};
export type ClientRoomEvent = {
    type: 'room:join';
    code: string;
} | {
    type: 'room:leave';
}
/** Switching language mid-match: the next card arrives in the new one. */
 | {
    type: 'locale:set';
    locale: Locale;
} | {
    type: 'room:settings';
    settings: RoomSettingsPayload;
} | {
    type: 'room:add_bot';
    profileId: number;
} | {
    type: 'room:remove_player';
    userId: number;
} | {
    type: 'match:start';
} | {
    type: 'card:vote';
    matchCardId: number;
    choice: Vote;
    reactionMs: number;
} | {
    type: 'pong';
    t: number;
};
export type ClientEvent = ClientLobbyEvent | ClientRoomEvent;
export type ServerLobbyEvent = {
    type: 'lobby:rooms';
    rooms: RoomSummary[];
} | {
    type: 'lobby:room_upserted';
    room: RoomSummary;
} | {
    type: 'lobby:room_removed';
    roomId: number;
} | {
    type: 'presence:update';
    userId: number;
    online: boolean;
} | {
    type: 'ping';
    t: number;
} | {
    type: 'error';
    code: string;
    message: string;
};
export type ServerRoomEvent = {
    type: 'room:state';
    room: RoomSummary;
    settings: RoomSettingsPayload;
    hostUserId: number;
    players: PublicUser[];
    you: {
        userId: number;
    };
    match: MatchStateSnapshot | null;
} | {
    type: 'match:started';
    matchId: number;
    total: number;
    startsInMs: number;
} | {
    type: 'card:served';
    card: ServedCard;
} | {
    type: 'card:revealed';
    matchCardId: number;
    isTrue: boolean;
    sourceRef: string | null;
    /**
     * The fact stated correctly, in the viewer's language.
     *
     * A card that was false leaves the player holding a wrong idea, so the
     * reveal has to say what is actually the case. It is always the
     * affirmative wording of the same fact, which for a card that was true is
     * the card itself.
     */
    correction: string;
    results: RevealedPlayerResult[];
    scoreboard: ScoreboardEntry[];
    nextInMs: number;
    isLast: boolean;
} | {
    type: 'scoreboard:update';
    scoreboard: ScoreboardEntry[];
} | {
    type: 'match:ended';
    matchId: number;
    scoreboard: ScoreboardEntry[];
    awards: MatchAward[];
    tournament: {
        id: number;
        advancedUserId: number | null;
    } | null;
} | {
    type: 'vote:ack';
    matchCardId: number;
    choice: Vote;
} | {
    type: 'ping';
    t: number;
} | {
    type: 'error';
    code: string;
    message: string;
};
export type ServerEvent = ServerLobbyEvent | ServerRoomEvent;
/** XP and achievements granted at the end of a match (module 10). */
export interface MatchAward {
    userId: number;
    xpGained: number;
    levelBefore: number;
    levelAfter: number;
    achievements: {
        slug: string;
        name: string;
        description: string;
    }[];
}
/** Narrowing helper used by both channel clients. */
export declare function isServerEvent(value: unknown): value is ServerEvent;
//# sourceMappingURL=events.d.ts.map