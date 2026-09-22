import { PING_INTERVAL_MS, PING_MAX_MISSED } from '@mythos/shared';
/**
 * One authenticated socket on either channel.
 *
 * Owns the heartbeat, which does double duty: it detects dead connections and
 * it produces the round-trip-time estimate the vote validator needs (spec §11).
 */
export class Channel {
    socket;
    userId;
    locale;
    /** Moving average of round-trip time, in milliseconds. */
    rttMs = 0;
    pingTimer = null;
    pendingPings = new Map();
    missed = 0;
    closed = false;
    onDead;
    constructor(socket, userId, locale, onDead) {
        this.socket = socket;
        this.userId = userId;
        this.locale = locale;
        this.onDead = onDead;
    }
    get isOpen() {
        return !this.closed && this.socket.readyState === 1;
    }
    send(event) {
        if (!this.isOpen)
            return;
        try {
            this.socket.send(JSON.stringify(event));
        }
        catch {
            // A send that throws means the peer is gone; the close handler follows.
        }
    }
    startHeartbeat() {
        this.pingTimer = setInterval(() => {
            if (!this.isOpen)
                return;
            // Every outstanding ping counts as missed until its pong arrives.
            if (this.pendingPings.size > 0) {
                this.missed += 1;
                if (this.missed >= PING_MAX_MISSED) {
                    this.pendingPings.clear();
                    this.onDead();
                    this.close(1001, 'heartbeat timeout');
                    return;
                }
            }
            const t = Date.now();
            this.pendingPings.set(t, t);
            this.send({ type: 'ping', t });
        }, PING_INTERVAL_MS);
    }
    /**
     * EWMA rather than a raw sample: a single slow pong should not let a client
     * claim an implausibly fast reaction on the next card.
     */
    handlePong(t) {
        const sentAt = this.pendingPings.get(t);
        if (sentAt === undefined)
            return;
        this.pendingPings.delete(t);
        this.missed = 0;
        const sample = Date.now() - sentAt;
        this.rttMs = this.rttMs === 0 ? sample : Math.round(this.rttMs * 0.7 + sample * 0.3);
    }
    close(code = 1000, reason = 'closed') {
        if (this.closed)
            return;
        this.closed = true;
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        try {
            this.socket.close(code, reason);
        }
        catch {
            // Already torn down.
        }
    }
    /** Called from the socket's own close handler. */
    markClosed() {
        this.closed = true;
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
}
