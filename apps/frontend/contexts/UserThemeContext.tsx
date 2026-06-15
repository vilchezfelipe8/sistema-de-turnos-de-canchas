import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type UserTheme = 'dark' | 'light';

type UserThemeContextValue = {
  theme: UserTheme;
  isLight: boolean;
  setTheme: (next: UserTheme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = 'pique:user-theme';

const UserThemeContext = createContext<UserThemeContextValue | null>(null);

const sanitizeTheme = (value: unknown): UserTheme => (value === 'dark' ? 'dark' : 'light');

export function UserThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UserTheme>('light');
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedTheme = sanitizeTheme(window.localStorage.getItem(STORAGE_KEY));
      setThemeState(storedTheme);
    } catch {
      setThemeState('light');
    } finally {
      setThemeReady(true);
    }
  }, []);

  useEffect(() => {
    if (!themeReady || typeof window === 'undefined') return;
    const root = document.documentElement;
    root.dataset.userTheme = theme;
    root.dataset.theme = theme;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // noop
    }
  }, [theme, themeReady]);

  const setTheme = useCallback((next: UserTheme) => {
    setThemeState(sanitizeTheme(next));
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo<UserThemeContextValue>(() => ({
    theme,
    isLight: theme === 'light',
    setTheme,
    toggleTheme,
  }), [setTheme, theme, toggleTheme]);

  return <UserThemeContext.Provider value={value}>{children}</UserThemeContext.Provider>;
}

export const useUserTheme = () => {
  const context = useContext(UserThemeContext);
  if (!context) {
    throw new Error('useUserTheme must be used inside UserThemeProvider');
  }
  return context;
};
