// The inbox: sections (ready-made filters), the extra filters on top, and
// their representation in the URL so a combination can be shared or saved.

const DAY_MS = 86_400_000;
export const STALE_PR_DAYS = 30;

/** Marks a saved view as belonging to the inbox rather than the dashboard. */
export const INBOX_VIEW_PREFIX = 'inbox=1';
export const isInboxView = (view) => (view?.query ?? '').split('&').includes(INBOX_VIEW_PREFIX);

const DEPENDENCY_BOT = /^(dependabot|renovate)(\[bot\])?$/i;

/** A pull request opened by a dependency updater. */
export function isDependencyUpdate(item) {
    return item.type === 'pr' && (DEPENDENCY_BOT.test(item.author ?? '')
        || (item.authorIsBot && item.labels.some((label) => label.name.toLowerCase() === 'dependencies')));
}

const daysSince = (iso, now) => Math.floor((now - new Date(iso).getTime()) / DAY_MS);

/** A pull request with green checks and no review standing in its way. */
export function isReadyToMerge(item) {
    return item.type === 'pr' && !item.draft && item.checks === 'success'
        && item.review !== 'changes_requested' && item.review !== 'review_required';
}

/**
 * Sections, in the order they are listed. `needsViewer` ones only make sense
 * when the server knows who "me" is.
 */
export const SECTIONS = [
    { id: 'review', label: 'Needs my review', needsViewer: true, match: (item, { viewer }) => item.type === 'pr' && item.requestedReviewers.includes(viewer) },
    { id: 'mine', label: 'My pull requests', needsViewer: true, match: (item, { viewer }) => item.type === 'pr' && item.author === viewer },
    { id: 'assigned', label: 'Assigned to me', needsViewer: true, match: (item, { viewer }) => item.assignees.includes(viewer) },
    { id: 'ready', label: 'Ready to merge', match: (item) => isReadyToMerge(item) },
    { id: 'deps', label: 'Dependency updates', match: (item) => isDependencyUpdate(item) },
    { id: 'stale', label: 'Stale pull requests', match: (item, { now }) => item.type === 'pr' && daysSince(item.updatedAt, now) >= STALE_PR_DAYS },
    { id: 'prs', label: 'All pull requests', match: (item) => item.type === 'pr' },
    { id: 'issues', label: 'All issues', match: (item) => item.type === 'issue' },
    { id: 'all', label: 'Everything', match: () => true },
];

const SECTION_IDS = SECTIONS.map((section) => section.id);
export const sectionById = (id) => SECTIONS.find((section) => section.id === id) ?? SECTIONS[SECTIONS.length - 1];

export const DEFAULT_INBOX_FILTERS = { section: 'review', search: '', repo: 'all', label: 'all', hideDrafts: false };

/** Sections offered for this viewer, and the one to fall back to. */
export function availableSections(viewer) {
    return SECTIONS.filter((section) => viewer || !section.needsViewer);
}

export function resolveSection(id, viewer) {
    const sections = availableSections(viewer);
    return sections.some((section) => section.id === id) ? id : (viewer ? 'review' : 'prs');
}

/** Filters -> query string (without "?"). Only what differs from the default is written. */
export function serializeInboxFilters(filters) {
    const params = new URLSearchParams();
    if (filters.section !== DEFAULT_INBOX_FILTERS.section) params.set('section', filters.section);
    if (filters.search) params.set('q', filters.search);
    if (filters.repo !== 'all') params.set('repo', filters.repo);
    if (filters.label !== 'all') params.set('label', filters.label);
    if (filters.hideDrafts) params.set('drafts', '0');
    return params.toString();
}

/** Query string -> filters. Unknown values fall back to the default; `inbox=1` is ignored. */
export function parseInboxFilters(search = '') {
    const params = new URLSearchParams(search);
    const section = params.get('section');
    return {
        section: SECTION_IDS.includes(section) ? section : DEFAULT_INBOX_FILTERS.section,
        search: params.get('q') ?? '',
        repo: params.get('repo') || 'all',
        label: params.get('label') || 'all',
        hideDrafts: params.get('drafts') === '0',
    };
}

/** The query a saved view of these filters is stored with. */
export const inboxViewQuery = (filters) => [INBOX_VIEW_PREFIX, serializeInboxFilters(filters)].filter(Boolean).join('&');

/** Items of the section that also pass the extra filters, keeping their order. */
export function filterInbox(items, filters, context) {
    const section = sectionById(filters.section);
    const words = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((item) => {
        if (!section.match(item, context)) return false;
        if (filters.repo !== 'all' && item.repo !== filters.repo) return false;
        if (filters.label !== 'all' && !item.labels.some((label) => label.name === filters.label)) return false;
        if (filters.hideDrafts && item.draft) return false;
        if (words.length === 0) return true;
        const text = `${item.title} ${item.repo} #${item.number} ${item.author ?? ''}`.toLowerCase();
        return words.every((word) => text.includes(word));
    });
}

/** How many items each section holds, before the extra filters. */
export function sectionCounts(items, context) {
    return Object.fromEntries(SECTIONS.map((section) => [section.id, items.filter((item) => section.match(item, context)).length]));
}

/** `[[repo, items], ...]` keeping the order in which repos first appear. */
export function groupByRepo(items) {
    const groups = new Map();
    for (const item of items) {
        if (!groups.has(item.repo)) groups.set(item.repo, []);
        groups.get(item.repo).push(item);
    }
    return [...groups.entries()];
}

export const itemKey = (item) => `${item.repo}#${item.number}`;
/** Only pull requests whose head commit is known can be merged from here. */
export const isMergeable = (item) => item.type === 'pr' && !!item.headSha && !item.draft;

export const MERGE_SKIP_REASONS = {
    closed: 'already closed or merged',
    draft: 'still a draft',
    moved: 'new commits since it was listed; refresh and look again',
    checks_failing: 'checks are failing',
    checks_pending: 'checks are still running',
    not_mergeable: 'GitHub refused the merge',
    gone: 'no longer exists',
    error: 'failed',
};
