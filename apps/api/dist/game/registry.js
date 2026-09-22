/**
 * Process-local state for live rooms and for the lobby channel.
 *
 * The engine keeps one authoritative copy of every running match in memory and
 * writes through to Postgres. That is only sound because the API runs as a
 * single process; scaling out would need the timers moved behind a shared
 * lock. The trade-off is recorded in the README under "Known limitations".
 */
const rooms = new Map();
export function getSession(roomId) {
    return rooms.get(roomId);
}
export function setSession(roomId, session) {
    rooms.set(roomId, session);
}
export function dropSession(roomId) {
    rooms.delete(roomId);
}
export function activeSessions() {
    return [...rooms.values()];
}
// ---------------------------------------------------------------------------
// Lobby channel
// ---------------------------------------------------------------------------
const lobbyChannels = new Set();
export function joinLobby(channel) {
    lobbyChannels.add(channel);
}
export function leaveLobby(channel) {
    lobbyChannels.delete(channel);
}
export function lobbyBroadcast(event) {
    for (const channel of lobbyChannels)
        channel.send(event);
}
export function announceRoom(room) {
    // Private rooms are reachable by code only and never appear in the listing.
    if (room.visibility !== 'public')
        return;
    lobbyBroadcast({ type: 'lobby:room_upserted', room });
}
export function announceRoomRemoved(roomId) {
    lobbyBroadcast({ type: 'lobby:room_removed', roomId });
}
export function announcePresence(userId, online) {
    lobbyBroadcast({ type: 'presence:update', userId, online });
}
/** Distinct users currently holding at least one lobby socket. */
export function onlineUserIds() {
    const ids = new Set();
    for (const channel of lobbyChannels)
        ids.add(channel.userId);
    return ids;
}
