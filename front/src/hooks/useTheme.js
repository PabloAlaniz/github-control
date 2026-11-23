import { useSyncExternalStore } from 'react';
import { getTheme, nextTheme, setTheme, subscribeTheme } from '../lib/theme';

/** The chosen theme ('system' | 'light' | 'dark') and a function that moves to the next one. */
export function useTheme() {
    const theme = useSyncExternalStore(subscribeTheme, getTheme);
    return { theme, cycle: () => setTheme(nextTheme(theme)), set: setTheme };
}
