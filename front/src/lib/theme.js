/**
 * Color theme: 'light', 'dark' or 'system' (follow the OS). The choice is kept
 * in localStorage and applied as <html data-theme>; styles/dark.css does the rest.
 * index.html applies it once before the first paint, with the same rule.
 */
const STORAGE_KEY = 'theme';
export const THEMES = ['system', 'light', 'dark'];

const listeners = new Set();

function systemPrefersDark() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getTheme() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return THEMES.includes(stored) ? stored : 'system';
    } catch {
        return 'system';
    }
}

/** The theme actually shown: 'light' or 'dark'. */
export function resolveTheme(theme = getTheme()) {
    if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
    return theme;
}

export function applyTheme(theme = getTheme()) {
    document.documentElement.dataset.theme = resolveTheme(theme);
}

export function setTheme(theme) {
    try {
        if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // Private mode: the choice lasts for this page only.
    }
    applyTheme(theme);
    listeners.forEach((listener) => listener());
}

/** system -> light -> dark -> system */
export function nextTheme(theme = getTheme()) {
    return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

export function subscribeTheme(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Follows the OS while the choice is 'system'. Call once at startup. */
export function watchSystemTheme() {
    applyTheme();
    if (typeof window.matchMedia !== 'function') return;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (getTheme() === 'system') {
            applyTheme();
            listeners.forEach((listener) => listener());
        }
    });
}
