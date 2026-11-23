// Shared helpers for the group filter with tri-state include/exclude.
// The special value 'ungrouped' represents items with no group assigned.

export const EMPTY_GROUP_FILTER = { include: [], exclude: [] };

// Cycles a group's state: neutral -> include -> exclude -> neutral.
export function cycleGroups({ include, exclude }, value) {
    const inc = new Set(include);
    const exc = new Set(exclude);
    if (inc.has(value)) {
        inc.delete(value);
        exc.add(value);
    } else if (exc.has(value)) {
        exc.delete(value);
    } else {
        inc.add(value);
    }
    return { include: [...inc], exclude: [...exc] };
}

// Current state of a group within the filter: 'include' | 'exclude' | 'neutral'.
export function groupState({ include, exclude }, value) {
    if (include.includes(value)) return 'include';
    if (exclude.includes(value)) return 'exclude';
    return 'neutral';
}

// Does an item with these slugs pass the group filter?
// exclude takes priority; include works as OR.
export function matchesGroupFilter({ include, exclude }, slugs) {
    const list = slugs || [];
    const matches = (val) => (val === 'ungrouped' ? list.length === 0 : list.includes(val));
    if (exclude.some(matches)) return false;
    if (include.length > 0 && !include.some(matches)) return false;
    return true;
}
