import { z } from 'zod';
/**
 * The stock avatars, two per card suit.
 *
 * The pairing is deliberate: one that is not a person, and one who is a person
 * dressed for that suit. Somebody who wants a face has one in every category,
 * and somebody who would rather be a dinosaur's DNA strand has that too.
 *
 * A chosen preset is stored in `users.avatar_url` as `preset:<id>` rather than
 * in a column of its own. That field already answers exactly one question,
 * "how is this person drawn", and an uploaded file and a stock avatar are two
 * answers to it. Every screen that renders an avatar reads that one field, so
 * none of them had to learn a second way to ask.
 */
export declare const AVATAR_PRESETS: readonly ["sports-trophy", "sports-player", "history-sphinx", "history-centurion", "science-dna", "science-goggles", "space-visitor", "space-helmet", "technology-machine", "technology-headset", "arts-quill", "arts-beret", "geography-compass", "geography-explorer", "culture-mask", "culture-singer"];
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export declare const avatarPresetSchema: z.ZodEnum<["sports-trophy", "sports-player", "history-sphinx", "history-centurion", "science-dna", "science-goggles", "space-visitor", "space-helmet", "technology-machine", "technology-headset", "arts-quill", "arts-beret", "geography-compass", "geography-explorer", "culture-mask", "culture-singer"]>;
export declare const AVATAR_PREFIX = "preset:";
/** The value stored in `avatar_url` for a chosen preset. */
export declare function presetToStored(preset: AvatarPreset): string;
/**
 * Reads a preset back out of a stored avatar value.
 *
 * Returns null for an uploaded file, for null, and for anything that claims to
 * be a preset but is not one we ship. That last case is what stops a stale or
 * tampered value from reaching a renderer, so callers can treat a non-null
 * result as a key they can draw.
 */
export declare function presetFromStored(stored: string | null | undefined): AvatarPreset | null;
//# sourceMappingURL=avatars.d.ts.map