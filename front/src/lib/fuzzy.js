// Lightweight matching for the command palette: no dependencies, enough for a
// few hundred items. Higher score = better match; null = no match.

export function fuzzyScore(query, text) {
    const q = query.trim().toLowerCase();
    const t = (text || '').toLowerCase();
    if (!q) return 0;
    if (!t) return null;

    const idx = t.indexOf(q);
    if (idx !== -1) {
        // Substring: better the earlier it appears and if it starts a word.
        const atWordStart = idx === 0 || /[\s/_\-.]/.test(t[idx - 1]);
        return 1000 - idx + (atWordStart ? 200 : 0) - (t.length - q.length) * 0.1;
    }

    // Subsequence: all the letters in order, penalizing gaps.
    let ti = 0;
    let gaps = 0;
    for (const ch of q) {
        const found = t.indexOf(ch, ti);
        if (found === -1) return null;
        gaps += found - ti;
        ti = found + 1;
    }
    return 100 - gaps;
}

/** Filters and sorts items by their best score against `getText(item)` (string or list). */
export function fuzzyFilter(items, query, getText = (item) => item) {
    if (!query.trim()) return items;
    return items
        .map((item, order) => {
            const texts = [].concat(getText(item));
            const scores = texts.map(t => fuzzyScore(query, t)).filter(s => s !== null);
            return scores.length ? { item, order, score: Math.max(...scores) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map(entry => entry.item);
}
