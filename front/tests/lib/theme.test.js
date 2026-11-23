import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTheme, getTheme, nextTheme, resolveTheme, setTheme, subscribeTheme } from '@/lib/theme';

function systemPrefers(dark) {
    window.matchMedia = vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn() });
}

describe('theme', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.documentElement.dataset.theme;
        systemPrefers(false);
    });

    it('follows the system until a theme is chosen', () => {
        expect(getTheme()).toBe('system');
        expect(resolveTheme()).toBe('light');
        systemPrefers(true);
        expect(resolveTheme()).toBe('dark');
    });

    it('applies the chosen theme to the document and remembers it', () => {
        setTheme('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(getTheme()).toBe('dark');
    });

    it('a chosen theme wins over the system', () => {
        systemPrefers(true);
        setTheme('light');
        expect(resolveTheme()).toBe('light');
    });

    it('going back to system forgets the choice', () => {
        setTheme('dark');
        systemPrefers(true);
        setTheme('system');
        expect(localStorage.getItem('theme')).toBeNull();
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('ignores a stored value it does not know', () => {
        localStorage.setItem('theme', 'sepia');
        expect(getTheme()).toBe('system');
        applyTheme();
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('cycles system, light, dark', () => {
        expect(nextTheme('system')).toBe('light');
        expect(nextTheme('light')).toBe('dark');
        expect(nextTheme('dark')).toBe('system');
    });

    it('tells subscribers about a change until they unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeTheme(listener);
        setTheme('dark');
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        setTheme('light');
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
