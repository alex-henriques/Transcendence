import type { Locale } from '@wkb/shared';

/**
 * A one-line pub/sub for language changes.
 *
 * The language switcher lives in the header and the room socket lives in the
 * room page; neither is an ancestor of the other. Rather than thread a context
 * through the whole tree for a single event, anything that needs to react to a
 * language change subscribes here.
 */
type Listener = (locale: Locale) => void;

const listeners = new Set<Listener>();

export function onLocaleChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLocaleChange(locale: Locale): void {
  for (const listener of listeners) listener(locale);
}
