import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colors, darkColors } from './tokens';
import { store } from '../storage/store';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof colors;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  isDark: false,
  colors: colors,
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const prefs = await store.getPreferences();
        setModeState(prefs.themeMode);
      } catch {
        setModeState('system');
      }
      setLoaded(true);
    })();
  }, []);

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';

  const setMode = async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      const prefs = await store.getPreferences();
      await store.savePreferences({
        ...prefs,
        themeMode: newMode,
      });
    } catch {}
  };

  if (!loaded) return null;

  return (
    <ThemeContext.Provider
      value={{
        mode,
        isDark,
        colors: isDark ? { ...colors, ...darkColors } : colors,
        setMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
