import { z } from 'zod';

/**
 * Configuration is validated once, at boot. A missing secret should stop the
 * process immediately rather than surface as a confusing 500 an hour later.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PUBLIC_ORIGIN: z.string().url().default('https://localhost:8443'),
  // Other addresses the same deployment is reached by, comma separated.
  // Serving on a LAN address does not stop localhost from working.
  PUBLIC_ORIGIN_ALIASES: z.string().optional().default(''),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),

  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  // 42's own OAuth provider. `FT_` rather than `42_` because an environment
  // variable name cannot start with a digit.
  FT_CLIENT_ID: z.string().optional().default(''),
  FT_CLIENT_SECRET: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = parsed.data;

/**
 * The slug is what appears in the callback URL, so `42` is the one registered
 * with 42's intra as the redirect URI. The type is written out rather than
 * inferred: TypeScript reads a numeric-looking object key as a number, and
 * every use of this name is a string.
 */
export type OAuthProviderName = 'google' | 'github' | '42';

interface OAuthProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

export const oauthProviders: Record<OAuthProviderName, OAuthProviderConfig> = {
  google: {
    enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  },
  github: {
    enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  },
  '42': {
    enabled: Boolean(env.FT_CLIENT_ID && env.FT_CLIENT_SECRET),
    clientId: env.FT_CLIENT_ID,
    clientSecret: env.FT_CLIENT_SECRET,
  },
};

/** Cookies are only marked Secure when the public origin actually is HTTPS. */
export const cookieSecure = env.PUBLIC_ORIGIN.startsWith('https://');

/**
 * Every origin this deployment answers on, `PUBLIC_ORIGIN` first.
 *
 * This is an allowlist and not a hint. An OAuth redirect built from the
 * request's own Host header would let anyone who can set that header point
 * the callback, and the code, at a host of their choosing, so a request is
 * only ever answered on an origin that appears in this list.
 */
export const publicOrigins: string[] = [
  env.PUBLIC_ORIGIN,
  ...env.PUBLIC_ORIGIN_ALIASES.split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0),
].filter((origin, index, all) => all.indexOf(origin) === index);
