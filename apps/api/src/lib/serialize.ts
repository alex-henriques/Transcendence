import { levelFromXp, xpIntoLevel } from '@wkb/shared';

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  createdAt: string;
  hasPassword: boolean;
  /// False until the first-run setup screen has been completed or skipped.
  onboarded: boolean;
}

/** The shape returned to the signed-in user about themselves. */
export function sessionUser(user: {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  xp: number;
  passwordHash: string | null;
  onboardedAt: Date | null;
  createdAt: Date;
}): SessionUser {
  const level = levelFromXp(user.xp);
  const { into, needed } = xpIntoLevel(user.xp);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    xp: user.xp,
    level,
    xpIntoLevel: into,
    xpForNextLevel: needed,
    createdAt: user.createdAt.toISOString(),
    hasPassword: user.passwordHash !== null,
    onboarded: user.onboardedAt !== null,
  };
}

/** The shape shown to everyone else. Never includes the email. */
export function publicProfile(user: {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  isBot: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    level: levelFromXp(user.xp),
    xp: user.xp,
    isBot: user.isBot,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
