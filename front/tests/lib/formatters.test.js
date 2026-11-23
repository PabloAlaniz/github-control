import { describe, it, expect, vi } from 'vitest';
import { formatTimeAgo, formatBytes, getLanguageColor, getActivityStatus, daysSinceLastCommit, isStale } from '@/lib/formatters';

describe('formatters', () => {
    describe('formatTimeAgo', () => {
        it('returns empty string for null date', () => {
            expect(formatTimeAgo(null)).toBe('');
        });

        it('returns "just now" for seconds ago', () => {
            const now = new Date();
            expect(formatTimeAgo(now.toISOString())).toBe('just now');
        });

        it('returns minutes ago', () => {
            const date = new Date(Date.now() - 5 * 60 * 1000);
            expect(formatTimeAgo(date.toISOString())).toBe('5 mins ago');
        });

        it('returns hours ago', () => {
            const date = new Date(Date.now() - 2 * 60 * 60 * 1000);
            expect(formatTimeAgo(date.toISOString())).toBe('2 hours ago');
        });

        it('returns days ago', () => {
            const date = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
            expect(formatTimeAgo(date.toISOString())).toBe('5d ago');
        });

        it('returns months ago', () => {
            const date = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days
            expect(formatTimeAgo(date.toISOString())).toBe('1mo ago');
        });

        it('returns years ago', () => {
            const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // > 1 year
            expect(formatTimeAgo(date.toISOString())).toBe('1y ago');
        });
    });

    describe('formatBytes', () => {
        it('returns 0 Bytes for 0', () => {
            expect(formatBytes(0)).toBe('0 Bytes');
        });

        it('formats KB correctly', () => {
            expect(formatBytes(1024)).toBe('1 KB');
        });

        it('formats MB correctly', () => {
            expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
        });
    });

    describe('getLanguageColor', () => {
        it('returns default color for unknown language', () => {
            expect(getLanguageColor('UnknownLang')).toBe('#6b7280');
        });
    });

    describe('getActivityStatus', () => {
        it('returns abandoned if no date', () => {
            expect(getActivityStatus({})).toBe('abandoned');
        });

        it('returns active for recent push', () => {
            const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
            expect(getActivityStatus({ pushedAt: recent })).toBe('active');
        });

        it('returns inactive for older push', () => {
            const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
            expect(getActivityStatus({ pushedAt: old })).toBe('inactive');
        });
    });

    describe('daysSinceLastCommit', () => {
        it('returns null when no commit data is available', () => {
            expect(daysSinceLastCommit({})).toBeNull();
            expect(daysSinceLastCommit({ lastCommitAt: null })).toBeNull();
        });

        it('returns null on invalid date', () => {
            expect(daysSinceLastCommit({ lastCommitAt: 'not-a-date' })).toBeNull();
        });

        it('returns 0 for a commit today', () => {
            expect(daysSinceLastCommit({ lastCommitAt: new Date().toISOString() })).toBe(0);
        });

        it('uses lastCommitAt when present', () => {
            const date = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
            expect(daysSinceLastCommit({ lastCommitAt: date })).toBe(45);
        });

        it('falls back to pushedAt when lastCommitAt is missing', () => {
            const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
            expect(daysSinceLastCommit({ pushedAt: date })).toBe(10);
        });
    });

    describe('isStale', () => {
        it('returns false when no commit data', () => {
            expect(isStale({})).toBe(false);
        });

        it('returns false when commit is recent', () => {
            const date = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
            expect(isStale({ lastCommitAt: date })).toBe(false);
        });

        it('returns true when commit is older than threshold', () => {
            const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
            expect(isStale({ lastCommitAt: date })).toBe(true);
        });

        it('respects custom threshold', () => {
            const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
            expect(isStale({ lastCommitAt: date }, 7)).toBe(true);
            expect(isStale({ lastCommitAt: date }, 15)).toBe(false);
        });
    });
});
