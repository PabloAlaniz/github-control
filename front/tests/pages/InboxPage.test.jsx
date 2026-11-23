import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { InboxPage } from '@/pages/InboxPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const recent = new Date(Date.now() - 3_600_000).toISOString();
const item = (number, extra = {}) => ({
    type: 'pr', repo: 'me/api', number, title: `PR ${number}`, url: `https://github.com/me/api/pull/${number}`,
    author: 'bob', authorIsBot: false, labels: [], assignees: [], requestedReviewers: [], draft: false, comments: 0,
    createdAt: recent, updatedAt: recent, headRef: `b${number}`, headSha: `${number}`.repeat(7), groups: [], priority: null, ...extra,
});
const bump = (number, repo, pkg) => item(number, {
    repo, title: `Bump ${pkg}`, author: 'dependabot[bot]', authorIsBot: true, labels: [{ name: 'dependencies', color: '0366d6' }],
});
const inbox = {
    viewer: 'alice', reposSynced: 2, reposTotal: 2, oldestCheck: recent, truncated: [],
    items: [
        item(1, { title: 'New cart flow', requestedReviewers: ['alice'], labels: [{ name: 'feature', color: 'a2eeef' }], comments: 3 }),
        item(2, { title: 'Idempotency keys', author: 'alice', draft: true }),
        item(3, { type: 'issue', title: 'Crash on start', assignees: ['alice'], headSha: null, labels: [{ name: 'bug', color: 'd73a4a' }] }),
        bump(4, 'me/api', 'react'), bump(5, 'me/api', 'vite'), bump(6, 'me/web', 'eslint'),
    ],
};

const respond = (body, ok = true, status = ok ? 200 : 400) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
let views;
function mockApi({ data = inbox, extra = () => null } = {}) {
    api.apiFetch.mockImplementation((path, options = {}) => {
        const handled = extra(path, options);
        if (handled) return handled;
        if (path === '/api/saved-views') return respond(views);
        return respond(data);
    });
}
const calls = (method, path) => api.apiFetch.mock.calls.filter(([p, o]) => (o?.method ?? 'GET') === method && (!path || p === path));
const titles = () => screen.getAllByRole('listitem').map((li) => within(li).getAllByRole('link')[0].textContent);
const pickSection = (name) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Inbox sections' })).getByRole('button', { name: new RegExp(`^${name}`) }));

describe('InboxPage', () => {
    const navigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
        views = [];
        window.history.replaceState(null, '', '/inbox');
    });

    it('opens on what needs my review, with a count per section', async () => {
        mockApi();
        render(<InboxPage />);

        expect(await screen.findByText('New cart flow')).toBeInTheDocument();
        expect(titles()).toEqual(['New cart flow']);
        expect(screen.getByText(/signed in to GitHub as alice/)).toBeInTheDocument();
        expect(screen.getByText(/review: alice/)).toBeInTheDocument();

        const nav = screen.getByRole('navigation', { name: 'Inbox sections' });
        expect(within(nav).getByRole('button', { name: /^Needs my review/ })).toHaveTextContent('1');
        expect(within(nav).getByRole('button', { name: /^Dependency updates/ })).toHaveTextContent('3');
        expect(within(nav).getByRole('button', { name: /^Everything/ })).toHaveTextContent('6');
    });

    it('switches section and keeps it in the URL', async () => {
        mockApi();
        render(<InboxPage />);
        await screen.findByText('New cart flow');

        pickSection('Assigned to me');
        expect(titles()).toEqual(['Crash on start']);
        expect(window.location.search).toBe('?section=assigned');

        pickSection('My pull requests');
        expect(titles()).toEqual(['Idempotency keys']);
        expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    it('starts from the filters in the URL', async () => {
        window.history.replaceState(null, '', '/inbox?section=all&label=bug');
        mockApi();
        render(<InboxPage />);

        expect(await screen.findByText('Crash on start')).toBeInTheDocument();
        expect(titles()).toEqual(['Crash on start']);
        expect(screen.getByLabelText('Label')).toHaveValue('bug');
    });

    it('filters by search, repo and drafts', async () => {
        mockApi();
        render(<InboxPage />);
        await screen.findByText('New cart flow');
        pickSection('All pull requests');
        expect(titles()).toHaveLength(5);

        fireEvent.click(screen.getByLabelText('Hide drafts'));
        expect(titles()).not.toContain('Idempotency keys');

        fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'me/web' } });
        expect(titles()).toEqual(['Bump eslint']);

        fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'all' } });
        fireEvent.change(screen.getByPlaceholderText(/Search title/), { target: { value: 'nothing' } });
        expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
    });

    it('works without a known viewer', async () => {
        mockApi({ data: { ...inbox, viewer: null } });
        render(<InboxPage />);

        await screen.findByText('New cart flow');
        const nav = screen.getByRole('navigation', { name: 'Inbox sections' });
        expect(within(nav).queryByRole('button', { name: /^Needs my review/ })).not.toBeInTheDocument();
        expect(within(nav).getByRole('button', { name: /^All pull requests/ })).toHaveAttribute('aria-current', 'true');
        expect(titles()).toHaveLength(5);
    });

    it('explains an inbox that was never read and reads it on Refresh', async () => {
        let synced = false;
        mockApi({
            extra: (path, { method }) => {
                if (method === 'POST' && path === '/api/inbox/refresh') { synced = true; return respond({ repos: 2, failed: 0 }); }
                if (path === '/api/inbox') return respond(synced ? inbox : { ...inbox, items: [], reposSynced: 0, oldestCheck: null });
                return null;
            },
        });
        render(<InboxPage />);

        expect(await screen.findByText('Nothing read yet')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
        expect(await screen.findByText('New cart flow')).toBeInTheDocument();
        expect(calls('POST', '/api/inbox/refresh')).toHaveLength(1);
    });

    it('groups dependency updates by repo and merges the selected ones', async () => {
        mockApi({
            extra: (path, { method }) => (method === 'POST' && path === '/api/inbox/merge' ? respond({
                merged: 1, skipped: 1, results: [
                    { repo: 'me/api', number: 4, merged: true },
                    { repo: 'me/api', number: 5, merged: false, reason: 'checks_failing' },
                ],
            }) : null),
        });
        render(<InboxPage />);
        await screen.findByText('New cart flow');
        pickSection('Dependency updates');

        expect(screen.getByRole('heading', { name: 'me/api' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'me/web' })).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Select all in me/api'));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Merge…/ }));

        const dialog = screen.getByRole('dialog', { name: 'Merge pull requests' });
        expect(within(dialog).getByText('Merge 2 pull requests')).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText('Merge method'), { target: { value: 'rebase' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Merge on GitHub' }));

        await within(dialog).findByText('merged');
        expect(JSON.parse(calls('POST', '/api/inbox/merge')[0][1].body)).toEqual({
            method: 'rebase',
            pulls: [{ repo: 'me/api', number: 4, sha: '4444444' }, { repo: 'me/api', number: 5, sha: '5555555' }],
        });
        expect(within(dialog).getByText(/checks are failing/)).toBeInTheDocument();
        // The list is read again so merged items go away.
        expect(calls('GET', '/api/inbox').length).toBeGreaterThan(1);

        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1));
        expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
    });

    it('shows why a merge request failed and lets it be retried', async () => {
        mockApi({ extra: (path, { method }) => (method === 'POST' && path === '/api/inbox/merge' ? respond({ error: 'Not available in the demo' }, false, 403) : null) });
        render(<InboxPage />);
        await screen.findByText('New cart flow');

        fireEvent.click(screen.getByLabelText('Select me/api#1'));
        fireEvent.click(screen.getByRole('button', { name: /Merge…/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Merge on GitHub' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Not available in the demo');
        expect(screen.getByRole('button', { name: 'Merge on GitHub' })).toBeEnabled();
    });

    it('does not offer to merge drafts or issues', async () => {
        mockApi();
        render(<InboxPage />);
        await screen.findByText('New cart flow');
        pickSection('Everything');

        expect(screen.getByLabelText('Select me/api#1')).toBeInTheDocument();
        expect(screen.queryByLabelText('Select me/api#2')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Select me/api#3')).not.toBeInTheDocument();
    });

    it('moves, selects and opens with the keyboard', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        mockApi();
        render(<InboxPage />);
        await screen.findByText('New cart flow');
        pickSection('Dependency updates');

        fireEvent.keyDown(window, { key: 'j' });
        fireEvent.keyDown(window, { key: 'j' });
        fireEvent.keyDown(window, { key: 'x' });
        expect(screen.getByLabelText('Select me/api#5')).toBeChecked();

        fireEvent.keyDown(window, { key: 'k' });
        fireEvent.keyDown(window, { key: 'o' });
        expect(open).toHaveBeenCalledWith('https://github.com/me/api/pull/4', '_blank', 'noopener');

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getByLabelText('Select me/api#5')).not.toBeChecked();
        open.mockRestore();
    });

    it('lists only the inbox views, applies one and saves the current filters', async () => {
        views = [
            { id: 1, name: 'Needs CI', query: 'health=needs-ci' },
            { id: 2, name: 'My bugs', query: 'inbox=1&section=assigned&label=bug' },
        ];
        mockApi({ extra: (path, { method }) => (method === 'POST' && path === '/api/saved-views' ? respond({ success: true }) : null) });
        render(<InboxPage />);
        await screen.findByText('New cart flow');

        expect(screen.queryByText('Needs CI')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'My bugs' }));
        expect(titles()).toEqual(['Crash on start']);
        expect(window.location.search).toBe('?section=assigned&label=bug');

        fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
        fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Bugs for me' } });
        fireEvent.submit(screen.getByLabelText('View name').closest('form'));
        await waitFor(() => expect(calls('POST', '/api/saved-views')).toHaveLength(1));
        expect(JSON.parse(calls('POST', '/api/saved-views')[0][1].body)).toEqual({ name: 'Bugs for me', query: 'inbox=1&section=assigned&label=bug' });
    });

    it('warns when a repo has more items than are kept, and goes back', async () => {
        mockApi({ data: { ...inbox, truncated: ['me/api'] } });
        render(<InboxPage />);

        expect(await screen.findByText(/Only the 100 most recently updated items are kept for: me\/api/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(navigate).toHaveBeenCalledWith('/');
    });

    it('offers a retry when it cannot load', async () => {
        api.apiFetch.mockImplementation((path) => (path === '/api/saved-views' ? respond([]) : respond({ error: 'boom' }, false, 500)));
        render(<InboxPage />);
        expect(await screen.findByText('boom')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
});
