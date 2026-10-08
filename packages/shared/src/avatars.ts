import { z } from 'zod';

/* The stock avatars, two for each card suit; one that isn't a person, and one that is, dressed for the suit. A chosen preset is saved in
 'users.avatar_url' as 'preset:<id>' in order to every screen reads one field whether the avatar is an upload or a stock one. */
export const AVATAR_PRESETS = [
  'sports-trophy',
  'sports-player',
  'history-sphinx',
  'history-centurion',
  'science-dna',
  'science-goggles',
  'space-visitor',
  'space-helmet',
  'technology-machine',
  'technology-headset',
  'arts-quill',
  'arts-beret',
  'geography-compass',
  'geography-explorer',
  'culture-mask',
  'culture-singer',
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export const avatarPresetSchema = z.enum(AVATAR_PRESETS);

export const AVATAR_PREFIX = 'preset:';

export function presetToStored(preset: AvatarPreset): string {
  return `${AVATAR_PREFIX}${preset}`;
}

/*  Returns the preset for a stored avatar value, or null for uploads, null, and unknown ids. A non null result is always safe to draw. */
export function presetFromStored(stored: string | null | undefined): AvatarPreset | null {
  if (!stored || !stored.startsWith(AVATAR_PREFIX)) 
    return null;
  const id = stored.slice(AVATAR_PREFIX.length);
  return (AVATAR_PRESETS as readonly string[]).includes(id) ? (id as AvatarPreset) : null;
}
