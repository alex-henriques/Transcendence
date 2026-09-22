import { z } from 'zod';
/**
 * Every schema here is imported by the React forms *and* by the Fastify route
 * handlers. The subject requires validation on both sides; sharing one file is
 * how we guarantee the two sides cannot drift apart.
 */
export declare const emailSchema: z.ZodString;
/**
 * Deliberately a length floor plus a character-class floor rather than a regex
 * zoo: long passphrases must stay legal.
 */
export declare const passwordSchema: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
export declare const displayNameSchema: z.ZodString;
export declare const localeSchema: z.ZodEnum<["en", "pt-BR", "fr"]>;
export declare const difficultySchema: z.ZodEnum<["easy", "medium", "hard"]>;
export declare const signupSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    displayName: z.ZodString;
    locale: z.ZodOptional<z.ZodEnum<["en", "pt-BR", "fr"]>>;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
    displayName: string;
    locale?: "en" | "pt-BR" | "fr" | undefined;
}, {
    email: string;
    password: string;
    displayName: string;
    locale?: "en" | "pt-BR" | "fr" | undefined;
}>;
export type SignupInput = z.infer<typeof signupSchema>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type LoginInput = z.infer<typeof loginSchema>;
export declare const updateProfileSchema: z.ZodObject<{
    displayName: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodEnum<["en", "pt-BR", "fr"]>>;
    avatarPreset: z.ZodOptional<z.ZodNullable<z.ZodEnum<["sports-trophy", "sports-player", "history-sphinx", "history-centurion", "science-dna", "science-goggles", "space-visitor", "space-helmet", "technology-machine", "technology-headset", "arts-quill", "arts-beret", "geography-compass", "geography-explorer", "culture-mask", "culture-singer"]>>>;
    onboarded: z.ZodOptional<z.ZodLiteral<true>>;
}, "strip", z.ZodTypeAny, {
    displayName?: string | undefined;
    locale?: "en" | "pt-BR" | "fr" | undefined;
    avatarPreset?: "sports-trophy" | "sports-player" | "history-sphinx" | "history-centurion" | "science-dna" | "science-goggles" | "space-visitor" | "space-helmet" | "technology-machine" | "technology-headset" | "arts-quill" | "arts-beret" | "geography-compass" | "geography-explorer" | "culture-mask" | "culture-singer" | null | undefined;
    onboarded?: true | undefined;
}, {
    displayName?: string | undefined;
    locale?: "en" | "pt-BR" | "fr" | undefined;
    avatarPreset?: "sports-trophy" | "sports-player" | "history-sphinx" | "history-centurion" | "science-dna" | "science-goggles" | "space-visitor" | "space-helmet" | "technology-machine" | "technology-headset" | "arts-quill" | "arts-beret" | "geography-compass" | "geography-explorer" | "culture-mask" | "culture-singer" | null | undefined;
    onboarded?: true | undefined;
}>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
/**
 * Deleting an account (module 15). `confirm` must be the display name typed
 * back, so the request cannot be a stray click, and `password` is required
 * whenever the account has one: erasure is irreversible and re-authenticating
 * is the only thing that proves the person asking is the account holder.
 */
export declare const deleteAccountSchema: z.ZodObject<{
    confirm: z.ZodString;
    password: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    confirm: string;
    password?: string | undefined;
}, {
    confirm: string;
    password?: string | undefined;
}>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export declare const changePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
}, "strip", z.ZodTypeAny, {
    currentPassword: string;
    newPassword: string;
}, {
    currentPassword: string;
    newPassword: string;
}>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export declare const roomCodeSchema: z.ZodString;
export declare const roomSettingsSchema: z.ZodObject<{
    cardCount: z.ZodNumber;
    /** Empty array means "every category" (general mode). */
    categoryIds: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    answerWindowMs: z.ZodNumber;
    comboEnabled: z.ZodDefault<z.ZodBoolean>;
    doubleCardEnabled: z.ZodDefault<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    comboEnabled: boolean;
    cardCount: number;
    categoryIds: number[];
    answerWindowMs: number;
    doubleCardEnabled: boolean;
}, {
    cardCount: number;
    answerWindowMs: number;
    comboEnabled?: boolean | undefined;
    categoryIds?: number[] | undefined;
    doubleCardEnabled?: boolean | undefined;
}>;
export type RoomSettingsInput = z.infer<typeof roomSettingsSchema>;
export declare const createRoomSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    visibility: z.ZodDefault<z.ZodEnum<["public", "private"]>>;
    mode: z.ZodDefault<z.ZodEnum<["general", "category"]>>;
    difficulty: z.ZodDefault<z.ZodEnum<["easy", "medium", "hard"]>>;
    maxPlayers: z.ZodDefault<z.ZodNumber>;
    settings: z.ZodObject<{
        cardCount: z.ZodNumber;
        /** Empty array means "every category" (general mode). */
        categoryIds: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
        answerWindowMs: z.ZodNumber;
        comboEnabled: z.ZodDefault<z.ZodBoolean>;
        doubleCardEnabled: z.ZodDefault<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        comboEnabled: boolean;
        cardCount: number;
        categoryIds: number[];
        answerWindowMs: number;
        doubleCardEnabled: boolean;
    }, {
        cardCount: number;
        answerWindowMs: number;
        comboEnabled?: boolean | undefined;
        categoryIds?: number[] | undefined;
        doubleCardEnabled?: boolean | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    name: string;
    visibility: "public" | "private";
    mode: "general" | "category";
    difficulty: "easy" | "medium" | "hard";
    maxPlayers: number;
    settings: {
        comboEnabled: boolean;
        cardCount: number;
        categoryIds: number[];
        answerWindowMs: number;
        doubleCardEnabled: boolean;
    };
}, {
    name: string;
    settings: {
        cardCount: number;
        answerWindowMs: number;
        comboEnabled?: boolean | undefined;
        categoryIds?: number[] | undefined;
        doubleCardEnabled?: boolean | undefined;
    };
    visibility?: "public" | "private" | undefined;
    mode?: "general" | "category" | undefined;
    difficulty?: "easy" | "medium" | "hard" | undefined;
    maxPlayers?: number | undefined;
}>, {
    name: string;
    visibility: "public" | "private";
    mode: "general" | "category";
    difficulty: "easy" | "medium" | "hard";
    maxPlayers: number;
    settings: {
        comboEnabled: boolean;
        cardCount: number;
        categoryIds: number[];
        answerWindowMs: number;
        doubleCardEnabled: boolean;
    };
}, {
    name: string;
    settings: {
        cardCount: number;
        answerWindowMs: number;
        comboEnabled?: boolean | undefined;
        categoryIds?: number[] | undefined;
        doubleCardEnabled?: boolean | undefined;
    };
    visibility?: "public" | "private" | undefined;
    mode?: "general" | "category" | undefined;
    difficulty?: "easy" | "medium" | "hard" | undefined;
    maxPlayers?: number | undefined;
}>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export declare const addBotSchema: z.ZodObject<{
    profileId: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    profileId: number;
}, {
    profileId: number;
}>;
export declare const friendRequestSchema: z.ZodObject<{
    userId: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    userId: number;
}, {
    userId: number;
}>;
export declare const createTournamentSchema: z.ZodObject<{
    name: z.ZodString;
    difficulty: z.ZodDefault<z.ZodEnum<["easy", "medium", "hard"]>>;
    cardCount: z.ZodDefault<z.ZodNumber>;
    /** Bracket size; must be a power of two so the bracket is complete. */
    size: z.ZodDefault<z.ZodUnion<[z.ZodLiteral<4>, z.ZodLiteral<8>]>>;
}, "strict", z.ZodTypeAny, {
    cardCount: number;
    name: string;
    difficulty: "easy" | "medium" | "hard";
    size: 8 | 4;
}, {
    name: string;
    cardCount?: number | undefined;
    difficulty?: "easy" | "medium" | "hard" | undefined;
    size?: 8 | 4 | undefined;
}>;
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
/** Formats a ZodError into `{ field: messageKey }` for form rendering. */
export declare function fieldErrors(error: z.ZodError): Record<string, string>;
//# sourceMappingURL=validation.d.ts.map