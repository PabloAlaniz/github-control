/**
 * Demo instances (the server runs with DEMO set): what the server said about
 * itself, plus a notice each time it refuses an action the demo cannot do.
 */
let demo = null;                 // { readOnly, resetMinutes } | null
let blocked = 0;                 // counts refused actions, so each one can be announced
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());

export function setDemo(info) {
    demo = info || null;
    emit();
}

export const getDemo = () => demo;
export const getDemoBlocked = () => blocked;

/** Called by the API client when the server answers "not available in the demo". */
export function notifyDemoBlocked() {
    blocked += 1;
    emit();
}

export function subscribeDemo(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
