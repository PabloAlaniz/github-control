import { useEffect, useRef } from 'react';

const isEditable = (el) =>
    !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

/** Normalized combo for an event: "mod+k", "shift+?", "j", "escape"... */
export function comboFromEvent(e) {
    const key = (e.key || '').toLowerCase();
    return `${e.metaKey || e.ctrlKey ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${key}`;
}

/**
 * Global shortcuts. `bindings` is { combo: handler }. Single keys are ignored
 * while typing in a field; combos with mod (Cmd/Ctrl) always work.
 */
export function useHotkeys(bindings, { enabled = true } = {}) {
    const ref = useRef(bindings);
    ref.current = bindings;

    useEffect(() => {
        if (!enabled) return undefined;
        function onKeyDown(e) {
            const combo = comboFromEvent(e);
            const handler = ref.current[combo];
            if (!handler) return;
            if (!combo.startsWith('mod+') && isEditable(e.target)) return;
            e.preventDefault();
            handler(e);
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled]);
}
