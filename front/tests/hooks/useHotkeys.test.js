import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHotkeys, comboFromEvent } from '@/hooks/useHotkeys';

const press = (init, target = window) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
};

describe('useHotkeys', () => {
    it('normalizes combos', () => {
        expect(comboFromEvent({ key: 'K', metaKey: true })).toBe('mod+k');
        expect(comboFromEvent({ key: 'k', ctrlKey: true })).toBe('mod+k');
        expect(comboFromEvent({ key: 'j' })).toBe('j');
        expect(comboFromEvent({ key: 'Escape' })).toBe('escape');
        expect(comboFromEvent({ key: 'x', altKey: true })).toBe('alt+x');
    });

    it('runs the handler and prevents the default action', () => {
        const j = vi.fn();
        renderHook(() => useHotkeys({ j }));

        const event = press({ key: 'j' });

        expect(j).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('ignores plain keys while typing, but not mod combos', () => {
        const j = vi.fn();
        const palette = vi.fn();
        renderHook(() => useHotkeys({ j, 'mod+k': palette }));
        const input = document.createElement('input');
        document.body.appendChild(input);

        press({ key: 'j' }, input);
        press({ key: 'k', metaKey: true }, input);

        expect(j).not.toHaveBeenCalled();
        expect(palette).toHaveBeenCalledTimes(1);
        input.remove();
    });

    it('ignores unbound keys and plain keys held with a modifier', () => {
        const j = vi.fn();
        renderHook(() => useHotkeys({ j }));

        press({ key: 'q' });
        press({ key: 'j', ctrlKey: true });

        expect(j).not.toHaveBeenCalled();
    });

    it('always calls the latest handler', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(({ fn }) => useHotkeys({ j: fn }), { initialProps: { fn: first } });

        rerender({ fn: second });
        press({ key: 'j' });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalled();
    });

    it('does nothing when disabled and cleans up on unmount', () => {
        const j = vi.fn();
        renderHook(() => useHotkeys({ j }, { enabled: false }));
        press({ key: 'j' });
        expect(j).not.toHaveBeenCalled();

        const k = vi.fn();
        const { unmount } = renderHook(() => useHotkeys({ k }));
        unmount();
        press({ key: 'k' });
        expect(k).not.toHaveBeenCalled();
    });
});
