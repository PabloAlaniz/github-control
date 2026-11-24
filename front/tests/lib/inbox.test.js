import { describe, it, expect } from 'vitest';
import {
    DEFAULT_INBOX_FILTERS, availableSections, filterInbox, groupByRepo, inboxViewQuery, isDependencyUpdate, isInboxView,
    isMergeable, isReadyToMerge, parseInboxFilters, resolveSection, sectionCounts, serializeInboxFilters,
} from '@/lib/inbox';

const NOW = new Date('2026-06-01T00:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const item = (extra = {}) => ({
    type: 'pr', repo: 'me/api', number: 1, title: 'Add login', author: 'bob', authorIsBot: false, labels: [], assignees: [],
    requestedReviewers: [], draft: false, comments: 0, updatedAt: daysAgo(1), headSha: 'abc1234', ...extra,
});
const context = { viewer: 'alice', now: NOW };

const items = [
    item({ number: 1, requestedReviewers: ['alice'], labels: [{ name: 'bug' }] }),
    item({ number: 2, author: 'alice', draft: true }),
    item({ number: 3, type: 'issue', assignees: ['alice'], headSha: null, title: 'Crash on start', labels: [{ name: 'bug' }] }),
    item({ number: 4, repo: 'me/web', author: 'dependabot[bot]', authorIsBot: true, title: 'Bump react from 18 to 19' }),
    item({ number: 5, repo: 'me/web', updatedAt: daysAgo(45) }),
    item({ number: 6, type: 'issue', headSha: null, repo: 'me/web', title: 'Docs typo' }),
];
const numbers = (filters) => filterInbox(items, { ...DEFAULT_INBOX_FILTERS, ...filters }, context).map((i) => i.number);

describe('inbox sections', () => {
    it('each section picks its items', () => {
        expect(numbers({ section: 'review' })).toEqual([1]);
        expect(numbers({ section: 'mine' })).toEqual([2]);
        expect(numbers({ section: 'assigned' })).toEqual([3]);
        expect(numbers({ section: 'deps' })).toEqual([4]);
        expect(numbers({ section: 'ready' })).toEqual([]);
        expect(numbers({ section: 'stale' })).toEqual([5]);
        expect(numbers({ section: 'prs' })).toEqual([1, 2, 4, 5]);
        expect(numbers({ section: 'issues' })).toEqual([3, 6]);
        expect(numbers({ section: 'all' })).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('counts every section before the extra filters', () => {
        expect(sectionCounts(items, context)).toEqual({ review: 1, mine: 1, assigned: 1, ready: 0, deps: 1, stale: 1, prs: 4, issues: 2, all: 6 });
    });

    it('hides the "my" sections when the viewer is unknown', () => {
        expect(availableSections(null).map((s) => s.id)).toEqual(['ready', 'deps', 'stale', 'prs', 'issues', 'all']);
        expect(availableSections('alice')).toHaveLength(9);
        expect(resolveSection('review', null)).toBe('prs');
        expect(resolveSection('review', 'alice')).toBe('review');
        expect(resolveSection('deps', null)).toBe('deps');
        expect(resolveSection('nope', 'alice')).toBe('review');
    });

    it('recognizes dependency updaters by author, or by label when a bot opened it', () => {
        expect(isDependencyUpdate(item({ author: 'dependabot[bot]', authorIsBot: true }))).toBe(true);
        expect(isDependencyUpdate(item({ author: 'renovate[bot]', authorIsBot: true }))).toBe(true);
        expect(isDependencyUpdate(item({ author: 'my-bot[bot]', authorIsBot: true, labels: [{ name: 'Dependencies' }] }))).toBe(true);
        expect(isDependencyUpdate(item({ author: 'bob', labels: [{ name: 'dependencies' }] }))).toBe(false);
        expect(isDependencyUpdate(item({ type: 'issue', author: 'dependabot[bot]', authorIsBot: true }))).toBe(false);
    });
});

describe('inbox filters', () => {
    it('narrow a section by repo, label, drafts and search words', () => {
        expect(numbers({ section: 'all', repo: 'me/web' })).toEqual([4, 5, 6]);
        expect(numbers({ section: 'all', label: 'bug' })).toEqual([1, 3]);
        expect(numbers({ section: 'prs', hideDrafts: true })).toEqual([1, 4, 5]);
        expect(numbers({ section: 'all', search: 'BUMP react' })).toEqual([4]);
        expect(numbers({ section: 'all', search: 'me/web #6' })).toEqual([6]);
        expect(numbers({ section: 'all', search: 'dependabot' })).toEqual([4]);
        expect(numbers({ section: 'all', search: 'nothing like this' })).toEqual([]);
    });

    it('round-trip through the URL, writing only what differs from the default', () => {
        expect(serializeInboxFilters(DEFAULT_INBOX_FILTERS)).toBe('');
        const filters = { section: 'deps', search: 'bump react', repo: 'me/web', label: 'bug', hideDrafts: true };
        const query = serializeInboxFilters(filters);
        expect(query).toBe('section=deps&q=bump+react&repo=me%2Fweb&label=bug&drafts=0');
        expect(parseInboxFilters(`?${query}`)).toEqual(filters);
    });

    it('ignore unknown values', () => {
        expect(parseInboxFilters('section=nope&inbox=1&other=x')).toEqual(DEFAULT_INBOX_FILTERS);
    });

    it('are stored as a view marked for the inbox', () => {
        expect(inboxViewQuery(DEFAULT_INBOX_FILTERS)).toBe('inbox=1');
        const query = inboxViewQuery({ ...DEFAULT_INBOX_FILTERS, section: 'assigned', label: 'bug' });
        expect(query).toBe('inbox=1&section=assigned&label=bug');
        expect(parseInboxFilters(query)).toMatchObject({ section: 'assigned', label: 'bug' });
        expect(isInboxView({ query })).toBe(true);
        expect(isInboxView({ query: 'health=needs-ci' })).toBe(false);
        expect(isInboxView({ query: 'q=inbox%3D1' })).toBe(false);
        expect(isInboxView({})).toBe(false);
    });
});

describe('ready to merge', () => {
    it('needs green checks and no review in the way', () => {
        expect(isReadyToMerge(item({ checks: 'success', review: 'approved' }))).toBe(true);
        expect(isReadyToMerge(item({ checks: 'success', review: null }))).toBe(true);
        expect(isReadyToMerge(item({ checks: 'success', review: 'review_required' }))).toBe(false);
        expect(isReadyToMerge(item({ checks: 'success', review: 'changes_requested' }))).toBe(false);
        expect(isReadyToMerge(item({ checks: 'pending', review: 'approved' }))).toBe(false);
        expect(isReadyToMerge(item({ checks: 'failure' }))).toBe(false);
        expect(isReadyToMerge(item({ checks: null }))).toBe(false);
        expect(isReadyToMerge(item({ checks: 'success', draft: true }))).toBe(false);
        expect(isReadyToMerge(item({ type: 'issue', checks: 'success' }))).toBe(false);
    });
});

describe('inbox helpers', () => {
    it('groups by repo in order of appearance', () => {
        expect(groupByRepo(items).map(([repo, rows]) => [repo, rows.length])).toEqual([['me/api', 3], ['me/web', 3]]);
    });

    it('only offers to merge pull requests that are ready and whose commit is known', () => {
        expect(isMergeable(item())).toBe(true);
        expect(isMergeable(item({ draft: true }))).toBe(false);
        expect(isMergeable(item({ headSha: null }))).toBe(false);
        expect(isMergeable(item({ type: 'issue' }))).toBe(false);
    });
});
