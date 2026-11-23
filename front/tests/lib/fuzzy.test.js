import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilter } from '@/lib/fuzzy';

describe('fuzzy', () => {
    it('scores an empty query as a neutral match', () => {
        expect(fuzzyScore('', 'anything')).toBe(0);
    });

    it('returns null when letters are missing or text is empty', () => {
        expect(fuzzyScore('xyz', 'github-control')).toBeNull();
        expect(fuzzyScore('a', '')).toBeNull();
    });

    it('ranks substring over subsequence, and word starts over mid-word', () => {
        expect(fuzzyScore('control', 'github-control')).toBeGreaterThan(fuzzyScore('gctl', 'github-control'));
        expect(fuzzyScore('con', 'me/control')).toBeGreaterThan(fuzzyScore('con', 'me/falcon'));
    });

    it('is case-insensitive', () => {
        expect(fuzzyScore('API', 'my-api')).not.toBeNull();
    });

    it('returns all items untouched for a blank query', () => {
        const items = ['b', 'a'];
        expect(fuzzyFilter(items, '  ')).toBe(items);
    });

    it('filters and sorts by best score across several texts', () => {
        const items = [
            { label: 'me/website', keywords: ['landing'] },
            { label: 'me/api', keywords: ['backend web'] },
            { label: 'me/cli', keywords: [] },
        ];
        const out = fuzzyFilter(items, 'web', i => [i.label, ...i.keywords]);
        expect(out.map(i => i.label)).toEqual(['me/website', 'me/api']);
    });

    it('keeps the original order on ties', () => {
        expect(fuzzyFilter(['ab-1', 'ab-2'], 'ab')).toEqual(['ab-1', 'ab-2']);
    });
});
