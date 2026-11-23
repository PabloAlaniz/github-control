import { describe, it, expect } from 'vitest';
import { signalChips, matchesSignalFilter, signalsCheckedAt, daysSince, formatDuration } from '@/lib/signals';

const repoWith = (signals) => ({ signals });

describe('signals lib', () => {
    describe('signalChips', () => {
        it('returns no chips without signals', () => {
            expect(signalChips({})).toEqual([]);
            expect(signalChips(undefined)).toEqual([]);
            expect(signalChips(repoWith({ standards: { passed: 0, total: 0 } }))).toEqual([]);
        });

        it('colors the standards chip by pass ratio', () => {
            const tone = (passed, total) => signalChips(repoWith({ standards: { passed, total } }))[0].tone;
            expect(tone(4, 4)).toBe('ok');
            expect(tone(2, 4)).toBe('warn');
            expect(tone(1, 4)).toBe('bad');
            expect(signalChips(repoWith({ standards: { passed: 3, total: 7 } }))[0].label).toBe('Std 3/7');
        });
    });

    describe('matchesSignalFilter', () => {
        it('returns null for filters that are not signal-based', () => {
            expect(matchesSignalFilter({}, 'needs-ci')).toBeNull();
        });

        it('needs-standards matches unsynced and incomplete repos', () => {
            expect(matchesSignalFilter({}, 'needs-standards')).toBe(true);
            expect(matchesSignalFilter(repoWith({ standards: { passed: 0, total: 0 } }), 'needs-standards')).toBe(true);
            expect(matchesSignalFilter(repoWith({ standards: { passed: 3, total: 4 } }), 'needs-standards')).toBe(true);
            expect(matchesSignalFilter(repoWith({ standards: { passed: 4, total: 4 } }), 'needs-standards')).toBe(false);
        });
    });

    describe('signalsCheckedAt', () => {
        it('returns the oldest check date, or null', () => {
            expect(signalsCheckedAt({})).toBeNull();
            expect(signalsCheckedAt(repoWith({
                a: { checked_at: '2026-11-20T00:00:00Z' },
                b: { checked_at: '2026-11-01T00:00:00Z' },
                c: {},
            }))).toBe('2026-11-01T00:00:00Z');
        });
    });

    describe('runtime end of life', () => {
        const deps = (eolDate) => repoWith({ dependencies: { runtimes: [{ name: 'node', release: '18', eolDate, source: '.nvmrc' }] } });

        it('adds a chip only for runtimes past their end of life', () => {
            expect(signalChips(deps('2020-01-01'))[0]).toMatchObject({ key: 'eol-node', label: 'EOL node 18', tone: 'bad' });
            expect(signalChips(deps('2999-01-01'))).toEqual([]);
            expect(signalChips(deps(null))).toEqual([]);
        });

        it('filters repos with an EOL runtime', () => {
            expect(matchesSignalFilter(deps('2020-01-01'), 'eol-runtime')).toBe(true);
            expect(matchesSignalFilter(deps('2999-01-01'), 'eol-runtime')).toBe(false);
            expect(matchesSignalFilter({}, 'eol-runtime')).toBe(false);
        });
    });

    describe('security', () => {
        const sec = (bySeverity, available = true) => repoWith({ security: {
            available, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, ...bySeverity },
            total: Object.values(bySeverity).reduce((a, b) => a + b, 0),
        } });

        it('shows no chip when alerts are not available', () => {
            expect(signalChips(sec({}, false))).toEqual([]);
        });

        it('shows a green chip for a clean repo', () => {
            expect(signalChips(sec({}))[0]).toMatchObject({ label: 'Sec ✓', tone: 'ok' });
        });

        it('shows the worst severity with its count', () => {
            expect(signalChips(sec({ critical: 2, low: 5 }))[0]).toMatchObject({ label: '2 critical', tone: 'bad' });
            expect(signalChips(sec({ high: 1 }))[0].tone).toBe('bad');
            const medium = signalChips(sec({ medium: 3, low: 1 }))[0];
            expect(medium).toMatchObject({ label: '3 medium', tone: 'warn' });
            expect(medium.title).toBe('4 open security alerts (3 medium, 1 low)');
        });

        it('filters repos with critical or high alerts', () => {
            expect(matchesSignalFilter(sec({ critical: 1 }), 'security-alerts')).toBe(true);
            expect(matchesSignalFilter(sec({ high: 1 }), 'security-alerts')).toBe(true);
            expect(matchesSignalFilter(sec({ medium: 9 }), 'security-alerts')).toBe(false);
            expect(matchesSignalFilter({}, 'security-alerts')).toBe(false);
        });
    });

    describe('release', () => {
        const rel = (unreleasedCommits, hasRelease = true) => repoWith({ release: { hasRelease, tag: 'v1.0.0', unreleasedCommits } });

        it('shows unreleased commits, warning past the threshold', () => {
            expect(signalChips(rel(3))[0]).toMatchObject({ label: '3 unreleased', tone: 'neutral' });
            expect(signalChips(rel(20))[0].tone).toBe('warn');
            expect(signalChips(rel(0))).toEqual([]);
            expect(signalChips(rel(null))).toEqual([]);
            expect(signalChips(rel(5, false))).toEqual([]);
        });

        it('filters repos with unreleased commits', () => {
            expect(matchesSignalFilter(rel(1), 'unreleased')).toBe(true);
            expect(matchesSignalFilter(rel(0), 'unreleased')).toBe(false);
            expect(matchesSignalFilter(rel(4, false), 'unreleased')).toBe(false);
            expect(matchesSignalFilter({}, 'unreleased')).toBe(false);
        });
    });

    describe('daysSince', () => {
        const now = new Date('2026-11-23T12:00:00Z').getTime();
        it('counts whole days and tolerates bad input', () => {
            expect(daysSince('2026-11-20T00:00:00Z', now)).toBe(3);
            expect(daysSince('2026-11-23T11:00:00Z', now)).toBe(0);
            expect(daysSince('2027-01-01T00:00:00Z', now)).toBe(0);
            expect(daysSince(null)).toBeNull();
            expect(daysSince('nope')).toBeNull();
        });
    });

    describe('branches', () => {
        const br = (data) => repoWith({ branches: { merged: 0, stale: 0, stalePrCount: 0, ...data } });

        it('shows how many branches can be cleaned up', () => {
            expect(signalChips(br({}))).toEqual([]);
            expect(signalChips(br({ merged: 2, stale: 1 }))[0]).toMatchObject({
                label: '3 branches', tone: 'neutral', title: 'Branches to clean up: 2 merged, 1 stale',
            });
            expect(signalChips(br({ merged: 5 }))[0].tone).toBe('warn');
            expect(signalChips(br({ stale: 1 }))[0].title).toBe('Branches to clean up: 1 stale');
        });

        it('shows stale pull requests', () => {
            expect(signalChips(br({ stalePrCount: 1 }))[0].label).toBe('1 stale PR');
            expect(signalChips(br({ stalePrCount: 3 }))[0].label).toBe('3 stale PRs');
        });

        it('filters repos needing branch cleanup', () => {
            expect(matchesSignalFilter(br({ merged: 1 }), 'branch-cleanup')).toBe(true);
            expect(matchesSignalFilter(br({ stale: 1 }), 'branch-cleanup')).toBe(true);
            expect(matchesSignalFilter(br({ stalePrCount: 1 }), 'branch-cleanup')).toBe(true);
            expect(matchesSignalFilter(br({}), 'branch-cleanup')).toBe(false);
            expect(matchesSignalFilter({}, 'branch-cleanup')).toBe(false);
        });
    });

    describe('ci', () => {
        const ci = (data) => repoWith({ ci: { available: true, counted: 20, successRate: 95, flaky: 0, ...data } });

        it('shows the success rate once there are enough runs', () => {
            expect(signalChips(ci({}))[0]).toMatchObject({ label: 'CI 95%', tone: 'ok' });
            expect(signalChips(ci({ successRate: 75 }))[0].tone).toBe('warn');
            expect(signalChips(ci({ successRate: 40 }))[0].tone).toBe('bad');
            expect(signalChips(ci({ counted: 3 }))).toEqual([]);
            expect(signalChips(ci({ successRate: null }))).toEqual([]);
            expect(signalChips(ci({ available: false }))).toEqual([]);
        });

        it('shows flaky commits', () => {
            expect(signalChips(ci({ flaky: 2 })).map(c => c.label)).toEqual(['CI 95%', '2 flaky']);
        });

        it('filters repos with unreliable CI', () => {
            expect(matchesSignalFilter(ci({}), 'ci-unreliable')).toBe(false);
            expect(matchesSignalFilter(ci({ successRate: 79 }), 'ci-unreliable')).toBe(true);
            expect(matchesSignalFilter(ci({ flaky: 1 }), 'ci-unreliable')).toBe(true);
            expect(matchesSignalFilter(ci({ successRate: 10, counted: 2 }), 'ci-unreliable')).toBe(false);
            expect(matchesSignalFilter(ci({ available: false, flaky: 3 }), 'ci-unreliable')).toBe(false);
            expect(matchesSignalFilter({}, 'ci-unreliable')).toBe(false);
        });
    });

    describe('formatDuration', () => {
        it('formats seconds, minutes and hours', () => {
            expect(formatDuration(null)).toBe('-');
            expect(formatDuration(undefined)).toBe('-');
            expect(formatDuration(42)).toBe('42s');
            expect(formatDuration(95)).toBe('1m 35s');
            expect(formatDuration(3725)).toBe('1h 2m');
        });
    });

    describe('config drift', () => {
        const cfg = (drift, applicable = true) => repoWith({ config: { applicable, drift } });

        it('shows a chip only when settings differ from the baseline', () => {
            expect(signalChips(cfg(2))[0]).toMatchObject({ key: 'config', label: '2 drift', tone: 'warn' });
            expect(signalChips(cfg(0))).toEqual([]);
            expect(signalChips(cfg(3, false))).toEqual([]);
        });

        it('filters repos with drift', () => {
            expect(matchesSignalFilter(cfg(1), 'config-drift')).toBe(true);
            expect(matchesSignalFilter(cfg(0), 'config-drift')).toBe(false);
            expect(matchesSignalFilter(cfg(2, false), 'config-drift')).toBe(false);
            expect(matchesSignalFilter({}, 'config-drift')).toBe(false);
        });
    });
});
