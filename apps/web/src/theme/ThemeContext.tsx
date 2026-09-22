import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { applyTheme, readTheme, storeTheme, type Theme } from './useTheme.js';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The chosen theme, held in one place.
 *
 * It used to be a plain hook, which was fine while the header switcher was the
 * only thing that could change it. The first-run setup screen also sets it, and
 * two copies of the same `useState` would have disagreed the moment either one
 * moved: the switcher in the header would still have been showing "system"
 * while the setup screen showed "dark".
 *
 * The choice stays on the device rather than on the account. Which theme suits
 * a room is a fact about the screen you are sitting at, not about who you are,
 * and a laptop in a bright kitchen and a phone in bed deserve different
 * answers from the same account.
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setStored] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  // Following the system means following it when it changes, not only at boot.
  useEffect(() => {
    if (theme !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme('system');
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme: (next: Theme) => setStored(next) }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

export type { Theme };
