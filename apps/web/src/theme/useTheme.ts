/**
 * Theme primitives: what the choices are, how one is applied, where it is kept.
 *
 * The React state that holds the current choice lives in ThemeContext, so that
 * every control which can change the theme is changing the same value. This
 * file is deliberately free of React, because `applyTheme` also runs from the
 * inline boot script before React exists.
 */

/**
 * Three states, not two: `system` is the default and follows the operating
 * system, and the two explicit choices override it. The attribute on <html> is
 * what the stylesheet keys off, and it is only set for an explicit choice, so
 * `system` keeps working through the media query.
 */
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'wkb.theme';

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // A browser with site data blocked still gets a working theme.
    return 'system';
  }
}

export function storeTheme(theme: Theme): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  // The address bar in mobile browsers is painted from this, so it has to
  // follow the room rather than stay the colour the light theme started on.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#16131c' : '#ece5d3');
  }
}
