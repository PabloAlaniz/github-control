import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchPage } from '@/pages/SearchPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const result = {
    query: 'createStorage', total: 12, shown: 2, incomplete: false, ownersSkipped: [],
    repos: [{ repo: 'me/api', files: [
        { path: 'src/storage.ts', url: 'https://github.com/me/api/blob/main/src/storage.ts', matches: [{ text: 'export function createStorage(config) {', highlights: [[16, 29]] }] },
        { path: 'README.md', url: 'https://github.com/me/api/blob/main/README.md', matches: [] },
    ] }],
};
const respond = (body, ok = true, status = ok ? 200 : 400) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
function mockApi(onSearch = () => respond(result)) {
    api.apiFetch.mockImplementation((path) => (path.startsWith('/api/search/code') ? onSearch(path) : respond([{ full_name: 'me/web' }, { full_name: 'me/api' }])));
}
const searches = () => api.apiFetch.mock.calls.map(([path]) => path).filter((path) => path.startsWith('/api/search/code'));

describe('SearchPage', () => {
    const navigate = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
        window.history.replaceState(null, '', '/search');
    });

    it('waits for something to look for', async () => {
        mockApi();
        render(<SearchPage />);
        expect(await screen.findByRole('option', { name: 'me/api' })).toBeInTheDocument();
        expect(screen.getByText(/Type what to look for/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Search/ })).toBeDisabled();
        expect(searches()).toEqual([]);
    });

    it('searches, groups the files by repo and marks what matched', async () => {
        mockApi();
        render(<SearchPage />);
        fireEvent.change(screen.getByLabelText('Look for'), { target: { value: 'createStorage' } });
        fireEvent.submit(screen.getByRole('search'));

        expect(await screen.findByRole('heading', { name: 'me/api' })).toBeInTheDocument();
        expect(searches()).toEqual(['/api/search/code?q=createStorage']);
        expect(window.location.search).toBe('?q=createStorage');

        expect(screen.getByRole('link', { name: 'src/storage.ts' })).toHaveAttribute('href', 'https://github.com/me/api/blob/main/src/storage.ts');
        const mark = screen.getByText('createStorage', { selector: 'mark' });
        expect(mark.parentElement).toHaveTextContent('export function createStorage(config) {');
        expect(screen.getByRole('status')).toHaveTextContent('2 files in 1 repo (GitHub found 12;');
    });

    it('runs the search in the URL on arrival, with its repo and language', async () => {
        window.history.replaceState(null, '', '/search?q=TODO&repo=me/api&language=go');
        mockApi();
        render(<SearchPage />);

        await screen.findByRole('heading', { name: 'me/api' });
        expect(searches()).toEqual(['/api/search/code?q=TODO&repo=me%2Fapi&language=go']);
        expect(screen.getByLabelText('Look for')).toHaveValue('TODO');
        await waitFor(() => expect(screen.getByLabelText('Repo')).toHaveValue('me/api'));
        expect(screen.getByLabelText('Language')).toHaveValue('go');
    });

    it('says when nothing was found, and when owners were left out', async () => {
        mockApi(() => respond({ ...result, total: 0, shown: 0, repos: [], incomplete: true, ownersSkipped: ['zeta'] }));
        render(<SearchPage />);
        fireEvent.change(screen.getByLabelText('Look for'), { target: { value: 'nothing' } });
        fireEvent.submit(screen.getByRole('search'));

        expect(await screen.findByRole('status')).toHaveTextContent('Nothing found for “createStorage”. · GitHub ran out of time');
        expect(screen.getByText(/Not searched: zeta/)).toBeInTheDocument();
    });

    it('shows why a search failed', async () => {
        mockApi(() => respond({ error: 'GitHub is limiting code searches right now' }, false, 429));
        render(<SearchPage />);
        fireEvent.change(screen.getByLabelText('Look for'), { target: { value: 'x' } });
        fireEvent.submit(screen.getByRole('search'));

        expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is limiting code searches right now');
    });

    it('shows the answer to the latest search, whatever order they come back in', async () => {
        const pending = [];
        mockApi(() => new Promise((resolve) => { pending.push(resolve); }));
        render(<SearchPage />);

        fireEvent.change(screen.getByLabelText('Look for'), { target: { value: 'first' } });
        fireEvent.submit(screen.getByRole('search'));
        fireEvent.change(screen.getByLabelText('Look for'), { target: { value: 'second' } });
        fireEvent.submit(screen.getByRole('search'));
        await waitFor(() => expect(pending).toHaveLength(2));

        const answer = (repo) => ({ ok: true, status: 200, json: () => Promise.resolve({ ...result, repos: [{ repo, files: [] }] }) });
        pending[1](answer('me/second'));
        expect(await screen.findByRole('heading', { name: 'me/second' })).toBeInTheDocument();
        pending[0](answer('me/first'));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'me/first' })).not.toBeInTheDocument());
    });

    it('goes back', async () => {
        mockApi();
        render(<SearchPage />);
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(navigate).toHaveBeenCalledWith('/');
    });
});
