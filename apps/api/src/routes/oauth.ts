import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_LOCALE } from '@wkb/shared';
import { prisma } from '../db.js';
import {
  cookieSecure,
  env,
  oauthProviders,
  publicOrigins,
  type OAuthProviderName,
} from '../env.js';
import { token } from '../lib/random.js';
import { safeEqual } from '../lib/tokens.js';
import { issueRefreshToken } from '../lib/tokens.js';
import { setRefreshCookie } from './auth.js';
import { HttpError, badRequest, notFound } from '../lib/httpError.js';

/**
 * OAuth 2.0 authorization-code flow (module 8).
 *
 * The callback never puts a token in the redirect URL. It sets the refresh
 * cookie and bounces to /auth/callback, where the SPA does an ordinary
 * `POST /api/auth/refresh` to obtain its access token, which is the same path
 * a returning visitor takes.
 */

const STATE_COOKIE = 'wkb_oauth_state';
const providerSchema = z.enum(['google', 'github', '42']);

/**
 * Everything the authorization-code flow needs that differs per provider. Only
 * the profile call is left as a branch below, because each one returns a
 * different shape and there is nothing to table-drive.
 */
const ENDPOINTS: Record<
  OAuthProviderName,
  { authorize: string; token: string; scope: string; extra?: Record<string, string> }
> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extra: { response_type: 'code', prompt: 'select_account' },
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
  '42': {
    authorize: 'https://api.intra.42.fr/oauth/authorize',
    token: 'https://api.intra.42.fr/oauth/token',
    // `public` is the whole of it: an id, an email, a login and an avatar.
    // The other scopes on the intra form would be asking for permissions this
    // application has no use for.
    scope: 'public',
    extra: { response_type: 'code' },
  },
};

interface ProviderProfile {
  providerUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Configured origins indexed by the Host header that should select them, with
 * and without the port, since a proxy may or may not pass it through.
 * `PUBLIC_ORIGIN` is first in `publicOrigins`, so it wins any collision.
 */
const ORIGIN_BY_HOST = new Map<string, string>();
for (const origin of [...publicOrigins].reverse()) {
  const url = new URL(origin);
  ORIGIN_BY_HOST.set(url.host, origin);
  ORIGIN_BY_HOST.set(url.hostname, origin);
}

/**
 * The origin to send this particular visitor back to.
 *
 * The deployment can answer on more than one address, typically a LAN address
 * for other machines and localhost on the machine it runs on, and a visitor
 * has to come back to the address they left from or their cookies belong to a
 * different origin. The Host header selects which one, but only by looking it
 * up in the configured list, and the value returned is the configured string
 * rather than anything rebuilt from the request. Trusting the header itself
 * would let a forged one choose where the authorization code is delivered.
 */
function originFor(request: FastifyRequest): string {
  const host = request.headers.host;
  if (!host) return env.PUBLIC_ORIGIN;
  return ORIGIN_BY_HOST.get(host) ?? env.PUBLIC_ORIGIN;
}

function redirectUri(provider: OAuthProviderName, origin: string): string {
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

function authorizeUrl(provider: OAuthProviderName, state: string, origin: string): string {
  const endpoints = ENDPOINTS[provider];
  const params = new URLSearchParams({
    client_id: oauthProviders[provider].clientId,
    redirect_uri: redirectUri(provider, origin),
    scope: endpoints.scope,
    state,
    ...endpoints.extra,
  });
  return `${endpoints.authorize}?${params.toString()}`;
}

async function exchangeCode(
  provider: OAuthProviderName,
  code: string,
  origin: string,
): Promise<string> {
  const config = oauthProviders[provider];

  const response = await fetch(ENDPOINTS[provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      // Must be byte-for-byte the value sent to the authorize endpoint, which
      // is why the origin is carried through rather than recomputed.
      redirect_uri: redirectUri(provider, origin),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) throw badRequest('error.oauth.exchangeFailed');
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw badRequest('error.oauth.exchangeFailed');
  return payload.access_token;
}

async function fetchProfile(
  provider: OAuthProviderName,
  accessToken: string,
): Promise<ProviderProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'wkb-ft-transcendence',
  };

  if (provider === 'google') {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers });
    if (!response.ok) throw badRequest('error.oauth.profileFailed');
    const profile = (await response.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!profile.email || profile.email_verified !== true) {
      throw badRequest('error.oauth.noEmail');
    }
<<<<<<< HEAD
=======
    if (!profile.email) throw badRequest('error.oauth.noEmail');
>>>>>>> 621996acc464036120d25e6382210027a6a3c176
    return {
      providerUserId: profile.sub,
      email: profile.email.toLowerCase(),
      displayName: profile.name ?? profile.email.split('@')[0] ?? 'player',
      avatarUrl: profile.picture ?? null,
    };
  }

  if (provider === '42') {
    const response = await fetch('https://api.intra.42.fr/v2/me', { headers });
    if (!response.ok) throw badRequest('error.oauth.profileFailed');
    const profile = (await response.json()) as {
      id: number;
      login: string;
      email?: string;
      image?: { link?: string | null; versions?: { medium?: string | null } };
    };
    if (!profile.email) throw badRequest('error.oauth.noEmail');
    return {
      providerUserId: String(profile.id),
      email: profile.email.toLowerCase(),
      // The login rather than `displayname`, which is the student's real name.
      // Display names are public here — they sit on the leaderboard and in
      // every room — and an intra login is already the handle 42 students are
      // known by, so it is the one that belongs on a scoreboard.
      displayName: profile.login,
      // `versions.medium` is 96px. The largest avatar this interface draws is
      // 80px, and `link` is the untouched original, which can be a megabyte.
      avatarUrl: profile.image?.versions?.medium ?? profile.image?.link ?? null,
    };
  }

  const response = await fetch('https://api.github.com/user', { headers });
  if (!response.ok) throw badRequest('error.oauth.profileFailed');
  const profile = (await response.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string;
    email?: string | null;
  };

  let email = profile.email ?? null;
  if (!email) {
    // GitHub hides the address unless it is public; ask for the verified one.
    const emailResponse = await fetch('https://api.github.com/user/emails', { headers });
    if (emailResponse.ok) {
      const emails = (await emailResponse.json()) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
    }
  }
  if (!email) throw badRequest('error.oauth.noEmail');

  return {
    providerUserId: String(profile.id),
    email: email.toLowerCase(),
    displayName: profile.name ?? profile.login,
    avatarUrl: profile.avatar_url ?? null,
  };
}

/** Display names are unique; a taken one gets a numeric suffix. */
async function uniqueDisplayName(preferred: string): Promise<string> {
  const base = preferred.trim().slice(0, 20).replace(/[^\p{L}\p{N} _.-]/gu, '') || 'player';
  const padded = base.length >= 3 ? base : `${base}_player`.slice(0, 20);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? padded : `${padded.slice(0, 20)}${attempt}`;
    const taken = await prisma.user.findUnique({ where: { displayName: candidate } });
    if (!taken) return candidate;
  }
  return `player_${token(4)}`;
}

/**
 * Links the provider identity to an account: an existing link wins, then a
 * matching email (so signing in with Google on an account created by password
 * is a link and not a duplicate), and otherwise a new account is created.
 */
async function resolveUser(provider: OAuthProviderName, profile: ProviderProfile): Promise<number> {
  const linked = await prisma.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
  });
  if (linked) return linked.userId;

  const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
  if (byEmail) {
    if (byEmail.passwordHash != null)
      throw badRequest('error.oauth.accountExists');
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

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/oauth/:provider', async (request, reply) => {
    const parsed = providerSchema.safeParse(
      (request.params as { provider?: string }).provider,
    );
    if (!parsed.success) throw notFound();
    const provider = parsed.data;
    if (!oauthProviders[provider].enabled) throw notFound('error.oauth.notConfigured');

    const state = token(24);
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax', // The provider redirects back cross-site; strict would drop it.
      secure: cookieSecure,
      path: '/api/auth/oauth',
      maxAge: 600,
    });

    return reply.redirect(authorizeUrl(provider, state, originFor(request)));
  });

  app.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
    const parsed = providerSchema.safeParse((request.params as { provider?: string }).provider);
    if (!parsed.success) throw notFound();
    const provider = parsed.data;
    if (!oauthProviders[provider].enabled) throw notFound('error.oauth.notConfigured');

    const query = request.query as { code?: string; state?: string; error?: string };
    reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });

    const origin = originFor(request);
    const fail = (reason: string) =>
      reply.redirect(`${origin}/login?oauth_error=${encodeURIComponent(reason)}`);

    if (query.error) return fail(query.error);

    const expected = request.cookies[STATE_COOKIE];
    if (!query.state || !expected || !safeEqual(query.state, expected)) return fail('state');
    if (!query.code) return fail('code');

    try {
      const accessToken = await exchangeCode(provider, query.code, origin);
      const profile = await fetchProfile(provider, accessToken);
      const userId = await resolveUser(provider, profile);

      await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
      setRefreshCookie(reply, await issueRefreshToken(userId));

      return reply.redirect(`${origin}/auth/callback`);
    } catch (error) {
      request.log.warn({ err: error, provider }, 'oauth callback failed');
      const exists = error instanceof HttpError && error.code === 'error.oauth.accountExists';
      return fail(exists ? 'accountExists' : 'exchange');
    }
  });
}
