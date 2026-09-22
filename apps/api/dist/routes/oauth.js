import { z } from 'zod';
import { DEFAULT_LOCALE } from '@mythos/shared';
import { prisma } from '../db.js';
import { cookieSecure, env, oauthProviders } from '../env.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { token } from '../lib/random.js';
import { safeEqual } from '../lib/tokens.js';
import { issueRefreshToken } from '../lib/tokens.js';
import { setRefreshCookie } from './auth.js';
/**
 * OAuth 2.0 authorization-code flow (module 8).
 *
 * The callback never puts a token in the redirect URL. It sets the refresh
 * cookie and bounces to /auth/callback, where the SPA does an ordinary
 * `POST /api/auth/refresh` to obtain its access token — the same path a
 * returning visitor takes.
 */
const STATE_COOKIE = 'mythos_oauth_state';
const providerSchema = z.enum(['google', 'github']);
function redirectUri(provider) {
    return `${env.PUBLIC_ORIGIN}/api/auth/oauth/${provider}/callback`;
}
function authorizeUrl(provider, state) {
    const config = oauthProviders[provider];
    if (provider === 'google') {
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: redirectUri(provider),
            response_type: 'code',
            scope: 'openid email profile',
            state,
            prompt: 'select_account',
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }
    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri(provider),
        scope: 'read:user user:email',
        state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
async function exchangeCode(provider, code) {
    const config = oauthProviders[provider];
    const url = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token';
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri(provider),
            grant_type: 'authorization_code',
        }),
    });
    if (!response.ok)
        throw badRequest('error.oauth.exchangeFailed');
    const payload = (await response.json());
    if (!payload.access_token)
        throw badRequest('error.oauth.exchangeFailed');
    return payload.access_token;
}
async function fetchProfile(provider, accessToken) {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'mythos-ft-transcendence',
    };
    if (provider === 'google') {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers });
        if (!response.ok)
            throw badRequest('error.oauth.profileFailed');
        const profile = (await response.json());
        if (!profile.email)
            throw badRequest('error.oauth.noEmail');
        return {
            providerUserId: profile.sub,
            email: profile.email.toLowerCase(),
            displayName: profile.name ?? profile.email.split('@')[0] ?? 'player',
            avatarUrl: profile.picture ?? null,
        };
    }
    const response = await fetch('https://api.github.com/user', { headers });
    if (!response.ok)
        throw badRequest('error.oauth.profileFailed');
    const profile = (await response.json());
    let email = profile.email ?? null;
    if (!email) {
        // GitHub hides the address unless it is public; ask for the verified one.
        const emailResponse = await fetch('https://api.github.com/user/emails', { headers });
        if (emailResponse.ok) {
            const emails = (await emailResponse.json());
            email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
        }
    }
    if (!email)
        throw badRequest('error.oauth.noEmail');
    return {
        providerUserId: String(profile.id),
        email: email.toLowerCase(),
        displayName: profile.name ?? profile.login,
        avatarUrl: profile.avatar_url ?? null,
    };
}
/** Display names are unique; a taken one gets a numeric suffix. */
async function uniqueDisplayName(preferred) {
    const base = preferred.trim().slice(0, 20).replace(/[^\p{L}\p{N} _.-]/gu, '') || 'player';
    const padded = base.length >= 3 ? base : `${base}_player`.slice(0, 20);
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const candidate = attempt === 0 ? padded : `${padded.slice(0, 20)}${attempt}`;
        const taken = await prisma.user.findUnique({ where: { displayName: candidate } });
        if (!taken)
            return candidate;
    }
    return `player_${token(4)}`;
}
/**
 * Links the provider identity to an account: an existing link wins, then a
 * matching email (so signing in with Google on an account created by password
 * is a link and not a duplicate), and otherwise a new account is created.
 */
async function resolveUser(provider, profile) {
    const linked = await prisma.oAuthAccount.findUnique({
        where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
    });
    if (linked)
        return linked.userId;
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
        await prisma.oAuthAccount.create({
            data: { userId: byEmail.id, provider, providerUserId: profile.providerUserId },
        });
        return byEmail.id;
    }
    const created = await prisma.user.create({
        data: {
            email: profile.email,
            displayName: await uniqueDisplayName(profile.displayName),
            // No password: the account is provider-only until the user sets one.
            passwordHash: null,
            avatarUrl: profile.avatarUrl,
            locale: DEFAULT_LOCALE,
            lastSeenAt: new Date(),
            oauthAccounts: { create: { provider, providerUserId: profile.providerUserId } },
        },
    });
    return created.id;
}
export async function oauthRoutes(app) {
    app.get('/api/auth/oauth/:provider', async (request, reply) => {
        const parsed = providerSchema.safeParse(request.params.provider);
        if (!parsed.success)
            throw notFound();
        const provider = parsed.data;
        if (!oauthProviders[provider].enabled)
            throw notFound('error.oauth.notConfigured');
        const state = token(24);
        reply.setCookie(STATE_COOKIE, state, {
            httpOnly: true,
            sameSite: 'lax', // The provider redirects back cross-site; strict would drop it.
            secure: cookieSecure,
            path: '/api/auth/oauth',
            maxAge: 600,
        });
        return reply.redirect(authorizeUrl(provider, state));
    });
    app.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
        const parsed = providerSchema.safeParse(request.params.provider);
        if (!parsed.success)
            throw notFound();
        const provider = parsed.data;
        if (!oauthProviders[provider].enabled)
            throw notFound('error.oauth.notConfigured');
        const query = request.query;
        reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });
        const fail = (reason) => reply.redirect(`${env.PUBLIC_ORIGIN}/login?oauth_error=${encodeURIComponent(reason)}`);
        if (query.error)
            return fail(query.error);
        const expected = request.cookies[STATE_COOKIE];
        if (!query.state || !expected || !safeEqual(query.state, expected))
            return fail('state');
        if (!query.code)
            return fail('code');
        try {
            const accessToken = await exchangeCode(provider, query.code);
            const profile = await fetchProfile(provider, accessToken);
            const userId = await resolveUser(provider, profile);
            await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
            setRefreshCookie(reply, await issueRefreshToken(userId));
            return reply.redirect(`${env.PUBLIC_ORIGIN}/auth/callback`);
        }
        catch (error) {
            request.log.warn({ err: error, provider }, 'oauth callback failed');
            return fail('exchange');
        }
    });
}
