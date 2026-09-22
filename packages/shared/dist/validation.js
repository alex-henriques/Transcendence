import { z } from 'zod';
import { avatarPresetSchema } from './avatars.js';
import { DIFFICULTIES, LOCALES, ROOM_LIMITS } from './constants.js';
/**
 * Every schema here is imported by the React forms *and* by the Fastify route
 * handlers. The subject requires validation on both sides; sharing one file is
 * how we guarantee the two sides cannot drift apart.
 */
export const emailSchema = z
    .string()
    .trim()
    .min(3, 'validation.email.required')
    .max(254, 'validation.email.tooLong')
    .email('validation.email.invalid')
    .toLowerCase();
/**
 * Deliberately a length floor plus a character-class floor rather than a regex
 * zoo: long passphrases must stay legal.
 */
export const passwordSchema = z
    .string()
    .min(10, 'validation.password.tooShort')
    .max(200, 'validation.password.tooLong')
    .refine((v) => /[a-z]/i.test(v), 'validation.password.needsLetter')
    .refine((v) => /[0-9]/.test(v), 'validation.password.needsDigit');
export const displayNameSchema = z
    .string()
    .trim()
    .min(3, 'validation.displayName.tooShort')
    .max(24, 'validation.displayName.tooLong')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u, 'validation.displayName.invalidChars');
export const localeSchema = z.enum(LOCALES);
export const difficultySchema = z.enum(DIFFICULTIES);
export const signupSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
    locale: localeSchema.optional(),
});
export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'validation.password.required'),
});
export const updateProfileSchema = z.object({
    displayName: displayNameSchema.optional(),
    locale: localeSchema.optional(),
    /// One of the stock avatars, or null to go back to generated initials.
    /// Validated against the shipped list on both sides, so the value that
    /// reaches storage is always one the renderer knows how to draw.
    avatarPreset: avatarPresetSchema.nullable().optional(),
    /// Sent once, by the first-run setup screen, to stop it coming back.
    /// `true` only: nothing may un-onboard an account over the API.
    onboarded: z.literal(true).optional(),
});
/**
 * Deleting an account (module 15). `confirm` must be the display name typed
 * back, so the request cannot be a stray click, and `password` is required
 * whenever the account has one: erasure is irreversible and re-authenticating
 * is the only thing that proves the person asking is the account holder.
 */
export const deleteAccountSchema = z.object({
    confirm: z.string().min(1, 'validation.confirm.required'),
    password: z.string().optional(),
});
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'validation.password.required'),
    newPassword: passwordSchema,
});
export const roomCodeSchema = z
    .string()
    .trim()
    .toUpperCase()
    .length(ROOM_LIMITS.CODE_LENGTH, 'validation.roomCode.length')
    .regex(/^[A-Z0-9]+$/, 'validation.roomCode.invalidChars');
export const roomSettingsSchema = z
    .object({
    cardCount: z
        .number()
        .int()
        .min(ROOM_LIMITS.MIN_CARDS, 'validation.cardCount.range')
        .max(ROOM_LIMITS.MAX_CARDS, 'validation.cardCount.range'),
    /** Empty array means "every category" (general mode). */
    categoryIds: z.array(z.number().int().positive()).max(32).default([]),
    answerWindowMs: z.number().int().min(3_000).max(30_000),
    comboEnabled: z.boolean().default(true),
    doubleCardEnabled: z.boolean().default(false),
})
    .strict();
export const createRoomSchema = z
    .object({
    name: z
        .string()
        .trim()
        .min(3, 'validation.roomName.tooShort')
        .max(40, 'validation.roomName.tooLong'),
    visibility: z.enum(['public', 'private']).default('public'),
    mode: z.enum(['general', 'category']).default('general'),
    difficulty: difficultySchema.default('medium'),
    maxPlayers: z
        .number()
        .int()
        .min(2, 'validation.maxPlayers.range')
        .max(ROOM_LIMITS.MAX_PLAYERS, 'validation.maxPlayers.range')
        .default(6),
    settings: roomSettingsSchema,
})
    .strict()
    .superRefine((room, ctx) => {
    // "Specific category" is a separate room, not a filter: a category room
    // must name exactly one category, a general room must name none.
    if (room.mode === 'category' && room.settings.categoryIds.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['settings', 'categoryIds'],
            message: 'validation.categories.requiredForCategoryMode',
        });
    }
});
export const addBotSchema = z.object({
    profileId: z.number().int().positive(),
});
export const friendRequestSchema = z.object({
    userId: z.number().int().positive(),
});
export const createTournamentSchema = z
    .object({
    name: z
        .string()
        .trim()
        .min(3, 'validation.tournamentName.tooShort')
        .max(40, 'validation.tournamentName.tooLong'),
    difficulty: difficultySchema.default('medium'),
    cardCount: z.number().int().min(ROOM_LIMITS.MIN_CARDS).max(ROOM_LIMITS.MAX_CARDS).default(10),
    /** Bracket size; must be a power of two so the bracket is complete. */
    size: z.union([z.literal(4), z.literal(8)]).default(4),
})
    .strict();
/** Formats a ZodError into `{ field: messageKey }` for form rendering. */
export function fieldErrors(error) {
    const out = {};
    for (const issue of error.issues) {
        const key = issue.path.join('.') || '_';
        if (!(key in out))
            out[key] = issue.message;
    }
    return out;
}
